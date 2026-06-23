import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNovaTask, resolveImageTaskProvider } from '@/lib/ccode-task-client';
import { saveRegistry, type NovaModelRegistry } from '@/lib/nova-models';

function seedRegistry(overrides: Partial<NovaModelRegistry['imageModels'][number]> = {}) {
  saveRegistry({
    imageModels: [
      {
        id: 'm1',
        protocol: 'openai',
        name: 'sub2api 模型',
        modelId: 'gpt-image-2',
        apiKey: '__sub2api_proxy__',
        baseUrl: 'https://nova.test/api/proxy',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 4,
        maxOutputSize: '2K',
        supportsAdvancedParams: true,
        source: 'sub2api',
        keyId: '7',
        ...overrides,
      },
    ],
    textModels: [],
    defaults: {
      textToImage: 'm1',
      imageToImage: 'm1',
      reversePrompt: '',
      agent: '',
      promptOptimize: '',
      imageDescribe: '',
    },
  });
}

describe('ccode-task-client — keyId 透传', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('resolveImageTaskProvider 返回模型的 keyId', () => {
    seedRegistry({ keyId: '7' });
    const provider = resolveImageTaskProvider('m1');
    expect(provider.keyId).toBe('7');
  });

  it('keyId 缺省时 provider.keyId 为 undefined', () => {
    seedRegistry({ keyId: undefined, source: 'manual', apiKey: 'sk-real' });
    const provider = resolveImageTaskProvider('m1');
    expect(provider.keyId).toBeUndefined();
  });

  it('createNovaTask 把 keyId 放进请求体', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ taskId: 't-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await createNovaTask({
      apiKey: '__sub2api_proxy__',
      baseUrl: 'https://nova.test/api/proxy',
      protocol: 'openai',
      mode: 'text-to-image',
      prompt: 'cat',
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1,
      model: 'gpt-image-2',
      parallelCount: 1,
      images: [],
      keyId: '7',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.keyId).toBe('7');
  });
});
