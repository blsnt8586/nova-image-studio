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

  it('探测推理模型应使用与 agent 对话一致的流式请求(stream:true)', async () => {
    const captured: { url: string; body: Record<string, unknown>; accept: string } = { url: '', body: {}, accept: '' };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(url);
      captured.body = JSON.parse(String(init?.body ?? '{}'));
      captured.accept = new Headers(init?.headers).get('Accept') ?? '';
      // 模拟 SSE 流:开一个可读流即代表连接成功。
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkModelsAvailability(['txt_1']);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(captured.url).toContain('/v1/responses');
    // 与 agent 对话保持一致:流式请求,避免上游对非流式推理请求返回 api_error。
    expect(captured.body.stream).toBe(true);
    expect(captured.accept).toContain('text/event-stream');
    // 不带 max_output_tokens:推理模型(gpt-5.x)的 reasoning 阶段就远超小额度,
    // 设上限会在生成前被上游拒绝(Service temporarily unavailable)。
    // agent 对话请求本身也不带此字段。
    expect(captured.body.max_output_tokens).toBeUndefined();
    expect(result[0].available).toBe(true);
  });
});
