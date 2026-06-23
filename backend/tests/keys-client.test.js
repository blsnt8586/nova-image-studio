import { describe, it, expect, vi } from 'vitest';
import { createKeysClient } from '../src/auth/keys.js';

// 模拟一个 sub2api /api/v1/keys 分页响应
function keysResponse(items, { status = 200 } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return { code: 0, message: 'success', data: { items, total: items.length, page: 1, page_size: 100, pages: 1 } };
    },
  };
}

function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
  };
}

const SK1 = 'sk-aaaaaaaaaaaaaaaaaaaa';
const SK2 = 'sk-bbbbbbbbbbbbbbbbbbbb';
const ITEMS = [
  { id: 1, key: SK1, name: '画布API', status: 'enabled' },
  { id: 2, key: SK2, name: '备用', status: 'enabled' },
];

const deps = (fetchImpl, redis) => ({
  fetchImpl,
  redis,
  baseUrl: 'https://sub2api.test',
  cacheTtl: 30,
});

describe('auth/keys — createKeysClient.listKeys', () => {
  it('lists keys stripped of the secret body (only id/name/status)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse(ITEMS));
    const client = createKeysClient(deps(fetchImpl, null));

    const list = await client.listKeys('jwt-user');

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain('https://sub2api.test/api/v1/keys');
    expect(opts.headers.Authorization).toBe('Bearer jwt-user');
    expect(list).toEqual([
      { id: 1, name: '画布API', status: 'enabled' },
      { id: 2, name: '备用', status: 'enabled' },
    ]);
    // 绝不泄露 sk- key
    expect(JSON.stringify(list)).not.toContain('sk-');
  });

  it('returns null when the token is rejected (401/403)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 401, ok: false, async json() { return {}; } });
    const client = createKeysClient(deps(fetchImpl, null));
    expect(await client.listKeys('bad')).toBeNull();
  });

  it('throws a 503-tagged error when sub2api is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = createKeysClient(deps(fetchImpl, null));
    await expect(client.listKeys('jwt')).rejects.toMatchObject({ status: 503 });
  });
});

describe('auth/keys — createKeysClient.resolveKey', () => {
  it('resolves a specific keyId to its sk- secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse(ITEMS));
    const client = createKeysClient(deps(fetchImpl, null));

    const key = await client.resolveKey({ token: 'jwt', keyId: 2, userId: 7 });
    expect(key).toBe(SK2);
  });

  it('falls back to the first key when keyId is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse(ITEMS));
    const client = createKeysClient(deps(fetchImpl, null));

    const key = await client.resolveKey({ token: 'jwt', keyId: null, userId: 7 });
    expect(key).toBe(SK1);
  });

  it('returns null when the keyId does not match any key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse(ITEMS));
    const client = createKeysClient(deps(fetchImpl, null));

    expect(await client.resolveKey({ token: 'jwt', keyId: 999, userId: 7 })).toBeNull();
  });

  it('returns null when the user has no keys', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse([]));
    const client = createKeysClient(deps(fetchImpl, null));

    expect(await client.resolveKey({ token: 'jwt', keyId: null, userId: 7 })).toBeNull();
  });

  it('caches the resolved secret per user+keyId and skips the second fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse(ITEMS));
    const redis = fakeRedis();
    const client = createKeysClient(deps(fetchImpl, redis));

    const a = await client.resolveKey({ token: 'jwt', keyId: 1, userId: 7 });
    const b = await client.resolveKey({ token: 'jwt', keyId: 1, userId: 7 });

    expect(a).toBe(SK1);
    expect(b).toBe(SK1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 第二次命中缓存
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('7'),
      SK1,
      'EX',
      30,
    );
  });

  it('does not cache the secret under a key that exposes the raw token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(keysResponse(ITEMS));
    const redis = fakeRedis();
    const client = createKeysClient(deps(fetchImpl, redis));
    await client.resolveKey({ token: 'jwt-secret-token', keyId: 1, userId: 7 });

    const cacheKey = redis.set.mock.calls[0][0];
    expect(cacheKey).not.toContain('jwt-secret-token');
  });

  it('throws a 503-tagged error when sub2api is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const client = createKeysClient(deps(fetchImpl, null));
    await expect(client.resolveKey({ token: 'jwt', keyId: 1, userId: 7 })).rejects.toMatchObject({ status: 503 });
  });
});
