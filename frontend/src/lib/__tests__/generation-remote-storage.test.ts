import { describe, it, expect, vi } from 'vitest';
import {
  uploadGenerationToBackend,
  listRemoteGenerations,
  buildRemoteGenerationJobs,
} from '@/lib/generation-remote-storage';
import { onStorageLimit } from '@/lib/storage-limit-notifier';
import { ApiError } from '@/lib/api-client';
import type { StoredJob } from '@/lib/job-store';

/** jsdom 的 Blob 缺少 arrayBuffer();构造与浏览器一致的 blob-like。 */
function makeBlob(text = 'x', type = 'image/png'): Blob {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as Blob;
}

function makeJob(over: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job-1',
    status: 'completed',
    mode: 'text-to-image',
    prompt: 'a cat',
    output_size: '1K',
    temperature: 1,
    aspect_ratio: '1:1',
    model: 'gemini-3-pro-image-preview',
    created_at: new Date().toISOString(),
    images: ['blob:x'],
    ...over,
  } as StoredJob;
}

function makeDeps(over = {}) {
  return {
    isSession: () => true,
    presignPut: vi.fn().mockResolvedValue({ url: 'https://put', objectKey: '42/generation/a.png' }),
    presignGet: vi.fn().mockResolvedValue({ url: 'https://get/a.png', objectKey: '42/generation/a.png' }),
    uploadBlob: vi.fn().mockResolvedValue(undefined),
    generationsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'g1', objectKey: '42/generation/a.png' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    getBlob: vi.fn().mockResolvedValue(makeBlob()),
    ...over,
  };
}

describe('uploadGenerationToBackend', () => {
  it('registers each image then uploads it, sending contentHash', async () => {
    const deps = makeDeps();
    const keys = await uploadGenerationToBackend(makeJob({ images: ['blob:a', 'blob:b'] }), deps);
    expect(keys).toHaveLength(2);
    expect(deps.presignPut).toHaveBeenCalledTimes(2);
    expect(deps.uploadBlob).toHaveBeenCalledTimes(2);
    expect(deps.generationsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'text-to-image',
        modelId: 'gemini-3-pro-image-preview',
        prompt: 'a cat',
        objectKey: '42/generation/a.png',
        contentHash: expect.stringMatching(/.+/),
      }),
    );
  });

  it('skips the blob upload on a dedup hit (server returns a different objectKey)', async () => {
    const deps = makeDeps();
    deps.generationsApi.create.mockResolvedValue({ id: 'old', objectKey: '42/generation/old.png' });
    const keys = await uploadGenerationToBackend(makeJob({ images: ['blob:a'] }), deps);
    expect(keys).toEqual(['42/generation/old.png']);
    expect(deps.uploadBlob).not.toHaveBeenCalled();
  });

  it('notifies storage-limit on a 409 and stops uploading further images', async () => {
    const deps = makeDeps({ generationsApi: {
      list: vi.fn(),
      create: vi.fn().mockRejectedValue(new ApiError('已达上限', 409)),
      remove: vi.fn(),
    } });
    const events: Array<{ kind: string }> = [];
    const off = onStorageLimit(e => events.push(e));
    const keys = await uploadGenerationToBackend(makeJob({ images: ['blob:a', 'blob:b'] }), deps);
    off();
    expect(keys).toEqual([]);
    expect(deps.uploadBlob).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ kind: 'generation' })]);
  });

  it('rolls back the row when the blob upload fails', async () => {
    const deps = makeDeps({ uploadBlob: vi.fn().mockRejectedValue(new Error('boom')) });
    const keys = await uploadGenerationToBackend(makeJob({ images: ['blob:a'] }), deps);
    expect(keys).toEqual([]);
    expect(deps.generationsApi.remove).toHaveBeenCalledWith('g1');
  });

  it('no-ops without a session', async () => {
    const deps = makeDeps({ isSession: () => false });
    const keys = await uploadGenerationToBackend(makeJob(), deps);
    expect(keys).toEqual([]);
    expect(deps.presignPut).not.toHaveBeenCalled();
  });

  it('skips non-completed jobs', async () => {
    const deps = makeDeps();
    const keys = await uploadGenerationToBackend(makeJob({ status: 'processing' }), deps);
    expect(keys).toEqual([]);
  });

  it('skips an image when its blob is unavailable', async () => {
    const deps = makeDeps({ getBlob: vi.fn().mockResolvedValue(null) });
    const keys = await uploadGenerationToBackend(makeJob(), deps);
    expect(keys).toEqual([]);
    expect(deps.generationsApi.create).not.toHaveBeenCalled();
  });

  it('best-effort: one image failing does not abort the rest', async () => {
    const presignPut = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ url: 'https://put', objectKey: '42/generation/b.png' });
    const deps = makeDeps({ presignPut });
    deps.generationsApi.create.mockResolvedValue({ id: 'g2', objectKey: '42/generation/b.png' });
    const keys = await uploadGenerationToBackend(makeJob({ images: ['blob:a', 'blob:b'] }), deps);
    expect(keys).toEqual(['42/generation/b.png']);
  });
});

describe('listRemoteGenerations', () => {
  it('lists generations and presigns a readable url for each', async () => {
    const deps = makeDeps({
      generationsApi: {
        list: vi.fn().mockResolvedValue([
          { id: 'g1', userId: '42', mode: 'text-to-image', modelId: 'm', prompt: 'p', objectKey: '42/generation/a.png', createdAt: 't1' },
        ]),
        create: vi.fn(),
      },
    });
    const rows = await listRemoteGenerations(deps);
    expect(rows).toEqual([
      { id: 'g1', mode: 'text-to-image', modelId: 'm', prompt: 'p', url: 'https://get/a.png', createdAt: 't1' },
    ]);
  });

  it('returns [] without a session', async () => {
    const deps = makeDeps({ isSession: () => false });
    expect(await listRemoteGenerations(deps)).toEqual([]);
  });

  it('returns [] when list fails', async () => {
    const deps = makeDeps({
      generationsApi: { list: vi.fn().mockRejectedValue(new Error('net')), create: vi.fn() },
    });
    expect(await listRemoteGenerations(deps)).toEqual([]);
  });
});

describe('buildRemoteGenerationJobs', () => {
  function listDeps(rows: unknown[], over = {}) {
    return makeDeps({
      generationsApi: { list: vi.fn().mockResolvedValue(rows), create: vi.fn() },
      ...over,
    });
  }

  it('maps remote generations into synthetic completed jobs (image via URL:)', async () => {
    const deps = listDeps([
      { id: 'g1', userId: '42', mode: 'image-to-image', modelId: 'm2', prompt: 'p1', objectKey: '42/generation/a.png', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    const jobs = await buildRemoteGenerationJobs([], deps);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'remote-g1',
      status: 'completed',
      mode: 'image-to-image',
      model: 'm2',
      prompt: 'p1',
      imageData: 'URL:https://get/a.png',
      images: ['URL:https://get/a.png'],
      remoteGenerationId: 'g1',
    });
  });

  it('skips remote rows already present locally (by remoteGenerationId)', async () => {
    const deps = listDeps([
      { id: 'g1', userId: '42', mode: 'text-to-image', modelId: 'm', prompt: 'p', objectKey: '42/generation/a.png', createdAt: 't1' },
      { id: 'g2', userId: '42', mode: 'text-to-image', modelId: 'm', prompt: 'q', objectKey: '42/generation/b.png', createdAt: 't2' },
    ]);
    const existing = [makeJob({ id: 'x', remoteGenerationId: 'g1' })];
    const jobs = await buildRemoteGenerationJobs(existing, deps);
    expect(jobs.map(j => j.remoteGenerationId)).toEqual(['g2']);
  });

  it('returns [] without a session', async () => {
    const deps = listDeps([{ id: 'g1' }], { isSession: () => false });
    expect(await buildRemoteGenerationJobs([], deps)).toEqual([]);
  });

  it('returns [] when there is nothing remote', async () => {
    expect(await buildRemoteGenerationJobs([], listDeps([]))).toEqual([]);
  });
});
