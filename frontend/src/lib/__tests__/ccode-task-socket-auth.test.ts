import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// 受控的 WebSocket mock:记录 send 的消息顺序,手动触发 open。
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ||= []).push(cb);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    for (const cb of this.listeners.open || []) cb({});
  }
}

describe('novaTaskSocket — 连接后发送 auth 消息(token 不进 URL)', () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('open 后第一条消息是 auth(带 token),且 URL 不含 token', async () => {
    const tokenMod = await import('@/lib/sub2api-token');
    tokenMod.setSub2apiToken('jwt-live');
    const { novaTaskSocket } = await import('@/lib/ccode-task-socket');

    novaTaskSocket.subscribeTask('task-1', () => {});
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    expect(ws.url).not.toContain('token=');
    expect(ws.url).not.toContain('jwt-live');

    ws.triggerOpen();

    const messages = ws.sent.map((m) => JSON.parse(m));
    expect(messages[0]).toEqual({ type: 'auth', token: 'jwt-live' });
    const authIndex = messages.findIndex((m) => m.type === 'auth');
    const subIndex = messages.findIndex((m) => m.type === 'subscribeTasks');
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(subIndex).toBeGreaterThan(authIndex);

    novaTaskSocket.disable();
    tokenMod.clearSub2apiToken();
  });

  it('无 token 时不发 auth,仅发 subscribeTasks', async () => {
    const tokenMod = await import('@/lib/sub2api-token');
    tokenMod.clearSub2apiToken();
    const { novaTaskSocket } = await import('@/lib/ccode-task-socket');

    novaTaskSocket.subscribeTask('task-2', () => {});
    const ws = MockWebSocket.instances[0];
    ws.triggerOpen();

    const messages = ws.sent.map((m) => JSON.parse(m));
    expect(messages.some((m) => m.type === 'auth')).toBe(false);
    expect(messages.some((m) => m.type === 'subscribeTasks')).toBe(true);

    novaTaskSocket.disable();
  });
});
