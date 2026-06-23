import { describe, expect, it } from 'vitest';
import { retryDataToSubmission } from '@/lib/workspace-task-service';
import type { RetryData } from '@/lib/model-capabilities';

function baseRetryData(overrides: Partial<RetryData> = {}): RetryData {
  return {
    mode: 'text-to-image',
    prompt: '一只赛博朋克猫',
    outputSize: '1K',
    temperature: 1,
    aspectRatio: '1:1',
    model: 'gpt-image-2',
    parallelCount: 1,
    gptImageQuality: 'auto',
    gptImageStyle: 'auto',
    gptImageBackground: 'auto',
    ...overrides,
  };
}

describe('retryDataToSubmission', () => {
  it('文生图:返回 text 类型,prompt 包裹成 prompts 数组', () => {
    const result = retryDataToSubmission(baseRetryData());
    expect(result.mode).toBe('text-to-image');
    if (result.mode !== 'text-to-image') throw new Error('unexpected mode');
    expect(result.input.prompts).toEqual(['一只赛博朋克猫']);
    expect(result.input.model).toBe('gpt-image-2');
    expect(result.input.outputSize).toBe('1K');
    expect(result.input.parallelCount).toBe(1);
  });

  it('文生图:透传所有 gpt-image 高级参数与尺寸/温度', () => {
    const result = retryDataToSubmission(
      baseRetryData({
        customSize: '1024x1024',
        temperature: 0.7,
        aspectRatio: '16:9',
        gptImageQuality: 'high',
        gptImageStyle: 'vivid',
        gptImageBackground: 'transparent',
      })
    );
    if (result.mode !== 'text-to-image') throw new Error('unexpected mode');
    expect(result.input.customSize).toBe('1024x1024');
    expect(result.input.temperature).toBe(0.7);
    expect(result.input.aspectRatio).toBe('16:9');
    expect(result.input.gptImageQuality).toBe('high');
    expect(result.input.gptImageStyle).toBe('vivid');
    expect(result.input.gptImageBackground).toBe('transparent');
  });

  it('图生图:返回 image 类型,refImages 映射为 files', () => {
    const result = retryDataToSubmission(
      baseRetryData({
        mode: 'image-to-image',
        refImages: [
          { id: 'r1', name: 'a.png', dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png', badge: 'x' },
        ],
      })
    );
    expect(result.mode).toBe('image-to-image');
    if (result.mode !== 'image-to-image') throw new Error('unexpected mode');
    expect(result.input.prompt).toBe('一只赛博朋克猫');
    expect(result.input.files).toEqual([
      { id: 'r1', name: 'a.png', dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' },
    ]);
  });

  it('图生图:无 refImages 时 files 为空数组', () => {
    const result = retryDataToSubmission(baseRetryData({ mode: 'image-to-image' }));
    if (result.mode !== 'image-to-image') throw new Error('unexpected mode');
    expect(result.input.files).toEqual([]);
  });

  it('不修改传入的 RetryData(纯函数、不可变)', () => {
    const data = baseRetryData({ mode: 'image-to-image', refImages: [] });
    const snapshot = JSON.stringify(data);
    retryDataToSubmission(data);
    expect(JSON.stringify(data)).toBe(snapshot);
  });
});
