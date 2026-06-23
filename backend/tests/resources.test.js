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
  const canvasesRepo = {
    list: vi.fn().mockResolvedValue([{ id: 'c1', userId: '42' }]),
    getById: vi.fn().mockResolvedValue({ id: 'c1', userId: '42' }),
    create: vi.fn().mockResolvedValue({ id: 'c1', userId: '42' }),
    update: vi.fn().mockResolvedValue({ id: 'c1', userId: '42' }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const generationsRepo = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'g1' }),
    remove: vi.fn().mockResolvedValue(undefined),
    findByHash: vi.fn().mockResolvedValue(null),
    countByUser: vi.fn().mockResolvedValue(0),
  };
  const assetsRepo = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'a1' }),
    remove: vi.fn().mockResolvedValue(undefined),
    findByHash: vi.fn().mockResolvedValue(null),
    countByUser: vi.fn().mockResolvedValue(0),
  };
  const storage = {
    presignPut: vi.fn().mockResolvedValue({ url: 'https://put', objectKey: '42/asset/u.png' }),
    presignGet: vi.fn().mockResolvedValue({ url: 'https://get', objectKey: '42/asset/u.png' }),
  };
  return {
    verify, canvasesRepo, generationsRepo, assetsRepo, storage,
    ...overrides,
  };
}

describe('resources: canvases', () => {
  it('GET /api/canvases lists current user canvases', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    const handled = await routes.handle(makeReq('GET', '/api/canvases'), res, '/api/canvases');
    expect(handled).toBe(true);
    expect(res.state.status).toBe(200);
    expect(deps.canvasesRepo.list).toHaveBeenCalledWith('42');
    expect(res.state.body.success).toBe(true);
  });

  it('POST /api/canvases creates with user scope', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/canvases', { name: 'x', snapshotJson: { a: 1 } }), res, '/api/canvases');
    expect(res.state.status).toBe(201);
    expect(deps.canvasesRepo.create).toHaveBeenCalledWith('42', expect.objectContaining({ name: 'x' }));
  });

  it('POST /api/canvases rejects missing snapshotJson with 400', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/canvases', { name: 'x' }), res, '/api/canvases');
    expect(res.state.status).toBe(400);
    expect(deps.canvasesRepo.create).not.toHaveBeenCalled();
  });

  it('GET /api/canvases/:id returns 404 when not found', async () => {
    const deps = makeDeps();
    deps.canvasesRepo.getById.mockResolvedValue(null);
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/canvases/c9'), res, '/api/canvases/c9');
    expect(res.state.status).toBe(404);
    expect(deps.canvasesRepo.getById).toHaveBeenCalledWith('42', 'c9');
  });

  it('PUT /api/canvases/:id updates within user scope', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PUT', '/api/canvases/c1', { name: 'y' }), res, '/api/canvases/c1');
    expect(res.state.status).toBe(200);
    expect(deps.canvasesRepo.update).toHaveBeenCalledWith('42', 'c1', expect.objectContaining({ name: 'y' }));
  });

  it('DELETE /api/canvases/:id removes within user scope', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/canvases/c1'), res, '/api/canvases/c1');
    expect(res.state.status).toBe(200);
    expect(deps.canvasesRepo.remove).toHaveBeenCalledWith('42', 'c1');
  });
});

describe('resources: generations', () => {
  it('GET lists', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/generations'), res, '/api/generations');
    expect(res.state.status).toBe(200);
    expect(deps.generationsRepo.list).toHaveBeenCalledWith('42');
  });

  it('POST creates with objectKey', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/generations', { mode: 'text-to-image', objectKey: '42/generation/x.png' }), res, '/api/generations');
    expect(res.state.status).toBe(201);
    expect(deps.generationsRepo.create).toHaveBeenCalledWith('42', expect.objectContaining({ objectKey: '42/generation/x.png' }));
  });

  it('POST rejects objectKey not owned by user (400)', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/generations', { mode: 'text-to-image', objectKey: '7/generation/x.png' }), res, '/api/generations');
    expect(res.state.status).toBe(400);
    expect(deps.generationsRepo.create).not.toHaveBeenCalled();
  });

  it('DELETE removes', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/generations/g1'), res, '/api/generations/g1');
    expect(res.state.status).toBe(200);
    expect(deps.generationsRepo.remove).toHaveBeenCalledWith('42', 'g1');
  });
});

describe('resources: assets', () => {
  it('POST creates with owned objectKey', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/assets', { objectKey: '42/asset/x.png', mime: 'image/png', size: 5 }), res, '/api/assets');
    expect(res.state.status).toBe(201);
    expect(deps.assetsRepo.create).toHaveBeenCalledWith('42', expect.objectContaining({ objectKey: '42/asset/x.png' }));
  });
});

describe('resources: presign', () => {
  it('POST /api/storage/presign put returns url+key', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/storage/presign', { op: 'put', type: 'asset', ext: 'png', contentType: 'image/png' }), res, '/api/storage/presign');
    expect(res.state.status).toBe(200);
    expect(deps.storage.presignPut).toHaveBeenCalledWith('42', 'asset', 'png', 'image/png');
    expect(res.state.body.data.url).toBe('https://put');
  });

  it('POST presign get verifies ownership via storage', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/storage/presign', { op: 'get', objectKey: '42/asset/u.png' }), res, '/api/storage/presign');
    expect(res.state.status).toBe(200);
    expect(deps.storage.presignGet).toHaveBeenCalledWith('42', '42/asset/u.png');
  });

  it('POST presign get returns 403 when storage refuses cross-user key', async () => {
    const deps = makeDeps();
    deps.storage.presignGet.mockRejectedValue(new Error('无权访问该对象'));
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/storage/presign', { op: 'get', objectKey: '7/asset/u.png' }), res, '/api/storage/presign');
    expect(res.state.status).toBe(403);
  });

  it('POST presign rejects invalid op with 400', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/storage/presign', { op: 'evil' }), res, '/api/storage/presign');
    expect(res.state.status).toBe(400);
  });
});

describe('resources: dedup + per-user limit', () => {
  it('generations POST dedup-hit returns existing row (200) without create', async () => {
    const deps = makeDeps();
    deps.generationsRepo.findByHash.mockResolvedValue({ id: 'existing', objectKey: '42/generation/old.png' });
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/generations', { mode: 'text-to-image', objectKey: '42/generation/x.png', contentHash: 'h1' }), res, '/api/generations');
    expect(res.state.status).toBe(200);
    expect(res.state.body.data.id).toBe('existing');
    expect(deps.generationsRepo.findByHash).toHaveBeenCalledWith('42', 'h1');
    expect(deps.generationsRepo.create).not.toHaveBeenCalled();
    expect(deps.generationsRepo.countByUser).not.toHaveBeenCalled();
  });

  it('generations POST under limit creates normally (201) and passes contentHash', async () => {
    const deps = makeDeps();
    deps.generationsRepo.countByUser.mockResolvedValue(10);
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/generations', { mode: 'text-to-image', objectKey: '42/generation/x.png', contentHash: 'h2' }), res, '/api/generations');
    expect(res.state.status).toBe(201);
    expect(deps.generationsRepo.create).toHaveBeenCalledWith('42', expect.objectContaining({ contentHash: 'h2' }));
  });

  it('generations POST at limit returns 409 with export hint', async () => {
    const deps = makeDeps({ limits: { generations: 50, assets: 50 } });
    deps.generationsRepo.countByUser.mockResolvedValue(50);
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/generations', { mode: 'text-to-image', objectKey: '42/generation/x.png', contentHash: 'h3' }), res, '/api/generations');
    expect(res.state.status).toBe(409);
    expect(deps.generationsRepo.create).not.toHaveBeenCalled();
    expect(res.state.body.success).toBe(false);
    expect(res.state.body.error).toMatch(/导出|备份|上限/);
  });

  it('generations dedup-hit bypasses limit even when at cap', async () => {
    const deps = makeDeps({ limits: { generations: 50, assets: 50 } });
    deps.generationsRepo.countByUser.mockResolvedValue(50);
    deps.generationsRepo.findByHash.mockResolvedValue({ id: 'existing' });
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/generations', { mode: 'text-to-image', objectKey: '42/generation/x.png', contentHash: 'h4' }), res, '/api/generations');
    expect(res.state.status).toBe(200);
    expect(res.state.body.data.id).toBe('existing');
  });

  it('assets POST dedup-hit returns existing row (200)', async () => {
    const deps = makeDeps();
    deps.assetsRepo.findByHash.mockResolvedValue({ id: 'a-existing' });
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/assets', { objectKey: '42/asset/x.png', contentHash: 'ah1' }), res, '/api/assets');
    expect(res.state.status).toBe(200);
    expect(res.state.body.data.id).toBe('a-existing');
    expect(deps.assetsRepo.create).not.toHaveBeenCalled();
  });

  it('assets POST at limit returns 409', async () => {
    const deps = makeDeps({ limits: { generations: 50, assets: 50 } });
    deps.assetsRepo.countByUser.mockResolvedValue(50);
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/assets', { objectKey: '42/asset/x.png', contentHash: 'ah2' }), res, '/api/assets');
    expect(res.state.status).toBe(409);
    expect(deps.assetsRepo.create).not.toHaveBeenCalled();
  });

  it('assets POST without contentHash still enforces limit (no findByHash query)', async () => {
    const deps = makeDeps({ limits: { generations: 50, assets: 50 } });
    deps.assetsRepo.countByUser.mockResolvedValue(50);
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/assets', { objectKey: '42/asset/x.png' }), res, '/api/assets');
    expect(res.state.status).toBe(409);
    expect(deps.assetsRepo.findByHash).not.toHaveBeenCalled();
  });

  it('defaults limit to 50 when not configured', async () => {
    const deps = makeDeps();
    deps.assetsRepo.countByUser.mockResolvedValue(49);
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/assets', { objectKey: '42/asset/x.png', contentHash: 'ah3' }), res, '/api/assets');
    expect(res.state.status).toBe(201);

    const deps2 = makeDeps();
    deps2.assetsRepo.countByUser.mockResolvedValue(50);
    const routes2 = createResourceRoutes(deps2);
    const res2 = makeRes();
    await routes2.handle(makeReq('POST', '/api/assets', { objectKey: '42/asset/y.png', contentHash: 'ah4' }), res2, '/api/assets');
    expect(res2.state.status).toBe(409);
  });
});

describe('resources: auth + routing', () => {
  it('returns 401 without token', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = '/api/canvases';
    req.headers = {};
    setImmediate(() => req.emit('end'));
    await routes.handle(req, res, '/api/canvases');
    expect(res.state.status).toBe(401);
  });

  it('returns false for unrelated paths', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    const handled = await routes.handle(makeReq('GET', '/api/other'), res, '/api/other');
    expect(handled).toBe(false);
  });

  it('returns 405 for unsupported method on collection', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PATCH', '/api/canvases'), res, '/api/canvases');
    expect(res.state.status).toBe(405);
  });

  it('returns 405 for unsupported method on canvases item', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PATCH', '/api/canvases/c1'), res, '/api/canvases/c1');
    expect(res.state.status).toBe(405);
  });

  it('returns 405 for unsupported method on generations item', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/generations/g1'), res, '/api/generations/g1');
    expect(res.state.status).toBe(405);
  });

  it('returns 405 for unsupported method on assets item', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/assets/a1'), res, '/api/assets/a1');
    expect(res.state.status).toBe(405);
  });

  it('GET /api/assets lists', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/assets'), res, '/api/assets');
    expect(res.state.status).toBe(200);
    expect(deps.assetsRepo.list).toHaveBeenCalledWith('42');
  });

  it('DELETE /api/assets/:id removes within user scope', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/assets/a1'), res, '/api/assets/a1');
    expect(res.state.status).toBe(200);
    expect(deps.assetsRepo.remove).toHaveBeenCalledWith('42', 'a1');
  });

  it('returns 405 for GET on presign', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/storage/presign'), res, '/api/storage/presign');
    expect(res.state.status).toBe(405);
  });

  it('presign put defaults ext to bin when omitted', async () => {
    const deps = makeDeps();
    const routes = createResourceRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/storage/presign', { op: 'put', type: 'generation' }), res, '/api/storage/presign');
    expect(res.state.status).toBe(200);
    expect(deps.storage.presignPut).toHaveBeenCalledWith('42', 'generation', 'bin', undefined);
  });
});
