import { describe, it, expect, vi } from 'vitest';
import { createProxyHandler } from '../src/proxy/handler.js';

function makeReq({ method = 'POST', url = '/api/proxy/v1/responses', authHeader, keyId, body = '' } = {}) {
  // 模拟一个可异步迭代的 Node 请求流
  const chunks = body ? [Buffer.from(body)] : [];
  return {
    method,
    url,
    headers: {
      ...(authHeader ? { authorization: authHeader } : {}),
      ...(keyId !== undefined ? { 'x-sub2api-key-id': String(keyId) } : {}),
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function makeRes() {
  const state = { status: null, headers: null, body: '' };
  return {
    state,
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers;
    },
    write(chunk) {
      state.body += chunk.toString();
    },
    end(chunk) {
      if (chunk) state.body += chunk.toString();
      state.ended = true;
    },
  };
}

function streamResponse({ status = 200, payload = '{"ok":true}', headers = { 'content-type': 'application/json' } } = {}) {
  return {
    status,
    headers: new Map(Object.entries(headers)),
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(payload);
      },
    },
  };
}

// 默认 keysClient:把任意 keyId 解析为固定 sk- key
function makeKeysClient(resolveImpl) {
  return {
    resolveKey: vi.fn(resolveImpl || (async () => 'sk-resolved-key')),
    listKeys: vi.fn(),
  };
}

const deps = (fetchImpl, verify, keysClient) => ({
  fetchImpl,
  verify,
  keysClient: keysClient || makeKeysClient(),
  sub2apiBaseUrl: 'https://sub2api.test',
});

describe('proxy/handler — createProxyHandler', () => {
  it('forwards an authenticated request to sub2api with the resolved sk- key', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse({ payload: '{"id":"img_1"}' }));
    const keysClient = makeKeysClient(async () => 'sk-live-key');
    const res = makeRes();

    const handled = await createProxyHandler(deps(fetchImpl, verify, keysClient))(
      makeReq({ authHeader: 'Bearer jwt-user', keyId: 2, body: '{"prompt":"cat"}' }),
      res,
    );

    expect(handled).toBe(true);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sub2api.test/v1/responses');
    expect(opts.method).toBe('POST');
    // 转发用的是代查出的 sk- key,而不是 JWT
    expect(opts.headers.Authorization).toBe('Bearer sk-live-key');
    // keysClient 用代验身份 + 选中的 keyId 解析
    expect(keysClient.resolveKey).toHaveBeenCalledWith({ token: 'jwt-user', keyId: '2', userId: 1 });
    expect(res.state.status).toBe(200);
    expect(res.state.body).toContain('img_1');
  });

  it('does not leak the internal X-Sub2api-Key-Id header upstream', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse());
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt', keyId: 5 }),
      res,
    );

    const fwd = fetchImpl.mock.calls[0][1].headers;
    expect(fwd['x-sub2api-key-id']).toBeUndefined();
  });

  it('returns 400 when the keyId resolves to no key', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn();
    const keysClient = makeKeysClient(async () => null);
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify, keysClient))(
      makeReq({ authHeader: 'Bearer jwt', keyId: 999 }),
      res,
    );

    expect(res.state.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 503 when key resolution upstream is unreachable', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn();
    const keysClient = makeKeysClient(async () => { throw Object.assign(new Error('down'), { status: 503 }); });
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify, keysClient))(
      makeReq({ authHeader: 'Bearer jwt', keyId: 1 }),
      res,
    );

    expect(res.state.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no token, without calling sub2api', async () => {
    const verify = vi.fn();
    const fetchImpl = vi.fn();
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(makeReq({ authHeader: undefined }), res);

    expect(res.state.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is invalid', async () => {
    const verify = vi.fn().mockResolvedValue(null);
    const fetchImpl = vi.fn();
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer bad' }),
      res,
    );

    expect(res.state.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 404 for a path outside the proxy prefix', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn();
    const res = makeRes();

    const handled = await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ url: '/api/other' }),
      res,
    );

    expect(handled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a path-traversal proxy path with 400', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn();
    const res = makeRes();

    const handled = await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ url: '/api/proxy/../secret', authHeader: 'Bearer jwt' }),
      res,
    );

    expect(handled).toBe(true);
    expect(res.state.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 502 when sub2api is unreachable', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt' }),
      res,
    );

    expect(res.state.status).toBe(502);
  });

  it('passes through a non-200 upstream status (e.g. 429)', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue(
      streamResponse({ status: 429, payload: '{"error":"rate"}' }),
    );
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt' }),
      res,
    );

    expect(res.state.status).toBe(429);
    expect(res.state.body).toContain('rate');
  });

  it('verifies the original token but forwards the resolved sk- key (never the JWT)', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse());
    const keysClient = makeKeysClient(async () => 'sk-xyz');
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify, keysClient))(
      makeReq({ authHeader: 'Bearer the-jwt', keyId: 1 }),
      res,
    );

    expect(verify).toHaveBeenCalledWith('the-jwt');
    // 转发头里只有 sk- key,绝不出现 JWT
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-xyz');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).not.toContain('the-jwt');
  });

  it('forwards a GET (list models) with no body', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue(
      streamResponse({ payload: '{"data":[{"id":"m1"}]}' }),
    );
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ method: 'GET', url: '/api/proxy/v1/models', authHeader: 'Bearer jwt' }),
      res,
    );

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sub2api.test/v1/models');
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
    expect(res.state.body).toContain('m1');
  });

  it('returns 503 when verify throws (upstream identity error)', async () => {
    const verify = vi.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    const fetchImpl = vi.fn();
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt' }),
      res,
    );

    expect(res.state.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a token from the ?token= query param on the proxy path', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse());
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ method: 'GET', url: '/api/proxy/v1/models?token=qtok' }),
      res,
    );

    expect(verify).toHaveBeenCalledWith('qtok');
    // query 也应被透传到目标
    expect(fetchImpl.mock.calls[0][0]).toBe('https://sub2api.test/v1/models?token=qtok');
  });

  it('falls back to text() when upstream body is not async-iterable', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      body: null,
      text: async () => '{"plain":true}',
    });
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt' }),
      res,
    );

    expect(res.state.body).toContain('plain');
  });

  it('strips hop-by-hop response headers (content-encoding) on passthrough', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([
        ['content-type', 'application/json'],
        ['content-encoding', 'gzip'],
        ['transfer-encoding', 'chunked'],
      ]),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('{"ok":1}');
        },
      },
    });
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt' }),
      res,
    );

    expect(res.state.headers['content-type']).toBe('application/json');
    expect(res.state.headers['content-encoding']).toBeUndefined();
    expect(res.state.headers['transfer-encoding']).toBeUndefined();
  });

  it('ends the response cleanly when upstream has neither body nor text()', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 204,
      headers: new Map(),
      body: null,
    });
    const res = makeRes();

    await createProxyHandler(deps(fetchImpl, verify))(
      makeReq({ authHeader: 'Bearer jwt' }),
      res,
    );

    expect(res.state.status).toBe(204);
    expect(res.state.ended).toBe(true);
    expect(res.state.body).toBe('');
  });
});
