import { describe, it, expect, vi } from 'vitest';
import { createVerify } from '../src/auth/create-verify.js';

describe('auth/create-verify', () => {
  const config = {
    redisUrl: 'redis://localhost:6379',
    sub2apiBaseUrl: 'https://sub2api.test',
    tokenCacheTtl: 30,
  };

  it('builds a verify fn that uses injected redis + fetch and config', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: 3, role: 'user', email: 'z@z.com' } }),
    });

    const verify = createVerify(config, { redis, fetchImpl });
    const identity = await verify('jwt-1');

    expect(identity).toEqual({ userId: 3, role: 'user', email: 'z@z.com' });
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sub2api.test/api/v1/user/profile');
    expect(opts.headers.Authorization).toBe('Bearer jwt-1');
  });

  it('returns null for an invalid token through the bound fn', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const verify = createVerify(config, { redis, fetchImpl });
    expect(await verify('bad')).toBeNull();
  });
});
