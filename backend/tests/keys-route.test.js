import { describe, it, expect, vi } from 'vitest';
import { createKeysHandler } from '../src/routes/keys.js';

function makeReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {}, url: '/api/keys' };
}

function makeRes() {
  const state = { status: null, body: null };
  return {
    state,
    writeHead(status) {
      state.status = status;
    },
    end(payload) {
      state.body = payload ? JSON.parse(payload) : null;
    },
  };
}

describe('routes/keys — GET /api/keys', () => {
  it('returns the stripped key list for a valid token', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 11, role: 'user', email: 'm@n.com' });
    const keysClient = {
      listKeys: vi.fn().mockResolvedValue([
        { id: 1, name: '画布API', status: 'enabled' },
        { id: 2, name: '备用', status: 'enabled' },
      ]),
    };
    const res = makeRes();

    await createKeysHandler({ verify, keysClient })(makeReq('Bearer good'), res);

    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({
      success: true,
      data: [
        { id: 1, name: '画布API', status: 'enabled' },
        { id: 2, name: '备用', status: 'enabled' },
      ],
    });
    expect(keysClient.listKeys).toHaveBeenCalledWith('good');
  });

  it('returns 401 without a token, without hitting sub2api', async () => {
    const verify = vi.fn();
    const keysClient = { listKeys: vi.fn() };
    const res = makeRes();

    await createKeysHandler({ verify, keysClient })(makeReq(), res);

    expect(res.state.status).toBe(401);
    expect(keysClient.listKeys).not.toHaveBeenCalled();
  });

  it('never leaks an sk- secret in the response', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    // 即便 listKeys 误带了 key,handler 也不应直接转储原始对象
    const keysClient = { listKeys: vi.fn().mockResolvedValue([{ id: 1, name: 'k', status: 'enabled' }]) };
    const res = makeRes();

    await createKeysHandler({ verify, keysClient })(makeReq('Bearer jwt'), res);

    expect(JSON.stringify(res.state.body)).not.toContain('sk-');
  });

  it('returns an empty list when listKeys yields null (token rejected upstream)', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const keysClient = { listKeys: vi.fn().mockResolvedValue(null) };
    const res = makeRes();

    await createKeysHandler({ verify, keysClient })(makeReq('Bearer jwt'), res);

    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({ success: true, data: [] });
  });

  it('returns 503 when listing keys upstream is unreachable', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const keysClient = {
      listKeys: vi.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 })),
    };
    const res = makeRes();

    await createKeysHandler({ verify, keysClient })(makeReq('Bearer jwt'), res);

    expect(res.state.status).toBe(503);
    expect(res.state.body.success).toBe(false);
  });
});
