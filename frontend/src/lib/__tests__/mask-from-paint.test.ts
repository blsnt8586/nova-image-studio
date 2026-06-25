import { describe, expect, it } from 'vitest';
import { paintLayerToOpenAiMask, isMaskEmpty } from '@/lib/mask-from-paint';

/** 构造 n 个像素的 RGBA 缓冲;painted 数组标记哪些像素被涂抹(alpha=128)。 */
function makeRgba(pixels: Array<{ painted: boolean; alpha?: number }>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    const alpha = p.painted ? (p.alpha ?? 128) : 0;
    out[i * 4] = p.painted ? 255 : 0; // R(笔刷红)
    out[i * 4 + 1] = 0;
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = alpha;
  });
  return out;
}

describe('paintLayerToOpenAiMask', () => {
  it('涂抹处 → 透明(alpha 0);未涂处 → 不透明黑(alpha 255)', () => {
    const rgba = makeRgba([{ painted: true }, { painted: false }]);
    const mask = paintLayerToOpenAiMask(rgba);

    // 像素 0:被涂 → 透明
    expect(mask[3]).toBe(0);
    // 像素 1:未涂 → 不透明
    expect(mask[7]).toBe(255);
    // 未涂处颜色为黑
    expect(mask[4]).toBe(0);
    expect(mask[5]).toBe(0);
    expect(mask[6]).toBe(0);
  });

  it('不修改入参(返回新缓冲)', () => {
    const rgba = makeRgba([{ painted: true }]);
    const copy = Uint8ClampedArray.from(rgba);
    paintLayerToOpenAiMask(rgba);
    expect(rgba).toEqual(copy);
  });

  it('低于阈值的抗锯齿边缘视为未涂(保留)', () => {
    // alpha=5 的微弱边缘,默认阈值下不算涂抹
    const rgba = makeRgba([{ painted: true, alpha: 5 }]);
    const mask = paintLayerToOpenAiMask(rgba, { threshold: 32 });
    expect(mask[3]).toBe(255); // 视为未涂 → 不透明保留
  });

  it('高于阈值的笔刷主体视为涂抹(可编辑)', () => {
    const rgba = makeRgba([{ painted: true, alpha: 128 }]);
    const mask = paintLayerToOpenAiMask(rgba, { threshold: 32 });
    expect(mask[3]).toBe(0); // 透明 → 可编辑
  });
});

describe('isMaskEmpty', () => {
  it('全部未涂 → 空', () => {
    const rgba = makeRgba([{ painted: false }, { painted: false }]);
    expect(isMaskEmpty(rgba)).toBe(true);
  });

  it('存在涂抹像素 → 非空', () => {
    const rgba = makeRgba([{ painted: false }, { painted: true }]);
    expect(isMaskEmpty(rgba)).toBe(false);
  });

  it('仅有低于阈值的微弱像素 → 视为空', () => {
    const rgba = makeRgba([{ painted: true, alpha: 5 }]);
    expect(isMaskEmpty(rgba, { threshold: 32 })).toBe(true);
  });
});
