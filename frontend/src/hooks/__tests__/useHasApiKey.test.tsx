import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useHasApiKey } from '@/hooks/useHasApiKey';
import { MODEL_REGISTRY_UPDATED_EVENT } from '@/lib/settings-storage';
import { saveRegistry } from '@/lib/nova-models';
import { SUB2API_PROXY_API_KEY } from '@/lib/sub2api-token';

function completeRegistry() {
  const image = {
    id: 'img_1',
    protocol: 'openai' as const,
    name: '图片模型',
    modelId: 'gpt-image-2',
    apiKey: SUB2API_PROXY_API_KEY,
    baseUrl: 'https://example.com',
    builtinPreset: 'gpt-image-2' as const,
    maxRefImages: 1,
    maxOutputSize: '1K' as const,
    supportsAdvancedParams: false,
  };
  const text = {
    id: 'txt_1',
    protocol: 'openai' as const,
    name: '文本模型',
    modelId: 'gpt-4o',
    apiKey: SUB2API_PROXY_API_KEY,
    baseUrl: 'https://example.com',
    note: '',
  };
  return {
    imageModels: [image],
    textModels: [text],
    defaults: {
      textToImage: 'img_1',
      imageToImage: 'img_1',
      reversePrompt: 'txt_1',
      agent: 'txt_1',
      promptOptimize: 'txt_1',
      imageDescribe: 'txt_1',
    },
  };
}

describe('useHasApiKey', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('初始无模型配置时返回 false', () => {
    const { result } = renderHook(() => useHasApiKey());
    expect(result.current).toBe(false);
  });

  it('保存模型并派发更新事件后,不重新挂载也应变为 true', () => {
    const { result } = renderHook(() => useHasApiKey());
    expect(result.current).toBe(false);

    act(() => {
      saveRegistry(completeRegistry());
      window.dispatchEvent(new Event(MODEL_REGISTRY_UPDATED_EVENT));
    });

    expect(result.current).toBe(true);
  });

  it('挂载时已配置则初始即为 true', () => {
    saveRegistry(completeRegistry());
    const { result } = renderHook(() => useHasApiKey());
    expect(result.current).toBe(true);
  });

  it('配置被清空并派发事件后回到 false', () => {
    saveRegistry(completeRegistry());
    const { result } = renderHook(() => useHasApiKey());
    expect(result.current).toBe(true);

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new Event(MODEL_REGISTRY_UPDATED_EVENT));
    });

    expect(result.current).toBe(false);
  });
});
