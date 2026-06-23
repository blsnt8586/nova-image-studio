import { describe, it, expect, vi } from 'vitest';
import { createTaskRoutes } from '../src/routes/tasks.js';

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += chunk; this.ended = true; return this; },
  };
}

function makeReq(method, url) {
  return { method, url, headers: { authorization: 'Bearer good' } };
}

const verify = vi.fn(async (token) => (token === 'good' ? { userId: 42, role: 'user', email: '' } : null));

function parseBody(res) {
  return JSON.parse(res.body);
}

function makeDeps(overrides = {}) {
  const tasksRepo = {
    listTasks: vi.fn(async () => [{ id: 't1', userId: '42', status: 'completed' }]),
    getTask: vi.fn(async (uid, id) => (id === 't1' ? { id: 't1', userId: '42', status: 'completed' } : null)),
    listItems: vi.fn(async () => [{ taskId: 't1', itemIndex: 0, objectKeys: ['42/generation/a.png'] }]),
    removeTask: vi.fn(async () => {}),
    ...overrides.tasksRepo,
  };
  const images = { deleteKeys: vi.fn(async () => ({ total: 1, success: 1, failed: 0 })), ...overrides.images };
  const storage = {
    presignGet: vi.fn(async (uid, key) => ({ url: `https://signed/${key}`, objectKey: key })),
    ...overrides.storage,
  };
  return { verify, tasksRepo, images, storage };
}

describe('task routes: GET /api/tasks', () => {
  it('lists only the authenticated user tasks', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    const handled = await routes.handle(makeReq('GET', '/api/tasks'), res, '/api/tasks');
    expect(handled).toBe(true);
    expect(deps.tasksRepo.listTasks).toHaveBeenCalledWith(42);
    expect(res.statusCode).toBe(200);
    expect(parseBody(res).data).toHaveLength(1);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    const req = { method: 'GET', url: '/api/tasks', headers: {} };
    await routes.handle(req, res, '/api/tasks');
    expect(res.statusCode).toBe(401);
  });
});

describe('task routes: GET /api/tasks/:id', () => {
  it('returns the task with items and presigned image urls', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/tasks/t1'), res, '/api/tasks/t1');
    expect(res.statusCode).toBe(200);
    const data = parseBody(res).data;
    expect(data.id).toBe('t1');
    expect(data.items[0].urls[0]).toBe('https://signed/42/generation/a.png');
    expect(deps.storage.presignGet).toHaveBeenCalledWith(42, '42/generation/a.png');
  });

  it('returns 404 for a task not owned / not found', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('GET', '/api/tasks/ghost'), res, '/api/tasks/ghost');
    expect(res.statusCode).toBe(404);
  });
});

describe('task routes: DELETE /api/tasks/:id', () => {
  it('deletes MinIO objects then removes the task row', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/tasks/t1'), res, '/api/tasks/t1');
    expect(deps.images.deleteKeys).toHaveBeenCalledWith(42, ['42/generation/a.png']);
    expect(deps.tasksRepo.removeTask).toHaveBeenCalledWith(42, 't1');
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when deleting a non-owned task', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/tasks/ghost'), res, '/api/tasks/ghost');
    expect(res.statusCode).toBe(404);
    expect(deps.tasksRepo.removeTask).not.toHaveBeenCalled();
  });

  it('still removes the task row when image deletion throws (best-effort)', async () => {
    const deps = makeDeps({ images: { deleteKeys: vi.fn(async () => { throw new Error('minio down'); }) } });
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('DELETE', '/api/tasks/t1'), res, '/api/tasks/t1');
    expect(deps.tasksRepo.removeTask).toHaveBeenCalledWith(42, 't1');
    expect(res.statusCode).toBe(200);
  });
});

describe('task routes: dispatch', () => {
  it('returns false for unrelated paths', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    expect(await routes.handle(makeReq('GET', '/api/other'), res, '/api/other')).toBe(false);
  });

  it('405 for unsupported method on collection', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('POST', '/api/tasks'), res, '/api/tasks');
    expect(res.statusCode).toBe(405);
  });

  it('405 for unsupported method on item', async () => {
    const deps = makeDeps();
    const routes = createTaskRoutes(deps);
    const res = makeRes();
    await routes.handle(makeReq('PUT', '/api/tasks/t1'), res, '/api/tasks/t1');
    expect(res.statusCode).toBe(405);
  });
});
