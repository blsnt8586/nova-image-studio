import { describe, it, expect, vi } from 'vitest';
import { normalizeGeneratedImage, createTaskEngine } from '../src/tasks/task-engine.js';

describe('normalizeGeneratedImage', () => {
  it('parses a single base64 image', () => {
    const out = normalizeGeneratedImage('aGVsbG8=');
    expect(out).toEqual([{ kind: 'base64', data: 'aGVsbG8=', mime: 'image/png' }]);
  });

  it('parses a single URL image', () => {
    const out = normalizeGeneratedImage('URL:https://r/img.png');
    expect(out).toEqual([{ kind: 'url', data: 'https://r/img.png', mime: 'image/png' }]);
  });

  it('expands MULTI_URL into multiple url entries', () => {
    const out = normalizeGeneratedImage('MULTI_URL:https://r/a.png|||https://r/b.png');
    expect(out).toEqual([
      { kind: 'url', data: 'https://r/a.png', mime: 'image/png' },
      { kind: 'url', data: 'https://r/b.png', mime: 'image/png' },
    ]);
  });
});

function makeStore() {
  return {
    getRequest: vi.fn(async () => ({ request: { parallelCount: 2 }, status: 'queued' })),
    markProcessing: vi.fn(async () => {}),
    saveItemImages: vi.fn(async (taskId, userId, index) => [`k-${index}`]),
    markItemFailed: vi.fn(async () => {}),
    finalizeTask: vi.fn(async () => {}),
  };
}

describe('task-engine runTask', () => {
  it('marks processing, generates each item, saves images, finalizes completed', async () => {
    const store = makeStore();
    const generate = vi.fn(async () => 'aGk='); // base64
    const broadcast = vi.fn();
    const engine = createTaskEngine({ store, generate, broadcast, ttlMs: 1000 });

    await engine.runTask('t1', '42', 'apikey');

    expect(store.markProcessing).toHaveBeenCalledWith('t1', '42', 2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(store.saveItemImages).toHaveBeenCalledTimes(2);
    expect(store.finalizeTask).toHaveBeenCalledWith('t1', '42', expect.objectContaining({
      images: ['k-0', 'k-1'],
      errors: [],
      ttlMs: 1000,
    }));
    expect(broadcast).toHaveBeenCalledWith('t1');
  });

  it('records per-item failures and still finalizes with partial images', async () => {
    const store = makeStore();
    const generate = vi.fn()
      .mockResolvedValueOnce('aGk=')
      .mockRejectedValueOnce(new Error('upstream 500'));
    const engine = createTaskEngine({ store, generate, broadcast: vi.fn(), ttlMs: 1000 });

    await engine.runTask('t1', '42', 'apikey');

    expect(store.markItemFailed).toHaveBeenCalledWith('t1', '42', 1, expect.stringContaining('upstream 500'));
    const finalizeArg = store.finalizeTask.mock.calls[0][2];
    expect(finalizeArg.images).toEqual(['k-0']);
    expect(finalizeArg.errors.length).toBe(1);
  });

  it('finalizes failed when all items fail', async () => {
    const store = makeStore();
    const generate = vi.fn(async () => { throw new Error('boom'); });
    const engine = createTaskEngine({ store, generate, broadcast: vi.fn(), ttlMs: 1000 });

    await engine.runTask('t1', '42', 'apikey');

    const finalizeArg = store.finalizeTask.mock.calls[0][2];
    expect(finalizeArg.images).toEqual([]);
    expect(finalizeArg.errors.length).toBe(2);
  });

  it('aborts early if task is not queued (already running/gone)', async () => {
    const store = makeStore();
    store.getRequest = vi.fn(async () => ({ request: null, status: null }));
    const generate = vi.fn();
    const engine = createTaskEngine({ store, generate, broadcast: vi.fn(), ttlMs: 1000 });

    await engine.runTask('t1', '42', 'apikey');
    expect(generate).not.toHaveBeenCalled();
    expect(store.finalizeTask).not.toHaveBeenCalled();
  });

  it('uses refImages from runtime when provided', async () => {
    const store = makeStore();
    store.getRequest = vi.fn(async () => ({ request: { parallelCount: 1 }, status: 'queued' }));
    const generate = vi.fn(async () => 'aGk=');
    const engine = createTaskEngine({ store, generate, broadcast: vi.fn(), ttlMs: 1000 });

    await engine.runTask('t1', '42', 'apikey', [{ mimeType: 'image/png' }]);
    const passedRequest = generate.mock.calls[0][1];
    expect(passedRequest.images).toEqual([{ mimeType: 'image/png' }]);
  });
});
