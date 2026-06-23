import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { compressToWebpLossless, isCompressibleMime } from '../src/tasks/image-compress.js';

/** 生成一张平滑渐变 PNG(对 WebP 无损压缩友好,确保结果更小)。 */
async function gradientPng(side = 512) {
  const channels = 3;
  const raw = Buffer.alloc(side * side * channels);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const i = (y * side + x) * channels;
      raw[i] = Math.floor((x / side) * 255);
      raw[i + 1] = Math.floor((y / side) * 255);
      raw[i + 2] = Math.floor(((x + y) / (2 * side)) * 255);
    }
  }
  return sharp(raw, { raw: { width: side, height: side, channels } }).png().toBuffer();
}

describe('isCompressibleMime', () => {
  it('accepts png/jpeg/webp, rejects gif and others', () => {
    expect(isCompressibleMime('image/png')).toBe(true);
    expect(isCompressibleMime('image/jpeg')).toBe(true);
    expect(isCompressibleMime('image/webp')).toBe(true);
    expect(isCompressibleMime('image/gif')).toBe(false);
    expect(isCompressibleMime('application/octet-stream')).toBe(false);
    expect(isCompressibleMime(undefined)).toBe(false);
  });
});

describe('compressToWebpLossless', () => {
  it('converts a PNG to smaller WebP losslessly (pixel-identical round-trip)', async () => {
    const png = await gradientPng(512);
    const res = await compressToWebpLossless(png, 'image/png');

    expect(res.compressed).toBe(true);
    expect(res.mime).toBe('image/webp');
    expect(res.buffer.length).toBeLessThan(png.length);

    // 无损校验:解码 WebP 与原 PNG 的原始像素必须逐字节一致
    const fromPng = await sharp(png).raw().toBuffer();
    const fromWebp = await sharp(res.buffer).raw().toBuffer();
    expect(Buffer.compare(fromPng, fromWebp)).toBe(0);
  });

  it('passes through GIF unchanged (avoid losing animation)', async () => {
    const fake = Buffer.from('GIF89a-not-really');
    const res = await compressToWebpLossless(fake, 'image/gif');
    expect(res.compressed).toBe(false);
    expect(res.mime).toBe('image/gif');
    expect(res.buffer).toBe(fake);
  });

  it('passes through when result would not be smaller', async () => {
    // 注入伪 sharp 返回一个超大 buffer,模拟"压缩反而变大"
    const big = Buffer.alloc(10_000, 1);
    const fakeSharp = () => ({ webp: () => ({ toBuffer: async () => big }) });
    const input = Buffer.alloc(100, 1);
    const res = await compressToWebpLossless(input, 'image/png', { sharp: fakeSharp });
    expect(res.compressed).toBe(false);
    expect(res.buffer).toBe(input);
    expect(res.mime).toBe('image/png');
  });

  it('falls back to original on sharp error', async () => {
    const fakeSharp = () => ({ webp: () => ({ toBuffer: async () => { throw new Error('boom'); } }) });
    const input = Buffer.from('whatever');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await compressToWebpLossless(input, 'image/png', { sharp: fakeSharp });
    expect(res.compressed).toBe(false);
    expect(res.buffer).toBe(input);
    warn.mockRestore();
  });

  it('passes through empty or non-buffer input', async () => {
    const res = await compressToWebpLossless(Buffer.alloc(0), 'image/png');
    expect(res.compressed).toBe(false);
  });
});
