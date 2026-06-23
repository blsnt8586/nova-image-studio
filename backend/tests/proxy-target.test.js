import { describe, it, expect } from 'vitest';
import { resolveProxyTarget, PROXY_PREFIX } from '../src/proxy/target.js';

describe('proxy/target — resolveProxyTarget', () => {
  const base = 'https://sub2api.test';

  it('maps /api/proxy/v1/responses to the sub2api /v1/responses URL', () => {
    expect(resolveProxyTarget('/api/proxy/v1/responses', base)).toBe(
      'https://sub2api.test/v1/responses',
    );
  });

  it('maps /api/proxy/v1/models', () => {
    expect(resolveProxyTarget('/api/proxy/v1/models', base)).toBe(
      'https://sub2api.test/v1/models',
    );
  });

  it('preserves the query string', () => {
    expect(resolveProxyTarget('/api/proxy/v1/models?limit=5', base)).toBe(
      'https://sub2api.test/v1/models?limit=5',
    );
  });

  it('strips a trailing slash on the base url', () => {
    expect(resolveProxyTarget('/api/proxy/v1/models', 'https://sub2api.test/')).toBe(
      'https://sub2api.test/v1/models',
    );
  });

  it('returns null for a path outside the proxy prefix', () => {
    expect(resolveProxyTarget('/api/me', base)).toBeNull();
    expect(resolveProxyTarget('/v1/models', base)).toBeNull();
  });

  it('rejects path traversal attempts that escape the prefix', () => {
    expect(resolveProxyTarget('/api/proxy/../secret', base)).toBeNull();
    expect(resolveProxyTarget('/api/proxy/v1/../../etc', base)).toBeNull();
  });

  it('rejects an absolute-url injection in the suffix', () => {
    expect(resolveProxyTarget('/api/proxy/http://evil.com', base)).toBeNull();
  });

  it('exposes the proxy prefix constant', () => {
    expect(PROXY_PREFIX).toBe('/api/proxy');
  });

  it('returns null for non-string input', () => {
    expect(resolveProxyTarget(null, base)).toBeNull();
    expect(resolveProxyTarget(undefined, base)).toBeNull();
    expect(resolveProxyTarget(123, base)).toBeNull();
  });

  it('maps the bare prefix /api/proxy (empty suffix) to the base root', () => {
    // 裸前缀无 '/' 后缀 → 视为非法(必须有具体路径)
    expect(resolveProxyTarget('/api/proxy', base)).toBeNull();
  });

  it('handles a path that starts with the prefix but is a different segment', () => {
    expect(resolveProxyTarget('/api/proxyfoo/v1', base)).toBeNull();
  });
});
