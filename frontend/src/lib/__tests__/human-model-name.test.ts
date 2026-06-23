import { describe, expect, it } from 'vitest';
import { humanModelName } from '@/lib/nova-models';

describe('humanModelName', () => {
  it('returns the readable name when it is a normal display name', () => {
    expect(humanModelName({ name: 'GPT Image 2', modelId: 'gpt-image-2', id: 'm1' })).toBe('GPT Image 2');
  });

  it('falls back to modelId when name is empty', () => {
    expect(humanModelName({ name: '', modelId: 'gpt-image-2', id: 'm1' })).toBe('gpt-image-2');
  });

  it('falls back to modelId when name is whitespace only', () => {
    expect(humanModelName({ name: '   ', modelId: 'gpt-5.5', id: 'm2' })).toBe('gpt-5.5');
  });

  it('falls back to modelId when name is a dirty internal sub2api id', () => {
    expect(humanModelName({ name: 'sub2api_1782097476153_137ok0', modelId: 'gpt-image-2', id: 'm1' })).toBe('gpt-image-2');
  });

  it('falls back to modelId when name is a dirty internal txt id', () => {
    expect(humanModelName({ name: 'txt_1782132741498_bhmu66', modelId: 'gpt-5.5', id: 'm2' })).toBe('gpt-5.5');
  });

  it('falls back to modelId for img_ and model_ prefixed internal ids', () => {
    expect(humanModelName({ name: 'img_1782132741498_abcde0', modelId: 'gpt-image-2', id: 'm1' })).toBe('gpt-image-2');
    expect(humanModelName({ name: 'model_1782132741498_zzz999', modelId: 'gpt-5.5', id: 'm2' })).toBe('gpt-5.5');
  });

  it('falls back to id when both name and modelId are unusable', () => {
    expect(humanModelName({ name: 'sub2api_1782097476153_137ok0', modelId: '', id: 'm9' })).toBe('m9');
  });

  it('returns 未命名模型 when nothing is usable', () => {
    expect(humanModelName({ name: '', modelId: '', id: '' })).toBe('未命名模型');
  });

  it('does not treat a normal name containing an underscore as internal', () => {
    expect(humanModelName({ name: 'my_custom_model', modelId: 'gpt-image-2', id: 'm1' })).toBe('my_custom_model');
  });

  it('tolerates missing fields', () => {
    expect(humanModelName({ modelId: 'gpt-image-2' })).toBe('gpt-image-2');
    expect(humanModelName({})).toBe('未命名模型');
  });
});
