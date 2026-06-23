import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authFetch,
  apiRequest,
  isSub2apiSession,
  ApiError,
} from '@/lib/api-client';
import { setSub2apiToken, clearSub2apiToken } from '@/lib/sub2api-token';

beforeEach(() => {
  clearSub2apiToken();
});

describe('authFetch', () => {
  it('attaches the Authorization header when a token is present', async () => {
    setSub2apiToken('jwt-123');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    await authFetch('/api/canvases', {}, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.get('Authorization')).toBe('Bearer jwt-123');
  });

  it('omits Authorization when no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    await authFetch('/api/canvases', {}, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.get('Authorization')).toBeNull();
  });

  it('preserves caller headers and merges Authorization', async () => {
    setSub2apiToken('jwt-123');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    await authFetch('/api/x', { headers: { 'X-Test': '1' } }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.get('X-Test')).toBe('1');
    expect(init.headers.get('Authorization')).toBe('Bearer jwt-123');
  });
});

describe('isSub2apiSession', () => {
  it('is true only when a token exists', () => {
    expect(isSub2apiSession()).toBe(false);
    setSub2apiToken('t');
    expect(isSub2apiSession()).toBe(true);
  });
});

describe('apiRequest', () => {
  it('unwraps a success envelope', async () => {
    setSub2apiToken('t');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 'c1' } }), { status: 200 }),
    );
    const data = await apiRequest('/api/canvases/c1', {}, fetchImpl);
    expect(data).toEqual({ id: 'c1' });
  });

  it('throws ApiError on a failure envelope', async () => {
    setSub2apiToken('t');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: '画布不存在' }), { status: 404 }),
    );
    await expect(apiRequest('/api/canvases/x', {}, fetchImpl)).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest('/api/canvases/x', {}, fetchImpl)).rejects.toMatchObject({ status: 404 });
  });

  it('throws ApiError on non-JSON / HTTP error without envelope', async () => {
    setSub2apiToken('t');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    await expect(apiRequest('/api/x', {}, fetchImpl)).rejects.toBeInstanceOf(ApiError);
  });

  it('serializes a JSON body and sets content-type', async () => {
    setSub2apiToken('t');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: null }), { status: 201 }),
    );
    await apiRequest('/api/canvases', { method: 'POST', json: { name: 'x' } }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
  });
});
