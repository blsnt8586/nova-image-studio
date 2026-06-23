import { describe, it, expect, vi } from 'vitest';
import { verifyToken, __cacheKeyFor } from '../src/auth/verify.js';

/**
 * 构造可注入依赖的桩。
 */
function makeDeps(overrides = {}) {
  const redisStore = new Map();
  const redis = {
    get: vi.fn(async (k) => (redisStore.has(k) ? redisStore.get(k) : null)),
    set: vi.fn(async (k, v) => {
      redisStore.set(k, v);
    }),
    // ioredis-style: set(key, val, 'EX', ttl)
  };
  return {
    redis,
    fetchImpl: vi.fn(),
    baseUrl: 'https://sub2api.test',
    cacheTtl: 60,
    redisStore,
    ...overrides,
  };
}

function profileResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  };
}

describe('auth/verify', () => {
  it('returns identity on a valid token by calling /api/v1/user/profile', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue(
      profileResponse({ id: 42, role: 'user', email: 'a@b.com' }),
    );

    const identity = await verifyToken('jwt-good', deps);

    expect(identity).toEqual({ userId: 42, role: 'user', email: 'a@b.com' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe('https://sub2api.test/api/v1/user/profile');
    expect(opts.headers.Authorization).toBe('Bearer jwt-good');
  });

  it('caches the identity and does not hit sub2api on the second call', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue(
      profileResponse({ id: 7, role: 'admin', email: 'x@y.com' }),
    );

    const first = await verifyToken('jwt-cache', deps);
    const second = await verifyToken('jwt-cache', deps);

    expect(first).toEqual(second);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.redis.set).toHaveBeenCalled();
  });

  it('reads identity from cache without calling fetch when cached', async () => {
    const deps = makeDeps();
    const key = __cacheKeyFor('jwt-precached');
    deps.redisStore.set(
      key,
      JSON.stringify({ userId: 9, role: 'user', email: 'c@d.com' }),
    );

    const identity = await verifyToken('jwt-precached', deps);

    expect(identity).toEqual({ userId: 9, role: 'user', email: 'c@d.com' });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null on 401 (invalid/expired token)', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const identity = await verifyToken('jwt-bad', deps);

    expect(identity).toBeNull();
    expect(deps.redis.set).not.toHaveBeenCalled();
  });

  it('returns null on 403 (banned/forbidden)', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    expect(await verifyToken('jwt-banned', deps)).toBeNull();
  });

  it('returns null for empty/missing token without calling fetch', async () => {
    const deps = makeDeps();
    expect(await verifyToken('', deps)).toBeNull();
    expect(await verifyToken(null, deps)).toBeNull();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('throws 503-style error when sub2api is unreachable', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(verifyToken('jwt-net', deps)).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503-style error on sub2api 5xx', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });

    await expect(verifyToken('jwt-5xx', deps)).rejects.toMatchObject({ status: 503 });
  });

  it('does not let a malformed cache entry crash verification', async () => {
    const deps = makeDeps();
    deps.redisStore.set(__cacheKeyFor('jwt-corrupt'), '{not-json');
    deps.fetchImpl.mockResolvedValue(
      profileResponse({ id: 1, role: 'user', email: 'e@f.com' }),
    );

    const identity = await verifyToken('jwt-corrupt', deps);
    expect(identity).toEqual({ userId: 1, role: 'user', email: 'e@f.com' });
  });

  it('works without a redis client (cache disabled)', async () => {
    const deps = makeDeps({ redis: null });
    deps.fetchImpl.mockResolvedValue(
      profileResponse({ id: 2, role: 'user', email: 'g@h.com' }),
    );

    const identity = await verifyToken('jwt-noredis', deps);
    expect(identity).toEqual({ userId: 2, role: 'user', email: 'g@h.com' });
  });

  it('returns null when profile data has no id', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue(profileResponse({ role: 'user', email: 'n@o.com' }));

    expect(await verifyToken('jwt-noid', deps)).toBeNull();
  });

  it('defaults role to "user" and email to "" when absent', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue(profileResponse({ id: 8 }));

    expect(await verifyToken('jwt-partial', deps)).toEqual({
      userId: 8,
      role: 'user',
      email: '',
    });
  });

  it('still returns identity when caching the result fails', async () => {
    const deps = makeDeps();
    deps.redis.set = vi.fn().mockRejectedValue(new Error('redis down'));
    deps.fetchImpl.mockResolvedValue(profileResponse({ id: 4, role: 'user', email: 'p@q.com' }));

    expect(await verifyToken('jwt-setfail', deps)).toEqual({
      userId: 4,
      role: 'user',
      email: 'p@q.com',
    });
  });

  it('throws 503 when sub2api returns invalid JSON', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });

    await expect(verifyToken('jwt-badjson', deps)).rejects.toMatchObject({ status: 503 });
  });
});
