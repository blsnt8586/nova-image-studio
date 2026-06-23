import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canvasesApi, generationsApi, assetsApi } from '@/lib/resource-clients';
import { setSub2apiToken } from '@/lib/sub2api-token';

beforeEach(() => {
  setSub2apiToken('jwt');
});

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status });
}

describe('canvasesApi', () => {
  it('list GETs /api/canvases', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope([{ id: 'c1' }]));
    const rows = await canvasesApi.list(fetchImpl);
    expect(rows).toEqual([{ id: 'c1' }]);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/canvases');
  });

  it('create POSTs name + snapshotJson', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'c1' }, 201));
    await canvasesApi.create({ name: 'x', snapshotJson: { a: 1 } }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/canvases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'x', snapshotJson: { a: 1 } });
  });

  it('get GETs /api/canvases/:id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'c1' }));
    await canvasesApi.get('c1', fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/canvases/c1');
  });

  it('update PUTs /api/canvases/:id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'c1' }));
    await canvasesApi.update('c1', { name: 'y' }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/canvases/c1');
    expect(init.method).toBe('PUT');
  });

  it('remove DELETEs /api/canvases/:id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'c1' }));
    await canvasesApi.remove('c1', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/canvases/c1');
    expect(init.method).toBe('DELETE');
  });
});

describe('generationsApi', () => {
  it('list GETs /api/generations', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope([]));
    await generationsApi.list(fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/generations');
  });

  it('create POSTs generation metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'g1' }, 201));
    await generationsApi.create({ mode: 'text-to-image', objectKey: '42/generation/x.png' }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/generations');
    expect(JSON.parse(init.body).objectKey).toBe('42/generation/x.png');
  });

  it('remove DELETEs by id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'g1' }));
    await generationsApi.remove('g1', fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/generations/g1');
  });
});

describe('assetsApi', () => {
  it('create POSTs asset metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'a1' }, 201));
    await assetsApi.create({ objectKey: '42/asset/x.png', mime: 'image/png', size: 5 }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/assets');
    expect(JSON.parse(init.body).objectKey).toBe('42/asset/x.png');
  });

  it('list GETs /api/assets', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope([]));
    await assetsApi.list(fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/assets');
  });

  it('remove DELETEs by id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'a1' }));
    await assetsApi.remove('a1', fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/assets/a1');
  });
});
