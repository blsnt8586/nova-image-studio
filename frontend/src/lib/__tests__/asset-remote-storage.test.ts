import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadAssetToBackend, listRemoteAssets } from '@/lib/asset-remote-storage';
import { onStorageLimit } from '@/lib/storage-limit-notifier';
import { ApiError } from '@/lib/api-client';
import type { ImageAsset } from '@/lib/asset-store';

function makeAsset(over: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: 'a1',
    kind: 'image',
    blobKey: 'hash',
    hash: 'hash',
    name: 'cat.png',
    mimeType: 'image/png',
    sizeBytes: 3,
    tags: [],
    note: '',
    sourceKind: 'upload',
    sourceLabel: '用户上传',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  };
}

function makeDeps(over = {}) {
  return {
    isSession: () => true,
    presignPut: vi.fn().mockResolvedValue({ url: 'https://put', objectKey: '42/asset/a.png' }),
    presignGet: vi.fn().mockResolvedValue({ url: 'https://get/a.png', objectKey: '42/asset/a.png' }),
    uploadBlob: vi.fn().mockResolvedValue(undefined),
    assetsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'a1', objectKey: '42/asset/a.png' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    ...over,
  };
}

describe('uploadAssetToBackend', () => {
  it('registers the row then uploads the blob, sending contentHash', async () => {
    const deps = makeDeps();
    const blob = new Blob(['x'], { type: 'image/png' });
    const key = await uploadAssetToBackend(makeAsset({ hash: 'sha-1' }), blob, deps);
    expect(key).toBe('42/asset/a.png');
    expect(deps.assetsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: '42/asset/a.png', kind: 'image', name: 'cat.png', size: 1, contentHash: 'sha-1' }),
    );
    expect(deps.uploadBlob).toHaveBeenCalledWith('https://put', blob);
  });

  it('skips the blob upload on a dedup hit (server returns a different objectKey)', async () => {
    const deps = makeDeps();
    deps.assetsApi.create.mockResolvedValue({ id: 'old', objectKey: '42/asset/old.png' });
    const key = await uploadAssetToBackend(makeAsset({ hash: 'dup' }), new Blob(['x'], { type: 'image/png' }), deps);
    expect(key).toBe('42/asset/old.png');
    expect(deps.uploadBlob).not.toHaveBeenCalled();
  });

  it('rolls back the row when the blob upload fails', async () => {
    const deps = makeDeps({ uploadBlob: vi.fn().mockRejectedValue(new Error('boom')) });
    const key = await uploadAssetToBackend(makeAsset(), new Blob(['x'], { type: 'image/png' }), deps);
    expect(key).toBeNull();
    expect(deps.assetsApi.remove).toHaveBeenCalledWith('a1');
  });

  it('notifies storage-limit on a 409 and does not upload', async () => {
    const deps = makeDeps({ assetsApi: {
      list: vi.fn(),
      create: vi.fn().mockRejectedValue(new ApiError('已达上限', 409)),
      remove: vi.fn(),
    } });
    const events: Array<{ kind: string }> = [];
    const off = onStorageLimit(e => events.push(e));
    const key = await uploadAssetToBackend(makeAsset(), new Blob(['x'], { type: 'image/png' }), deps);
    off();
    expect(key).toBeNull();
    expect(deps.uploadBlob).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ kind: 'asset' })]);
  });

  it('no-ops without a session', async () => {
    const deps = makeDeps({ isSession: () => false });
    const key = await uploadAssetToBackend(makeAsset(), new Blob(['x']), deps);
    expect(key).toBeNull();
    expect(deps.presignPut).not.toHaveBeenCalled();
  });

  it('returns null (best-effort) when presign fails', async () => {
    const deps = makeDeps({ presignPut: vi.fn().mockRejectedValue(new Error('boom')) });
    const key = await uploadAssetToBackend(makeAsset(), new Blob(['x'], { type: 'image/png' }), deps);
    expect(key).toBeNull();
  });
});

describe('listRemoteAssets', () => {
  it('lists assets and presigns urls', async () => {
    const deps = makeDeps({
      assetsApi: {
        list: vi.fn().mockResolvedValue([
          { id: 'a1', userId: '42', objectKey: '42/asset/a.png', mime: 'image/png', size: 10, kind: 'image', name: 'cat', createdAt: 't1' },
        ]),
        create: vi.fn(),
      },
    });
    const rows = await listRemoteAssets(deps);
    expect(rows).toEqual([
      { id: 'a1', objectKey: '42/asset/a.png', name: 'cat', mime: 'image/png', size: 10, url: 'https://get/a.png', createdAt: 't1' },
    ]);
  });

  it('returns [] without a session', async () => {
    expect(await listRemoteAssets(makeDeps({ isSession: () => false }))).toEqual([]);
  });
});
