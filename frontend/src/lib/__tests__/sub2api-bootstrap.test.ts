import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseBootstrapParams,
  runSub2apiBootstrap,
  loadSub2apiKeys,
  loadSub2apiModels,
  PROXY_BASE_PATH,
} from '@/lib/sub2api-bootstrap';
import { getSub2apiToken, clearSub2apiToken, setSub2apiToken } from '@/lib/sub2api-token';
import { getSub2apiOrigin, getSub2apiKeysUrl } from '@/lib/sub2api-origin';
import { getSub2apiUserId } from '@/lib/sub2api-user';
import { loadRegistry, REGISTRY_KEY_FOR_TEST } from '@/lib/nova-models';

describe('sub2api-bootstrap', () => {
  beforeEach(() => {
    clearSub2apiToken();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  describe('parseBootstrapParams', () => {
    it('reads token and user_id from a query string', () => {
      const p = parseBootstrapParams('?token=jwt-1&user_id=42&theme=dark&lang=zh');
      expect(p.token).toBe('jwt-1');
      expect(p.userId).toBe('42');
      expect(p.theme).toBe('dark');
    });

    it('returns nulls when params are absent', () => {
      const p = parseBootstrapParams('?foo=bar');
      expect(p.token).toBeNull();
      expect(p.userId).toBeNull();
    });

    it('handles an empty/none query string', () => {
      expect(parseBootstrapParams('').token).toBeNull();
      expect(parseBootstrapParams('?').token).toBeNull();
    });

    it('reads src_host (parent sub2api origin)', () => {
      const p = parseBootstrapParams('?token=t&src_host=https%3A%2F%2Fsub2api.test');
      expect(p.srcHost).toBe('https://sub2api.test');
    });
  });

  describe('runSub2apiBootstrap', () => {
    function deps(overrides = {}) {
      return {
        search: '?token=jwt-xyz&user_id=7',
        origin: 'https://nova.test',
        fetchImpl: vi.fn(),
        replaceUrl: vi.fn(),
        ...overrides,
      };
    }

    it('only stores the token and does NOT auto-create any models', async () => {
      const d = deps();
      const result = await runSub2apiBootstrap(d);

      expect(result.ok).toBe(true);
      expect(getSub2apiToken()).toBe('jwt-xyz');
      // 不再自动拉模型或建模型:registry 保持空,模型由用户手动新增
      expect(d.fetchImpl).not.toHaveBeenCalled();
      const reg = loadRegistry();
      expect(reg.imageModels).toHaveLength(0);
      expect(reg.textModels).toHaveLength(0);
    });

    it('stores the user_id for same-browser account-switch detection', async () => {
      const d = deps();
      await runSub2apiBootstrap(d);
      expect(getSub2apiUserId()).toBe('7');
    });

    it('strips the token from the URL after bootstrapping', async () => {
      const d = deps();
      await runSub2apiBootstrap(d);
      expect(d.replaceUrl).toHaveBeenCalledTimes(1);
      const newUrl = d.replaceUrl.mock.calls[0][0];
      expect(newUrl).not.toContain('jwt-xyz');
      expect(newUrl).not.toContain('token=');
    });

    it('stores the sub2api origin from src_host for the keys-page link', async () => {
      const d = deps({ search: '?token=jwt-xyz&src_host=https%3A%2F%2Fsub2api.test' });
      await runSub2apiBootstrap(d);
      expect(getSub2apiOrigin()).toBe('https://sub2api.test');
      expect(getSub2apiKeysUrl()).toBe('https://sub2api.test/keys');
    });

    it('is a no-op when there is no token in the URL', async () => {
      const d = deps({ search: '?foo=bar' });
      const result = await runSub2apiBootstrap(d);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no-token');
      expect(d.fetchImpl).not.toHaveBeenCalled();
    });

    it('uses the REGISTRY_KEY_FOR_TEST constant for persistence', () => {
      expect(REGISTRY_KEY_FOR_TEST).toBe('nova-model-registry');
    });
  });

  describe('loadSub2apiKeys', () => {
    it('fetches /api/keys with the stored token and returns the list', async () => {
      setSub2apiToken('jwt-stored');
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [{ id: 3, name: 'k3', status: 'active' }] }),
      });
      const keys = await loadSub2apiKeys({ fetchImpl, origin: 'https://nova.test' });
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://nova.test/api/keys',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-stored' }) }),
      );
      expect(keys).toEqual([{ id: '3', name: 'k3', status: 'active' }]);
    });

    it('returns an empty list when no token is stored', async () => {
      const fetchImpl = vi.fn();
      const keys = await loadSub2apiKeys({ fetchImpl, origin: 'https://nova.test' });
      expect(keys).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('loadSub2apiModels', () => {
    it('fetches /api/proxy/v1/models with the JWT and the X-Sub2api-Key-Id header', async () => {
      setSub2apiToken('jwt-stored');
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-image-2' }, { id: 'gpt-5.4', name: 'GPT 5.4' }] }),
      });
      const models = await loadSub2apiModels('9', { fetchImpl, origin: 'https://nova.test' });

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://nova.test' + PROXY_BASE_PATH + '/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer jwt-stored',
            'X-Sub2api-Key-Id': '9',
          }),
        }),
      );
      expect(models).toEqual([
        { id: 'gpt-image-2', name: 'gpt-image-2' },
        { id: 'gpt-5.4', name: 'GPT 5.4' },
      ]);
    });

    it('omits the key-id header when no keyId is given', async () => {
      setSub2apiToken('jwt-stored');
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-image-2' }] }),
      });
      await loadSub2apiModels(undefined, { fetchImpl, origin: 'https://nova.test' });
      const headers = fetchImpl.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty('X-Sub2api-Key-Id');
    });

    it('returns an empty list when no token is stored', async () => {
      const fetchImpl = vi.fn();
      const models = await loadSub2apiModels('9', { fetchImpl, origin: 'https://nova.test' });
      expect(models).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns an empty list when the request fails', async () => {
      setSub2apiToken('jwt-stored');
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      const models = await loadSub2apiModels('9', { fetchImpl, origin: 'https://nova.test' });
      expect(models).toEqual([]);
    });

    it('returns an empty list when fetch throws', async () => {
      setSub2apiToken('jwt-stored');
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
      const models = await loadSub2apiModels('9', { fetchImpl, origin: 'https://nova.test' });
      expect(models).toEqual([]);
    });
  });
});
