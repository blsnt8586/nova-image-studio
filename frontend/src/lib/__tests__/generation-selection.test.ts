import { describe, it, expect } from 'vitest';
import { validateGenerationSelection } from '@/lib/generation-selection';
import type { ModelOption } from '@/lib/gemini-config';

const OPTIONS: ModelOption[] = [
  { value: 'm-img-1', label: '我的图片模型' },
];

describe('validateGenerationSelection', () => {
  it('passes when model is configured and size/ratio are chosen', () => {
    const r = validateGenerationSelection(
      { model: 'm-img-1', outputSize: '1K', aspectRatio: '1:1' },
      OPTIONS,
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBeUndefined();
  });

  it('fails when no model is configured (selected model not in options)', () => {
    const r = validateGenerationSelection(
      { model: 'gemini-3-pro-image-preview', outputSize: '1K', aspectRatio: '1:1' },
      [],
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('AI 模型');
  });

  it('fails when selected model is not among configured options', () => {
    const r = validateGenerationSelection(
      { model: 'unknown-model', outputSize: '1K', aspectRatio: '1:1' },
      OPTIONS,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('AI 模型');
  });

  it('fails when output size is empty', () => {
    const r = validateGenerationSelection(
      { model: 'm-img-1', outputSize: '' as never, aspectRatio: '1:1' },
      OPTIONS,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('输出尺寸');
  });

  it('fails when aspect ratio is empty', () => {
    const r = validateGenerationSelection(
      { model: 'm-img-1', outputSize: '1K', aspectRatio: '' as never },
      OPTIONS,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('宽高比');
  });

  it('accepts the "auto" layout (size and ratio both auto)', () => {
    const r = validateGenerationSelection(
      { model: 'm-img-1', outputSize: 'auto', aspectRatio: 'auto' },
      OPTIONS,
    );
    expect(r.ok).toBe(true);
  });

  it('reports the model problem first when multiple are missing', () => {
    const r = validateGenerationSelection(
      { model: 'unknown-model', outputSize: '' as never, aspectRatio: '' as never },
      OPTIONS,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('AI 模型');
  });
});
