import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCanvasPersistStorage } from '@/lib/canvas-remote-storage';

function makeLocal() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: vi.fn(async (k: string) => map.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { map.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { map.delete(k); }),
  };
}

const WORKSPACE = { snapshotJson: { state: { projects: [{ id: 'p1' }] }, version: 0 } };

describe('createCanvasPersistStorage — local mode (no session)', () => {
  it('reads/writes through to localForage when not in a sub2api session', async () => {
    const local = makeLocal();
    const storage = createCanvasPersistStorage({
      local,
      isSession: () => false,
      canvasesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
    });

    await storage.setItem('k', { state: { projects: [{ id: 'p1' }] }, version: 0 });
    expect(local.setItem).toHaveBeenCalled();

    const value = await storage.getItem('k');
    expect(value?.state.projects).toEqual([{ id: 'p1' }]);
  });
});

describe('createCanvasPersistStorage — remote mode (sub2api session)', () => {
  let canvasesApi: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    canvasesApi = { list: vi.fn(), create: vi.fn(), update: vi.fn() };
  });

  it('getItem loads the workspace canvas snapshot from backend', async () => {
    canvasesApi.list.mockResolvedValue([{ id: 'cv1', name: 'workspace', ...WORKSPACE }]);
    const storage = createCanvasPersistStorage({ local: makeLocal(), isSession: () => true, canvasesApi });

    const value = await storage.getItem('k');
    expect(value?.state.projects).toEqual([{ id: 'p1' }]);
    expect(canvasesApi.list).toHaveBeenCalled();
  });

  it('getItem returns null when backend has no workspace canvas yet', async () => {
    canvasesApi.list.mockResolvedValue([]);
    const storage = createCanvasPersistStorage({ local: makeLocal(), isSession: () => true, canvasesApi });
    expect(await storage.getItem('k')).toBeNull();
  });

  it('setItem creates the workspace canvas on first write', async () => {
    canvasesApi.list.mockResolvedValue([]);
    canvasesApi.create.mockResolvedValue({ id: 'cv1' });
    const storage = createCanvasPersistStorage({ local: makeLocal(), isSession: () => true, canvasesApi });

    await storage.setItem('k', { state: { projects: [{ id: 'p1' }] }, version: 0 });
    expect(canvasesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      snapshotJson: expect.objectContaining({ state: expect.objectContaining({ projects: [{ id: 'p1' }] }) }),
    }));
  });

  it('setItem updates the existing workspace canvas on later writes', async () => {
    canvasesApi.list.mockResolvedValue([{ id: 'cv1', name: 'workspace', ...WORKSPACE }]);
    canvasesApi.update.mockResolvedValue({ id: 'cv1' });
    const storage = createCanvasPersistStorage({ local: makeLocal(), isSession: () => true, canvasesApi });

    // 先 get 让它发现已有 cv1
    await storage.getItem('k');
    await storage.setItem('k', { state: { projects: [{ id: 'p2' }] }, version: 0 });
    expect(canvasesApi.update).toHaveBeenCalledWith('cv1', expect.objectContaining({
      snapshotJson: expect.objectContaining({ state: expect.objectContaining({ projects: [{ id: 'p2' }] }) }),
    }));
    expect(canvasesApi.create).not.toHaveBeenCalled();
  });

  it('falls back to local on backend error during getItem', async () => {
    canvasesApi.list.mockRejectedValue(new Error('network'));
    const local = makeLocal();
    local.map.set('k', JSON.stringify({ state: { projects: [{ id: 'local' }] }, version: 0 }));
    const storage = createCanvasPersistStorage({ local, isSession: () => true, canvasesApi });

    const value = await storage.getItem('k');
    expect(value?.state.projects).toEqual([{ id: 'local' }]);
  });
});
