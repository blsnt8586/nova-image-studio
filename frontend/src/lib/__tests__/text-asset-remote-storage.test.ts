import { describe, it, expect, vi } from 'vitest';
import {
  pushTextAssets,
  fetchRemoteTextAssets,
  TEXT_ASSETS_SETTING_KEY,
} from '@/lib/text-asset-remote-storage';
import type { TextAsset } from '@/lib/asset-store';

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status });
}

function makeText(over: Partial<TextAsset> = {}): TextAsset {
  return {
    id: 't1',
    kind: 'text',
    hash: 'h1',
    content: '一只赛博朋克猫',
    sizeBytes: 12,
    sourceKind: 'manual',
    sourceLabel: '手动添加',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const session = () => true;
const noSession = () => false;

describe('pushTextAssets', () => {
  it('PUTs the whole collection as a JSON string to the text-assets key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ key: TEXT_ASSETS_SETTING_KEY }));
    const assets = [makeText(), makeText({ id: 't2', hash: 'h2', content: '星空' })];
    const ok = await pushTextAssets(assets, { isSession: session, fetchImpl });
    expect(ok).toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain(`/api/settings/${TEXT_ASSETS_SETTING_KEY}`);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    // value 是 JSON 字符串(原样存取约定)
    expect(typeof body.value).toBe('string');
    expect(JSON.parse(body.value)).toEqual(assets);
  });

  it('no-ops (returns false) without a session', async () => {
    const fetchImpl = vi.fn();
    const ok = await pushTextAssets([makeText()], { isSession: noSession, fetchImpl });
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns false (best-effort) when the request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const ok = await pushTextAssets([makeText()], { isSession: session, fetchImpl });
    expect(ok).toBe(false);
  });
});

describe('fetchRemoteTextAssets', () => {
  it('parses the stored JSON string back into TextAsset[]', async () => {
    const assets = [makeText(), makeText({ id: 't2', hash: 'h2' })];
    const fetchImpl = vi.fn().mockResolvedValue(
      envelope({ [TEXT_ASSETS_SETTING_KEY]: JSON.stringify(assets), theme: 'dark' }),
    );
    const out = await fetchRemoteTextAssets({ isSession: session, fetchImpl });
    expect(out).toEqual(assets);
  });

  it('returns [] when the key is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ theme: 'dark' }));
    expect(await fetchRemoteTextAssets({ isSession: session, fetchImpl })).toEqual([]);
  });

  it('filters out malformed entries', async () => {
    const good = makeText();
    const raw = JSON.stringify([good, { kind: 'text' }, null, { kind: 'image', id: 'x' }]);
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ [TEXT_ASSETS_SETTING_KEY]: raw }));
    const out = await fetchRemoteTextAssets({ isSession: session, fetchImpl });
    expect(out).toEqual([good]);
  });

  it('returns [] on invalid JSON (best-effort)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ [TEXT_ASSETS_SETTING_KEY]: 'not json{' }));
    expect(await fetchRemoteTextAssets({ isSession: session, fetchImpl })).toEqual([]);
  });

  it('returns [] without a session', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchRemoteTextAssets({ isSession: noSession, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns [] when the request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await fetchRemoteTextAssets({ isSession: session, fetchImpl })).toEqual([]);
  });
});
