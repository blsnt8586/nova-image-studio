import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkModelsAvailability } from '@/lib/ccode-task-client';
import { saveRegistry } from '@/lib/nova-models';
import { SUB2API_PROXY_API_KEY } from '@/lib/sub2api-token';

function textOnlyRegistry() {
  return {
    imageModels: [],
    textModels: [
      {
        id: 'txt_1',
        protocol: 'openai' as const,
        name: 'GPT-5.5',
        modelId: 'gpt-5.5',
        apiKey: SUB2API_PROXY_API_KEY,
        baseUrl: 'https://novaimage.bbroot.com/api/proxy',
        note: '',
      },
    ],
    defaults: {
      textToImage: '',
      imageToImage: '',
      reversePrompt: 'txt_1',
      agent: 'txt_1',
      promptOptimize: 'txt_1',
      imageDescribe: 'txt_1',
    },
  };
}

describe('checkModelsAvailability 文本模型探测请求', () => {
  beforeEach(() => {
    localStorage.clear();
    saveRegistry(textOnlyRegistry());
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('探测推理模型时 max_output_tokens 不应过小,并应带 reasoning', async () => {
    const captured: { url: string; body: Record<string, unknown> } = { url: '', body: {} };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(url);
      captured.body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ output: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkModelsAvailability(['txt_1']);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(captured.url).toContain('/v1/responses');
    // 推理模型(gpt-5.x)的 reasoning tokens 也算进 max_output_tokens,
    // 给 4 会被上游拒绝(Service temporarily unavailable)。要给足够大的值。
    expect(captured.body.max_output_tokens as number).toBeGreaterThanOrEqual(16);
    expect(captured.body.reasoning).toBeDefined();
    expect(result[0].available).toBe(true);
  });
});
