import { describe, it, expect, vi } from 'vitest';
import {
  buildObjectKey,
  isOwnedKey,
  ALLOWED_TYPES,
  createStorage,
} from '../src/storage/s3.js';

describe('storage/s3 buildObjectKey', () => {
  it('builds key as {userId}/{type}/{uuid}.{ext}', () => {
    const key = buildObjectKey('42', 'asset', 'png', () => 'uuid-1');
    expect(key).toBe('42/asset/uuid-1.png');
  });

  it('lowercases and strips leading dot from ext', () => {
    expect(buildObjectKey('1', 'generation', '.PNG', () => 'u')).toBe('1/generation/u.png');
    expect(buildObjectKey('1', 'generation', 'JPG', () => 'u')).toBe('1/generation/u.jpg');
  });

  it('defaults ext to bin when missing/invalid', () => {
    expect(buildObjectKey('1', 'asset', '', () => 'u')).toBe('1/asset/u.bin');
    expect(buildObjectKey('1', 'asset', '!!', () => 'u')).toBe('1/asset/u.bin');
  });

  it('rejects unknown type', () => {
    expect(() => buildObjectKey('1', 'evil', 'png', () => 'u')).toThrow();
  });

  it('rejects empty/invalid userId', () => {
    expect(() => buildObjectKey('', 'asset', 'png', () => 'u')).toThrow();
    expect(() => buildObjectKey('a/b', 'asset', 'png', () => 'u')).toThrow();
  });

  it('exposes the allowed types', () => {
    expect(ALLOWED_TYPES).toContain('asset');
    expect(ALLOWED_TYPES).toContain('generation');
  });
});

describe('storage/s3 isOwnedKey', () => {
  it('accepts a key under the user prefix', () => {
    expect(isOwnedKey('42', '42/asset/u.png')).toBe(true);
  });

  it('rejects another user prefix', () => {
    expect(isOwnedKey('42', '7/asset/u.png')).toBe(false);
  });

  it('rejects prefix-confusion (42x vs 42)', () => {
    expect(isOwnedKey('42', '42x/asset/u.png')).toBe(false);
  });

  it('rejects traversal and absolute keys', () => {
    expect(isOwnedKey('42', '42/../7/asset/u.png')).toBe(false);
    expect(isOwnedKey('42', '/42/asset/u.png')).toBe(false);
  });

  it('rejects empty key', () => {
    expect(isOwnedKey('42', '')).toBe(false);
  });
});

function makeDeps() {
  const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/url');
  const PutObjectCommand = vi.fn(function (input) { this.input = input; this._t = 'put'; });
  const GetObjectCommand = vi.fn(function (input) { this.input = input; this._t = 'get'; });
  const client = { _client: true };
  return { getSignedUrl, PutObjectCommand, GetObjectCommand, client };
}

describe('storage/s3 presignPut', () => {
  it('builds an owned key and returns url + key', async () => {
    const deps = makeDeps();
    const storage = createStorage({
      ...deps,
      bucket: 'nova',
      uuid: () => 'uuid-1',
    });

    const result = await storage.presignPut('42', 'asset', 'png', 'image/png');

    expect(result.objectKey).toBe('42/asset/uuid-1.png');
    expect(result.url).toBe('https://signed.example/url');
    expect(deps.PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'nova', Key: '42/asset/uuid-1.png', ContentType: 'image/png' }),
    );
    expect(deps.getSignedUrl).toHaveBeenCalledWith(deps.client, expect.any(deps.PutObjectCommand), expect.objectContaining({ expiresIn: expect.any(Number) }));
  });

  it('rejects unknown type before signing', async () => {
    const deps = makeDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });
    await expect(storage.presignPut('42', 'evil', 'png', 'image/png')).rejects.toThrow();
    expect(deps.getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('storage/s3 presignGet', () => {
  it('signs a GET for an owned key', async () => {
    const deps = makeDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });

    const result = await storage.presignGet('42', '42/asset/u.png');

    expect(result.url).toBe('https://signed.example/url');
    expect(deps.GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'nova', Key: '42/asset/u.png' }),
    );
  });

  it('refuses to sign a cross-user key', async () => {
    const deps = makeDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });

    await expect(storage.presignGet('42', '7/asset/u.png')).rejects.toThrow();
    expect(deps.getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('storage/s3 presignPut defaults', () => {
  it('defaults ContentType to octet-stream when not given', async () => {
    const deps = makeDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });
    await storage.presignPut('42', 'asset', 'png');
    expect(deps.PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ContentType: 'application/octet-stream' }),
    );
  });

  it('uses crypto.randomUUID when no uuid injected', async () => {
    const deps = makeDeps();
    const storage = createStorage({ ...deps, bucket: 'nova' });
    const result = await storage.presignPut('42', 'asset', 'png', 'image/png');
    // 形如 42/asset/<uuid>.png
    expect(result.objectKey).toMatch(/^42\/asset\/[0-9a-f-]{36}\.png$/);
  });
});

describe('storage/s3 buildObjectKey default uuid', () => {
  it('generates a real uuid when generator omitted', () => {
    const key = buildObjectKey('42', 'asset', 'png');
    expect(key).toMatch(/^42\/asset\/[0-9a-f-]{36}\.png$/);
  });
});

function makePutDeps() {
  const send = vi.fn().mockResolvedValue({});
  const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/url');
  const PutObjectCommand = vi.fn(function (input) { this.input = input; this._t = 'put'; });
  const GetObjectCommand = vi.fn(function (input) { this.input = input; this._t = 'get'; });
  const DeleteObjectCommand = vi.fn(function (input) { this.input = input; this._t = 'del'; });
  const client = { send };
  return { send, getSignedUrl, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, client };
}

describe('storage/s3 putObject (server-side upload)', () => {
  it('builds an owned generation key and sends a PutObject with the buffer', async () => {
    const deps = makePutDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'uuid-1' });
    const buf = Buffer.from('img');

    const result = await storage.putObject('42', 'generation', 'png', buf, 'image/png');

    expect(result.objectKey).toBe('42/generation/uuid-1.png');
    expect(deps.PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'nova', Key: '42/generation/uuid-1.png', Body: buf, ContentType: 'image/png' }),
    );
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown type before sending', async () => {
    const deps = makePutDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });
    await expect(storage.putObject('42', 'evil', 'png', Buffer.from('x'), 'image/png')).rejects.toThrow();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('defaults ContentType to octet-stream', async () => {
    const deps = makePutDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });
    await storage.putObject('42', 'generation', 'png', Buffer.from('x'));
    expect(deps.PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ContentType: 'application/octet-stream' }),
    );
  });
});

describe('storage/s3 removeObject', () => {
  it('sends a DeleteObject for an owned key', async () => {
    const deps = makePutDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });
    await storage.removeObject('42', '42/generation/u.png');
    expect(deps.DeleteObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'nova', Key: '42/generation/u.png' }),
    );
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('refuses to delete a cross-user key', async () => {
    const deps = makePutDeps();
    const storage = createStorage({ ...deps, bucket: 'nova', uuid: () => 'u' });
    await expect(storage.removeObject('42', '7/generation/u.png')).rejects.toThrow();
    expect(deps.send).not.toHaveBeenCalled();
  });
});
