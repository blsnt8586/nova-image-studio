import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hydrateSettings,
  installSettingsWriteThrough,
  __resetSettingsSyncForTest,
  SYNCED_SETTING_KEYS,
} from '@/lib/settings-sync';
import { setSub2apiToken, clearSub2apiToken } from '@/lib/sub2api-token';
import { setSub2apiUserId, clearSub2apiUserId } from '@/lib/sub2api-user';

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status });
}

beforeEach(() => {
  localStorage.clear();
  clearSub2apiToken();
  clearSub2apiUserId();
  __resetSettingsSyncForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('hydrateSettings', () => {
  it('no-ops (returns false) when there is no sub2api session', async () => {
    const fetchImpl = vi.fn();
    const ran = await hydrateSettings({ fetchImpl });
    expect(ran).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('writes server values into localStorage verbatim (PG wins)', async () => {
    setSub2apiToken('jwt');
    const reg = JSON.stringify({ imageModels: [{ id: 'm1' }] });
    const fetchImpl = vi.fn().mockResolvedValue(
      envelope({ 'nova-model-registry': reg, theme: 'dark' }),
    );
    const ran = await hydrateSettings({ fetchImpl });
    expect(ran).toBe(true);
    expect(localStorage.getItem('nova-model-registry')).toBe(reg);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('pushes up local-only keys when PG lacks them (one-time migration)', async () => {
    setSub2apiToken('jwt');
    localStorage.setItem('theme', 'light');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(envelope({})) // GET /api/settings → empty
      .mockResolvedValue(envelope({ key: 'theme' })); // PUT push-up
    await hydrateSettings({ fetchImpl });
    const putCall = fetchImpl.mock.calls.find(
      ([url, init]) => String(url).includes('/api/settings/theme') && init?.method === 'PUT',
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall![1].body)).toEqual({ value: 'light' });
  });

  it('keeps local intact when backend is unreachable', async () => {
    setSub2apiToken('jwt');
    localStorage.setItem('theme', 'dark');
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const ran = await hydrateSettings({ fetchImpl });
    expect(ran).toBe(false);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('purges stale local settings when a different account logs in on the same browser', async () => {
    // 账户 A 用过本浏览器:本地残留 A 的 registry,且标记 active-user = A
    setSub2apiToken('jwt-a');
    setSub2apiUserId('A');
    localStorage.setItem('nova-model-registry', JSON.stringify({ imageModels: [{ id: 'a-model' }] }));
    await hydrateSettings({ fetchImpl: vi.fn().mockResolvedValue(envelope({})) });

    // 账户 B(新号)在同浏览器登录:云端没有 B 的 registry
    setSub2apiToken('jwt-b');
    setSub2apiUserId('B');
    const fetchImpl = vi.fn().mockResolvedValue(envelope({}));
    await hydrateSettings({ fetchImpl });

    // A 的残留必须被清掉,B 不应继承 A 的模型配置
    expect(localStorage.getItem('nova-model-registry')).toBeNull();
  });

  it('does NOT push A\'s leftover settings up to B\'s account', async () => {
    setSub2apiToken('jwt-a');
    setSub2apiUserId('A');
    localStorage.setItem('nova-model-registry', JSON.stringify({ imageModels: [{ id: 'a-model' }] }));
    await hydrateSettings({ fetchImpl: vi.fn().mockResolvedValue(envelope({})) });

    setSub2apiToken('jwt-b');
    setSub2apiUserId('B');
    const fetchImpl = vi.fn().mockResolvedValue(envelope({}));
    await hydrateSettings({ fetchImpl });

    // 不应出现把 registry PUT 到后端的调用(否则就污染了 B 的云端)
    const pushedRegistry = fetchImpl.mock.calls.some(
      ([url, init]) =>
        String(url).includes('/api/settings/nova-model-registry') && init?.method === 'PUT',
    );
    expect(pushedRegistry).toBe(false);
  });

  it('keeps local settings for the SAME account across reloads (no spurious purge)', async () => {
    setSub2apiToken('jwt-a');
    setSub2apiUserId('A');
    const reg = JSON.stringify({ imageModels: [{ id: 'a-model' }] });
    localStorage.setItem('nova-model-registry', reg);
    await hydrateSettings({ fetchImpl: vi.fn().mockResolvedValue(envelope({})) });

    // 同一账户再次水合(刷新):云端仍空,但本地是该用户自己的,不该被清
    const fetchImpl = vi.fn().mockResolvedValue(envelope({}));
    await hydrateSettings({ fetchImpl });
    expect(localStorage.getItem('nova-model-registry')).toBe(reg);
  });
});

describe('installSettingsWriteThrough', () => {
  it('debounce-pushes whitelisted key writes to backend during a session', async () => {
    vi.useFakeTimers();
    setSub2apiToken('jwt');
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ key: 'theme' }));
    installSettingsWriteThrough({ fetchImpl });

    localStorage.setItem('theme', 'dark');
    expect(localStorage.getItem('theme')).toBe('dark'); // 本地立即写
    expect(fetchImpl).not.toHaveBeenCalled(); // 尚未到点

    await vi.advanceTimersByTimeAsync(900);
    const putCall = fetchImpl.mock.calls.find(
      ([url, init]) => String(url).includes('/api/settings/theme') && init?.method === 'PUT',
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall![1].body)).toEqual({ value: 'dark' });
  });

  it('does not push non-whitelisted keys', async () => {
    vi.useFakeTimers();
    setSub2apiToken('jwt');
    const fetchImpl = vi.fn().mockResolvedValue(envelope({}));
    installSettingsWriteThrough({ fetchImpl });

    localStorage.setItem('some-random-key', 'x');
    await vi.advanceTimersByTimeAsync(900);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(localStorage.getItem('some-random-key')).toBe('x');
  });

  it('writes locally but does not push when there is no session', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(envelope({}));
    installSettingsWriteThrough({ fetchImpl });

    localStorage.setItem('theme', 'dark');
    await vi.advanceTimersByTimeAsync(900);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('whitelist matches the documented key set', () => {
    expect(SYNCED_SETTING_KEYS).toContain('nova-model-registry');
    expect(SYNCED_SETTING_KEYS).toContain('theme');
    expect(SYNCED_SETTING_KEYS).toContain('nova-agent-web-search');
  });
});
