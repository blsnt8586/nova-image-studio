import { describe, it, expect, vi, beforeEach } from 'vitest';
import { presignPut, presignGet, uploadBlob } from '@/lib/storage-client';
import { setSub2apiToken } from '@/lib/sub2api-token';

beforeEach(() => {
  setSub2apiToken('jwt');
});

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status });
}

describe('presignPut', () => {
  it('requests a put presign and returns url + objectKey', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ url: 'https://put', objectKey: '42/asset/u.png' }));
    const out = await presignPut('asset', 'png', 'image/png', fetchImpl);
    expect(out).toEqual({ url: 'https://put', objectKey: '42/asset/u.png' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/storage/presign');
    expect(JSON.parse(init.body)).toEqual({ op: 'put', type: 'asset', ext: 'png', contentType: 'image/png' });
  });
});

describe('presignGet', () => {
  it('requests a get presign for an object key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ url: 'https://get', objectKey: '42/asset/u.png' }));
    const out = await presignGet('42/asset/u.png', fetchImpl);
    expect(out.url).toBe('https://get');
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ op: 'get', objectKey: '42/asset/u.png' });
  });
});

describe('uploadBlob', () => {
  it('PUTs the blob to the presigned url with content-type', async () => {
    const blob = new Blob(['hi'], { type: 'image/png' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    await uploadBlob('https://put', blob, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://put');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(blob);
  });

  it('throws when the upload fails', async () => {
    const blob = new Blob(['hi'], { type: 'image/png' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    await expect(uploadBlob('https://put', blob, fetchImpl)).rejects.toThrow();
  });
});
