import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('config/loadConfig', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/nova',
    REDIS_URL: 'redis://localhost:6379',
    SUB2API_BASE_URL: 'https://sub2api.test',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'ak',
    S3_SECRET_KEY: 'sk',
    S3_BUCKET: 'nova',
  };

  it('parses a complete env into a typed config', () => {
    const cfg = loadConfig(base);
    expect(cfg.databaseUrl).toBe(base.DATABASE_URL);
    expect(cfg.redisUrl).toBe(base.REDIS_URL);
    expect(cfg.sub2apiBaseUrl).toBe('https://sub2api.test');
    expect(cfg.s3.endpoint).toBe('http://localhost:9000');
    expect(cfg.s3.bucket).toBe('nova');
  });

  it('applies defaults for optional values', () => {
    const cfg = loadConfig(base);
    expect(cfg.s3.region).toBe('us-east-1');
    expect(cfg.tokenCacheTtl).toBe(60);
  });

  it('coerces TOKEN_CACHE_TTL to a number', () => {
    const cfg = loadConfig({ ...base, TOKEN_CACHE_TTL: '120' });
    expect(cfg.tokenCacheTtl).toBe(120);
  });

  it('defaults per-user image limits to 50', () => {
    const cfg = loadConfig(base);
    expect(cfg.limits.assets).toBe(50);
    expect(cfg.limits.generations).toBe(50);
  });

  it('reads USER_ASSET_LIMIT / USER_GENERATION_LIMIT overrides', () => {
    const cfg = loadConfig({ ...base, USER_ASSET_LIMIT: '100', USER_GENERATION_LIMIT: '200' });
    expect(cfg.limits.assets).toBe(100);
    expect(cfg.limits.generations).toBe(200);
  });

  it('falls back to 50 for non-positive / invalid limit values', () => {
    const cfg = loadConfig({ ...base, USER_ASSET_LIMIT: '0', USER_GENERATION_LIMIT: 'oops' });
    expect(cfg.limits.assets).toBe(50);
    expect(cfg.limits.generations).toBe(50);
  });

  it('strips a trailing slash from SUB2API_BASE_URL', () => {
    const cfg = loadConfig({ ...base, SUB2API_BASE_URL: 'https://sub2api.test/' });
    expect(cfg.sub2apiBaseUrl).toBe('https://sub2api.test');
  });

  it('throws listing all missing required vars', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x' })).toThrowError(/REDIS_URL/);
    try {
      loadConfig({});
    } catch (e) {
      expect(e.message).toContain('DATABASE_URL');
      expect(e.message).toContain('SUB2API_BASE_URL');
      expect(e.message).toContain('S3_BUCKET');
    }
  });
});
