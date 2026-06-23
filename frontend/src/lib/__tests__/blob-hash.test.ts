import { describe, it, expect, vi, afterEach } from 'vitest';
import { hashBlob } from '@/lib/blob-hash';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** jsdom 的 Blob 缺少 arrayBuffer();构造一个与浏览器一致的 blob-like。 */
function makeBlob(text: string, type = 'text/plain'): Blob {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as Blob;
}

describe('hashBlob', () => {
  it('returns a stable SHA-256 hex when crypto.subtle is available', async () => {
    const a = await hashBlob(makeBlob('hello'));
    const b = await hashBlob(makeBlob('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different content', async () => {
    const a = await hashBlob(makeBlob('a'));
    const b = await hashBlob(makeBlob('b'));
    expect(a).not.toBe(b);
  });

  it('falls back to an fnv32 hash when subtle is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const h = await hashBlob(makeBlob('xyz'));
    expect(h).toMatch(/^fnv32-\d+-[0-9a-f]{8}$/);
  });
});
