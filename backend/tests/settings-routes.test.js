import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createResourceRoutes } from '../src/routes/resources.js';

function makeRes() {
  const state = { status: null, body: null };
  return {
    state,
    writeHead(status) { state.status = status; },
    end(payload) { state.body = payload ? JSON.parse(payload) : null; },
  };
}

function makeReq(method, url, jsonBody) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { authorization: 'Bearer good' };
  if (jsonBody !== undefined) {
    setImmediate(() => {
      req.emit('data', Buffer.from(JSON.stringify(jsonBody)));
      req.emit('end');
    });
  } else {
    setImmediate(() => req.emit('end'));
  }
  return req;
}

function makeDeps(overrides = {}) {
  const verify = vi.fn().mockResolvedValue({ userId: '42', role: 'user', email: 'e' });
  const settingsRepo = {
    list: vi.fn().mockResolvedValue([
      { key: 'theme', value: 'dark' },
      { key: 'nova-model-registry', value: { imageModels: [] } },
    ]),
    put: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { verify, settingsRepo, ...overrides };
}

describe('resources: settings', () => {
  it('GET /api/settings returns a key→value map for current user', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    const handled = await routes.handle(makeReq('GET', '/api/settings'), res, '/api/settings');
    expect(handled).toBe(true);
    expect(res.state.status).toBe(200);
    expect(deps.settingsRepo.list).toHaveBeenCalledWith('42');
    expect(res.state.body.data).toEqual({ theme: 'dark', 'nova-model-registry': { imageModels: [] } });
  });

  it('PUT /api/settings/:key upserts a whitelisted key', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PUT', '/api/settings/theme', { value: 'light' }), res, '/api/settings/theme');
    expect(res.state.status).toBe(200);
    expect(deps.settingsRepo.put).toHaveBeenCalledWith('42', 'theme', 'light');
  });

  it('PUT accepts object values', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    const reg = { imageModels: [{ id: 'x' }], textModels: [], defaults: {} };
    await routes.handle(makeReq('PUT', '/api/settings/nova-model-registry', { value: reg }), res, '/api/settings/nova-model-registry');
    expect(res.state.status).toBe(200);
    expect(deps.settingsRepo.put).toHaveBeenCalledWith('42', 'nova-model-registry', reg);
  });

  it('PUT rejects a non-whitelisted key with 400', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PUT', '/api/settings/evil-key', { value: 1 }), res, '/api/settings/evil-key');
    expect(res.state.status).toBe(400);
    expect(deps.settingsRepo.put).not.toHaveBeenCalled();
  });

  it('PUT rejects missing value with 400', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PUT', '/api/settings/theme', {}), res, '/api/settings/theme');
    expect(res.state.status).toBe(400);
  });

  it('DELETE /api/settings/:key scopes by user', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/settings/theme'), res, '/api/settings/theme');
    expect(res.state.status).toBe(200);
    expect(deps.settingsRepo.remove).toHaveBeenCalledWith('42', 'theme');
  });

  it('GET returns empty map when settingsRepo absent (graceful)', async () => {
    const deps = makeDeps({ settingsRepo: undefined });
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/settings'), res, '/api/settings');
    expect(res.state.status).toBe(200);
    expect(res.state.body.data).toEqual({});
  });
});
