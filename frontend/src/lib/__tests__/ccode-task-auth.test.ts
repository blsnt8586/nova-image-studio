import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createNovaTask, getNovaTask, getNovaQueueStatus, ackNovaTask } from '@/lib/ccode-task-client';
import { setSub2apiToken, clearSub2apiToken } from '@/lib/sub2api-token';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers[name] ?? null;
}

const CREATE_INPUT = {
  apiKey: 'sk-x',
  baseUrl: 'https://nova.test/api/proxy',
  protocol: 'openai' as const,
  mode: 'text-to-image' as const,
  prompt: 'hi',
  model: 'gpt-image-2',
  parallelCount: 1,
  images: [],
  outputSize: '1K' as const,
  aspectRatio: '1:1' as const,
  temperature: 1,
};

describe('ccode-task-client — /api/nova/* 携带 JWT Authorization 头', () => {
  beforeEach(() => {
    clearSub2apiToken();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSub2apiToken();
  });

  it('有 token 时 createNovaTask 附带 Authorization: Bearer <jwt>', async () => {
    setSub2apiToken('jwt-abc');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ taskId: 't-1' }));
    await createNovaTask(CREATE_INPUT);
    const [, init] = fetchSpy.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBe('Bearer jwt-abc');
    expect(headerOf(init, 'Content-Type')).toBe('application/json');
  });

  it('无 token 时 createNovaTask 不带 Authorization 头(回退单机命名空间)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ taskId: 't-2' }));
    await createNovaTask(CREATE_INPUT);
    const [, init] = fetchSpy.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBeNull();
  });

  it('getNovaTask 附带 Authorization 头', async () => {
    setSub2apiToken('jwt-get');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 't-1', status: 'completed' }));
    await getNovaTask('t-1');
    const [, init] = fetchSpy.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBe('Bearer jwt-get');
  });

  it('getNovaQueueStatus 附带 Authorization 头', async () => {
    setSub2apiToken('jwt-q');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ activeCount: 0, queueLength: 0 }));
    await getNovaQueueStatus();
    const [, init] = fetchSpy.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBe('Bearer jwt-q');
  });

  it('ackNovaTask 附带 Authorization 头', async () => {
    setSub2apiToken('jwt-ack');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    await ackNovaTask('t-1');
    const [, init] = fetchSpy.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBe('Bearer jwt-ack');
  });

  it('token 绝不出现在 URL 里(只在头部)', async () => {
    setSub2apiToken('jwt-secret');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 't-1', status: 'completed' }));
    await getNovaTask('t-1');
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('jwt-secret');
    expect(String(url)).not.toContain('token=');
  });
});
