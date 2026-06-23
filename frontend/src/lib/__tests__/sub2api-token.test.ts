import { beforeEach, describe, expect, it } from 'vitest';
import {
  SUB2API_PROXY_API_KEY,
  getSub2apiToken,
  setSub2apiToken,
  clearSub2apiToken,
  resolveAuthApiKey,
} from '@/lib/sub2api-token';

describe('sub2api-token', () => {
  beforeEach(() => {
    clearSub2apiToken();
    window.sessionStorage.clear();
  });

  it('exposes a non-secret sentinel api key', () => {
    expect(typeof SUB2API_PROXY_API_KEY).toBe('string');
    expect(SUB2API_PROXY_API_KEY.length).toBeGreaterThan(0);
    // 不应该是某种看起来像真 key 的东西
    expect(SUB2API_PROXY_API_KEY).not.toMatch(/^sk-/);
  });

  it('stores and reads the token from sessionStorage', () => {
    setSub2apiToken('jwt-abc');
    expect(getSub2apiToken()).toBe('jwt-abc');
    expect(window.sessionStorage.getItem('sub2api-token')).toBe('jwt-abc');
  });

  it('returns null when no token is set', () => {
    expect(getSub2apiToken()).toBeNull();
  });

  it('reads token back from sessionStorage even without an in-memory copy', () => {
    window.sessionStorage.setItem('sub2api-token', 'jwt-persisted');
    expect(getSub2apiToken()).toBe('jwt-persisted');
  });

  it('clears the token from memory and sessionStorage', () => {
    setSub2apiToken('jwt-x');
    clearSub2apiToken();
    expect(getSub2apiToken()).toBeNull();
    expect(window.sessionStorage.getItem('sub2api-token')).toBeNull();
  });

  it('ignores empty/whitespace tokens on set', () => {
    setSub2apiToken('   ');
    expect(getSub2apiToken()).toBeNull();
  });

  describe('resolveAuthApiKey', () => {
    it('returns the live JWT when the model key is the sentinel', () => {
      setSub2apiToken('jwt-live');
      expect(resolveAuthApiKey(SUB2API_PROXY_API_KEY)).toBe('jwt-live');
    });

    it('returns the original key for non-sentinel (user-configured) models', () => {
      expect(resolveAuthApiKey('sk-user-key')).toBe('sk-user-key');
    });

    it('returns the sentinel itself when no live token is available (degraded)', () => {
      clearSub2apiToken();
      expect(resolveAuthApiKey(SUB2API_PROXY_API_KEY)).toBe(SUB2API_PROXY_API_KEY);
    });
  });
});
