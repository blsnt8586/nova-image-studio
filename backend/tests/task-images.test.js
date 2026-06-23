import { describe, it, expect, vi } from 'vitest';
import { createTaskImageService } from '../src/tasks/task-images.js';

function makeStorage() {
  const putObject = vi.fn(async (userId, type, ext) => ({ objectKey: `${userId}/${type}/uuid.${ext}` }));
  const removeObject = vi.fn(async () => {});
  const presignGet = vi.fn(async (userId, key) => ({ url: `https://signed/${key}`, objectKey: key }));
  return { putObject, removeObject, presignGet };
}

describe('task-images saveBuffer', () => {
  it('uploads a buffer as a generation object for the user', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    const key = await svc.saveBuffer('42', Buffer.from('x'), 'image/png');
    expect(storage.putObject).toHaveBeenCalledWith('42', 'generation', 'png', expect.any(Buffer), 'image/png');
    expect(key).toBe('42/generation/uuid.png');
  });

  it('maps jpeg mime to jpg extension', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    await svc.saveBuffer('42', Buffer.from('x'), 'image/jpeg');
    expect(storage.putObject).toHaveBeenCalledWith('42', 'generation', 'jpg', expect.any(Buffer), 'image/jpeg');
  });

  it('defaults to png when mime unknown', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    await svc.saveBuffer('42', Buffer.from('x'), 'application/weird');
    expect(storage.putObject).toHaveBeenCalledWith('42', 'generation', 'png', expect.any(Buffer), 'application/weird');
  });

  it('maps gif and explicit jpg mimes', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    await svc.saveBuffer('42', Buffer.from('x'), 'image/gif');
    expect(storage.putObject).toHaveBeenLastCalledWith('42', 'generation', 'gif', expect.any(Buffer), 'image/gif');
    await svc.saveBuffer('42', Buffer.from('x'), 'image/jpg');
    expect(storage.putObject).toHaveBeenLastCalledWith('42', 'generation', 'jpg', expect.any(Buffer), 'image/jpg');
  });

  it('defaults ext to png when mime is empty/missing', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    await svc.saveBuffer('42', Buffer.from('x'));
    expect(storage.putObject).toHaveBeenLastCalledWith('42', 'generation', 'png', expect.any(Buffer), undefined);
  });
});

describe('task-images saveFromUrl', () => {
  it('downloads then uploads to MinIO', async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'image/webp' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    const svc = createTaskImageService({ storage, fetchImpl });
    const key = await svc.saveFromUrl('42', 'https://remote/img.webp');
    expect(fetchImpl).toHaveBeenCalledWith('https://remote/img.webp', expect.any(Object));
    expect(storage.putObject).toHaveBeenCalledWith('42', 'generation', 'webp', expect.any(Buffer), 'image/webp');
    expect(key).toBe('42/generation/uuid.webp');
  });

  it('throws on non-ok remote response', async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
    const svc = createTaskImageService({ storage, fetchImpl });
    await expect(svc.saveFromUrl('42', 'https://remote/missing')).rejects.toThrow();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('defaults content-type to image/png when header missing', async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    }));
    const svc = createTaskImageService({ storage, fetchImpl });
    await svc.saveFromUrl('42', 'https://remote/img');
    expect(storage.putObject).toHaveBeenCalledWith('42', 'generation', 'png', expect.any(Buffer), 'image/png');
  });
});

describe('task-images deleteKeys (TTL/user delete)', () => {
  it('removes every object key for the user, counting outcomes', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    const res = await svc.deleteKeys('42', ['42/generation/a.png', '42/generation/b.png']);
    expect(storage.removeObject).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ total: 2, success: 2, failed: 0 });
  });

  it('continues past a failing delete and counts failures', async () => {
    const storage = makeStorage();
    storage.removeObject = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = createTaskImageService({ storage });
    const res = await svc.deleteKeys('42', ['42/generation/a.png', '42/generation/b.png']);
    expect(res).toEqual({ total: 2, success: 1, failed: 1 });
  });

  it('handles empty/missing key list', async () => {
    const storage = makeStorage();
    const svc = createTaskImageService({ storage });
    expect(await svc.deleteKeys('42', [])).toEqual({ total: 0, success: 0, failed: 0 });
    expect(await svc.deleteKeys('42', null)).toEqual({ total: 0, success: 0, failed: 0 });
  });
});
