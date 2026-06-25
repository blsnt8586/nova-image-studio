import { describe, it, expect, vi } from 'vitest';
import { createPgTaskGateway } from '../src/tasks/pg-task-gateway.js';

function makeDeps(overrides = {}) {
  const tasksRepo = {
    countActiveByStatus: vi.fn(async () => ({ queued: 2, processing: 3 })),
    getById: vi.fn(async (id) => ({ id, userId: 'u1', status: 'completed', requestJson: { parallelCount: 2 } })),
    getTaskOwner: vi.fn(async () => 'u1'),
    setExpiry: vi.fn(async () => {}),
    failActiveTasks: vi.fn(async () => ['t1', 't2']),
    ...overrides.tasksRepo,
  };
  const store = {
    insertTask: vi.fn(async () => {}),
    serialize: vi.fn(async (taskId, userId) => ({ id: taskId, _owner: userId, status: 'completed' })),
    deleteTask: vi.fn(async () => {}),
    findExpiredIds: vi.fn(async () => ['t1', 't2']),
    ...overrides.store,
  };
  const engine = {
    runTask: vi.fn(async () => {}),
    ...overrides.engine,
  };
  return { tasksRepo, store, engine };
}

describe('pg-task-gateway', () => {
  it('getQueueCounts maps repo status counts', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    const counts = await gw.getQueueCounts();
    expect(deps.tasksRepo.countActiveByStatus).toHaveBeenCalledWith(['queued', 'processing']);
    expect(counts).toEqual({ queuedCount: 2, processingCount: 3 });
  });

  it('getQueueCounts treats missing statuses as 0', async () => {
    const deps = makeDeps({ tasksRepo: { countActiveByStatus: vi.fn(async () => ({})) } });
    const gw = createPgTaskGateway(deps);
    expect(await gw.getQueueCounts()).toEqual({ queuedCount: 0, processingCount: 0 });
  });

  it('createTask inserts and tracks parallelCount + owner', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    await gw.createTask('u9', { taskId: 't1', mode: 'text-to-image', requestForDb: { a: 1 }, parallelCount: 3 });
    expect(deps.store.insertTask).toHaveBeenCalledWith('t1', 'u9', 'text-to-image', { a: 1 }, 3);
    expect(await gw.getParallelCount('t1')).toBe(3);
  });

  it('getParallelCount falls back to DB request_json when not tracked', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    expect(await gw.getParallelCount('unknown')).toBe(2);
  });

  it('getParallelCount defaults to 1 when nothing resolvable', async () => {
    const deps = makeDeps({ tasksRepo: { getById: vi.fn(async () => null) } });
    const gw = createPgTaskGateway(deps);
    expect(await gw.getParallelCount('ghost')).toBe(1);
  });

  it('runTask resolves tracked owner and delegates to engine with userId', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    await gw.createTask('u9', { taskId: 't1', mode: 'm', requestForDb: {}, parallelCount: 1 });
    await gw.runTask('t1', 'key-abc', [{ mimeType: 'image/png' }]);
    expect(deps.engine.runTask).toHaveBeenCalledWith('t1', 'u9', 'key-abc', [{ mimeType: 'image/png' }], undefined);
  });

  it('runTask forwards mask to engine (智能重绘)', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    await gw.createTask('u9', { taskId: 't1', mode: 'm', requestForDb: {}, parallelCount: 1 });
    const mask = { data: 'bWFzaw==', mimeType: 'image/png' };
    await gw.runTask('t1', 'key-abc', [{ mimeType: 'image/png' }], mask);
    expect(deps.engine.runTask).toHaveBeenCalledWith('t1', 'u9', 'key-abc', [{ mimeType: 'image/png' }], mask);
  });

  it('runTask resolves owner from repo when not tracked (restart safety)', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    await gw.runTask('t1', 'key', []);
    expect(deps.tasksRepo.getTaskOwner).toHaveBeenCalledWith('t1');
    expect(deps.engine.runTask).toHaveBeenCalledWith('t1', 'u1', 'key', [], undefined);
  });

  it('runTask is a no-op when no owner resolvable', async () => {
    const deps = makeDeps({ tasksRepo: { getTaskOwner: vi.fn(async () => null) } });
    const gw = createPgTaskGateway(deps);
    await gw.runTask('ghost', 'key', []);
    expect(deps.engine.runTask).not.toHaveBeenCalled();
  });

  it('serialize resolves owner via getById then delegates to store', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    const out = await gw.serialize('t1');
    expect(deps.tasksRepo.getById).toHaveBeenCalledWith('t1');
    expect(deps.store.serialize).toHaveBeenCalledWith('t1', 'u1');
    expect(out._owner).toBe('u1');
  });

  it('serialize returns null when task row missing', async () => {
    const deps = makeDeps({ tasksRepo: { getById: vi.fn(async () => null) } });
    const gw = createPgTaskGateway(deps);
    expect(await gw.serialize('ghost')).toBeNull();
    expect(deps.store.serialize).not.toHaveBeenCalled();
  });

  it('deleteTask resolves owner and delegates, clearing tracked state', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    await gw.createTask('u9', { taskId: 't1', mode: 'm', requestForDb: {}, parallelCount: 2 });
    await gw.deleteTask('t1');
    expect(deps.store.deleteTask).toHaveBeenCalledWith('t1', 'u9');
    // tracked state cleared
    expect(await gw.getParallelCount('t1')).toBe(2); // falls back to DB
  });

  it('deleteTask is a no-op when row missing', async () => {
    const deps = makeDeps({ tasksRepo: { getById: vi.fn(async () => null) } });
    const gw = createPgTaskGateway(deps);
    await gw.deleteTask('ghost');
    expect(deps.store.deleteTask).not.toHaveBeenCalled();
  });

  it('touchExpiry delegates to repo.setExpiry', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    const when = new Date('2030-01-01T00:00:00Z');
    await gw.touchExpiry('t1', when);
    expect(deps.tasksRepo.setExpiry).toHaveBeenCalledWith('t1', when);
  });

  it('listExpiredIds delegates to store', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    const now = new Date();
    expect(await gw.listExpiredIds(now)).toEqual(['t1', 't2']);
    expect(deps.store.findExpiredIds).toHaveBeenCalledWith(now);
  });

  it('cleanupRuntime clears tracked maps', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    await gw.createTask('u9', { taskId: 't1', mode: 'm', requestForDb: {}, parallelCount: 4 });
    gw.cleanupRuntime('t1');
    // after cleanup, parallelCount falls back to DB (2), proving map cleared
    expect(await gw.getParallelCount('t1')).toBe(2);
  });

  it('recoverInterrupted marks active tasks failed with a TTL', async () => {
    const deps = makeDeps();
    const gw = createPgTaskGateway(deps);
    const ids = await gw.recoverInterrupted({ message: '中断', ttlMs: 1000 });
    expect(deps.tasksRepo.failActiveTasks).toHaveBeenCalledTimes(1);
    const args = deps.tasksRepo.failActiveTasks.mock.calls[0];
    expect(args[0]).toBe('中断');
    expect(args[1]).toBeInstanceOf(Date); // failedAt
    expect(args[2]).toBeInstanceOf(Date); // expiresAt
    expect(args[2].getTime()).toBeGreaterThan(args[1].getTime());
    expect(ids).toEqual(['t1', 't2']);
  });
});
