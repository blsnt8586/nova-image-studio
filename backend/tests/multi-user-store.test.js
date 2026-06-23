import { describe, it, expect, vi } from 'vitest';
import { createMultiUserTaskStore } from '../src/tasks/multi-user-store.js';

function makeRepo() {
  const tasks = new Map();
  const items = new Map(); // `${taskId}:${index}`
  return {
    _tasks: tasks,
    _items: items,
    createTask: vi.fn(async (userId, data) => { tasks.set(data.id, { ...data, userId }); return tasks.get(data.id); }),
    createItem: vi.fn(async (userId, data) => { items.set(`${data.taskId}:${data.itemIndex}`, { ...data, userId }); }),
    getTask: vi.fn(async (userId, id) => {
      const t = tasks.get(id);
      return t && String(t.userId) === String(userId) ? t : null;
    }),
    updateTask: vi.fn(async (userId, id, patch) => { const t = tasks.get(id); if (t) Object.assign(t, patch); return t || null; }),
    updateItem: vi.fn(async (userId, taskId, index, patch) => { const it = items.get(`${taskId}:${index}`); if (it) Object.assign(it, patch); return it || null; }),
    listItems: vi.fn(async (userId, taskId) => [...items.values()].filter((i) => i.taskId === taskId)),
    removeTask: vi.fn(async () => {}),
    findExpired: vi.fn(async (now) => [...tasks.values()].filter((t) => t.expiresAt && t.expiresAt <= now)),
    getTaskOwner: vi.fn(async (id) => { const t = tasks.get(id); return t ? t.userId : null; }),
    purgeTask: vi.fn(async (id) => { tasks.delete(id); }),
  };
}

function makeImages() {
  return {
    saveBuffer: vi.fn(async (userId) => `${userId}/generation/uuid.png`),
    saveFromUrl: vi.fn(async (userId) => `${userId}/generation/remote.webp`),
    deleteKeys: vi.fn(async () => ({ total: 1, success: 1, failed: 0 })),
  };
}

function makeStorage() {
  return { presignGet: vi.fn(async (userId, key) => ({ url: `https://signed/${key}`, objectKey: key })) };
}

function makeStore(over = {}) {
  const repo = over.repo || makeRepo();
  const images = over.images || makeImages();
  const storage = over.storage || makeStorage();
  return { repo, images, storage, store: createMultiUserTaskStore({ tasksRepo: repo, images, storage }) };
}

describe('multi-user task store: insert + isolation', () => {
  it('insertTask records user_id on task and every item', async () => {
    const { repo, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 2 }, 2);
    expect(repo.createTask).toHaveBeenCalledWith('42', expect.objectContaining({ id: 't1', mode: 'm' }));
    expect(repo.createItem).toHaveBeenCalledWith('42', expect.objectContaining({ taskId: 't1', itemIndex: 0 }));
    expect(repo.createItem).toHaveBeenCalledWith('42', expect.objectContaining({ taskId: 't1', itemIndex: 1 }));
  });

  it('getRequest returns request + status for the owner only', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    const r = await store.getRequest('t1', '42');
    expect(r.request.parallelCount).toBe(1);
    expect(r.status).toBe('queued');
    const other = await store.getRequest('t1', '99');
    expect(other.request).toBeNull();
  });
});

describe('multi-user task store: images to MinIO', () => {
  it('saveItemImages uploads buffers and stores object keys', async () => {
    const { repo, images, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    const keys = await store.saveItemImages('t1', '42', 0, [{ kind: 'base64', data: 'aGk=', mime: 'image/png' }]);
    expect(images.saveBuffer).toHaveBeenCalledWith('42', expect.any(Buffer), 'image/png');
    expect(keys).toEqual(['42/generation/uuid.png']);
    expect(repo.updateItem).toHaveBeenCalledWith('42', 't1', 0, expect.objectContaining({ status: 'completed', objectKeys: ['42/generation/uuid.png'] }));
  });

  it('saveItemImages handles remote url images', async () => {
    const { images, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    const keys = await store.saveItemImages('t1', '42', 0, [{ kind: 'url', data: 'https://r/img' }]);
    expect(images.saveFromUrl).toHaveBeenCalledWith('42', 'https://r/img');
    expect(keys).toEqual(['42/generation/remote.webp']);
  });
});

describe('multi-user task store: processing + item failure', () => {
  it('markProcessing flips task and item statuses for the owner', async () => {
    const { repo, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 2 }, 2);
    await store.markProcessing('t1', '42', 2);
    expect(repo.updateTask).toHaveBeenCalledWith('42', 't1', { status: 'processing' });
    expect(repo.updateItem).toHaveBeenCalledWith('42', 't1', 0, { status: 'processing' });
    expect(repo.updateItem).toHaveBeenCalledWith('42', 't1', 1, { status: 'processing' });
  });

  it('markItemFailed records error scoped to user', async () => {
    const { repo, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.markItemFailed('t1', '42', 0, 'boom');
    expect(repo.updateItem).toHaveBeenCalledWith('42', 't1', 0, expect.objectContaining({ status: 'failed', error: 'boom' }));
  });
});

describe('multi-user task store: finalize + serialize with presigned urls', () => {
  it('finalize completed stores result and serialize returns signed urls', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.saveItemImages('t1', '42', 0, [{ kind: 'base64', data: 'aGk=', mime: 'image/png' }]);
    await store.finalizeTask('t1', '42', { images: ['42/generation/uuid.png'], errors: [], ttlMs: 1000 });
    const t = await store.serialize('t1', '42');
    expect(t.status).toBe('completed');
    expect(t.result.images[0]).toBe('URL:https://signed/42/generation/uuid.png');
  });

  it('serialize 给预签名 url 加 URL: 前缀(让前端下载缓存后再 ack,避免清理后 404)', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.saveItemImages('t1', '42', 0, [{ kind: 'base64', data: 'aGk=', mime: 'image/png' }]);
    await store.finalizeTask('t1', '42', { images: ['42/generation/a.png'], errors: [], ttlMs: 1000 });
    const t = await store.serialize('t1', '42');
    expect(t.result.images.every((u) => u.startsWith('URL:'))).toBe(true);
    expect(t.result.images.length).toBeGreaterThan(0);
  });

  it('serialize returns null when not owner', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    expect(await store.serialize('t1', '99')).toBeNull();
  });

  it('serialize returns expired sentinel when past expiry', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.finalizeTask('t1', '42', { images: ['42/generation/uuid.png'], errors: [], ttlMs: -1000 });
    const t = await store.serialize('t1', '42');
    expect(t.status).toBe('expired');
  });

  it('finalize failed marks task failed', async () => {
    const { repo, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.finalizeTask('t1', '42', { images: [], errors: ['x'], ttlMs: 1000 });
    expect(repo.updateTask).toHaveBeenCalledWith('42', 't1', expect.objectContaining({ status: 'failed' }));
  });
});

describe('multi-user task store: delete + ttl + owner', () => {
  it('deleteTask removes MinIO objects then PG rows scoped to user', async () => {
    const { repo, images, store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.saveItemImages('t1', '42', 0, [{ kind: 'base64', data: 'aGk=', mime: 'image/png' }]);
    await store.deleteTask('t1', '42');
    expect(images.deleteKeys).toHaveBeenCalledWith('42', ['42/generation/uuid.png']);
    expect(repo.removeTask).toHaveBeenCalledWith('42', 't1');
  });

  it('getOwner returns the task user_id', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    expect(await store.getOwner('t1')).toBe('42');
    expect(await store.getOwner('ghost')).toBeNull();
  });

  it('deleteTask still removes PG rows when MinIO deletion throws', async () => {
    const images = makeImages();
    images.deleteKeys = vi.fn(async () => { throw new Error('minio down'); });
    const { repo, store } = makeStore({ images });
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.saveItemImages('t1', '42', 0, [{ kind: 'base64', data: 'aGk=', mime: 'image/png' }]);
    await store.deleteTask('t1', '42');
    expect(repo.removeTask).toHaveBeenCalledWith('42', 't1');
  });

  it('findExpiredIds returns expired task ids', async () => {
    const { store } = makeStore();
    await store.insertTask('t1', '42', 'm', { mode: 'm', parallelCount: 1 }, 1);
    await store.finalizeTask('t1', '42', { images: ['42/generation/uuid.png'], errors: [], ttlMs: -1000 });
    const ids = await store.findExpiredIds(new Date());
    expect(ids).toContain('t1');
  });
});
