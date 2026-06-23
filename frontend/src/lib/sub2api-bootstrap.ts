'use client';

import { setSub2apiToken, getSub2apiToken } from '@/lib/sub2api-token';
import { setSub2apiOrigin } from '@/lib/sub2api-origin';
import { setSub2apiUserId } from '@/lib/sub2api-user';
/** nova 后端生图代理的基路径(对应 backend src/proxy/target.js 的 PROXY_PREFIX)。 */
export const PROXY_BASE_PATH = '/api/proxy';

export interface BootstrapParams {
  token: string | null;
  userId: string | null;
  theme: string | null;
  lang: string | null;
  /** 父页面(sub2api)origin,用于引导用户去 `${srcHost}/keys` 创建 API Key。 */
  srcHost: string | null;
}

export interface RunBootstrapDeps {
  /** location.search,如 `?token=...&user_id=...` */
  search: string;
  /** location.origin,如 `https://nova.example.com` */
  origin: string;
  /** fetch 实现(便于注入测试) */
  fetchImpl: typeof fetch;
  /** 清理 URL 的回调(注入 history.replaceState 包装) */
  replaceUrl: (url: string) => void;
}

export interface BootstrapResult {
  ok: boolean;
  reason?: 'no-token';
}

/**
 * 从 query string 解析入口参数(token / user_id / theme / lang)。
 */
export function parseBootstrapParams(search: string): BootstrapParams {
  const params = new URLSearchParams(search || '');
  return {
    token: params.get('token'),
    userId: params.get('user_id'),
    theme: params.get('theme'),
    lang: params.get('lang'),
    srcHost: params.get('src_host'),
  };
}

export interface Sub2apiKeyEntry {
  id: string;
  name: string;
  status?: string;
}

export interface Sub2apiModelEntry {
  id: string;
  name: string;
}

/**
 * 拉取当前用户的 sub2api API Key 列表(脱敏,仅 {id,name,status})。
 * 失败/无 key 返回空数组。
 */
async function fetchKeyList(
  fetchImpl: typeof fetch,
  origin: string,
  token: string,
): Promise<Sub2apiKeyEntry[]> {
  const url = origin + '/api/keys';
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return [];
  }
  if (!res || !res.ok) {
    return [];
  }
  const body = await res.json().catch(() => null);
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return (list as Array<{ id?: unknown; name?: unknown; status?: unknown }>)
    .filter((k) => k && k.id !== undefined && k.id !== null)
    .map((k) => ({
      id: String(k.id),
      name: String(k.name ?? ''),
      status: k.status ? String(k.status) : undefined,
    }));
}

/**
 * 供 UI(设置弹窗)按需拉取当前用户的 sub2api API Key 列表(脱敏)。
 * 用已存的 JWT 与传入 origin 调 `/api/keys`。无 token 时返回空数组。
 */
export async function loadSub2apiKeys(opts: {
  fetchImpl?: typeof fetch;
  origin?: string;
}): Promise<Sub2apiKeyEntry[]> {
  const token = getSub2apiToken();
  if (!token) {
    return [];
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const origin = opts.origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return fetchKeyList(fetchImpl, origin, token);
}

export interface AccountStatus {
  /** 余额 ≤ 0 且无有效订阅 → 用户当前无法生图。 */
  outOfFunds: boolean;
  hasActiveSubscription: boolean;
}

/**
 * 拉取当前用户账户可用状态(经 nova 后端 `/api/account-status`)。
 * 后端用 JWT 调 sub2api profile + 有效订阅,算出 outOfFunds(余额数值不外泄)。
 *
 * 无 token、请求失败或异常时返回 null(调用方据此不做拦截,避免误报)。
 */
export async function loadAccountStatus(opts: {
  fetchImpl?: typeof fetch;
  origin?: string;
}): Promise<AccountStatus | null> {
  const token = getSub2apiToken();
  if (!token) {
    return null;
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const origin = opts.origin || (typeof window !== 'undefined' ? window.location.origin : '');
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(origin + '/api/account-status', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!res || !res.ok) {
    return null;
  }
  const body = await res.json().catch(() => null);
  const data = body && typeof body === 'object' ? body.data : null;
  if (!data || typeof data !== 'object') {
    return null;
  }
  return {
    outOfFunds: Boolean((data as AccountStatus).outOfFunds),
    hasActiveSubscription: Boolean((data as AccountStatus).hasActiveSubscription),
  };
}

/**
 * 供 UI 按需拉取某个 API Key 可用的模型列表(经代理 `/v1/models`)。
 *
 * 携带:
 * - `Authorization: Bearer <JWT>`(身份)
 * - `X-Sub2api-Key-Id: <keyId>`(后端据此换成对应 sk- key,key 不进浏览器)
 *
 * 无 token、请求失败或异常时返回空数组(由 UI 决定提示)。
 *
 * @param keyId 选中的 API Key id;留空则后端回落账户首个 key。
 */
export async function loadSub2apiModels(
  keyId: string | undefined,
  opts: { fetchImpl?: typeof fetch; origin?: string },
): Promise<Sub2apiModelEntry[]> {
  const token = getSub2apiToken();
  if (!token) {
    return [];
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const origin = opts.origin || (typeof window !== 'undefined' ? window.location.origin : '');
  const url = origin + PROXY_BASE_PATH + '/v1/models';

  const trimmedKeyId = keyId !== undefined && keyId !== null ? String(keyId).trim() : '';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (trimmedKeyId) {
    headers['X-Sub2api-Key-Id'] = trimmedKeyId;
  }

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url, { headers });
  } catch {
    return [];
  }
  if (!res || !res.ok) {
    return [];
  }
  const body = await res.json().catch(() => null);
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return (list as Array<{ id?: unknown; name?: unknown }>)
    .filter((m) => m && m.id !== undefined && m.id !== null && String(m.id).trim())
    .map((m) => {
      const id = String(m.id).trim();
      const name = m.name && String(m.name).trim() ? String(m.name).trim() : id;
      return { id, name };
    });
}

/**
 * 入口编排:解析参数 → 存 token → 清 URL。
 *
 * 注意:不再自动拉取/创建任何模型。模型由用户在设置里手动「新增」并选择
 * API Key + 模型(见 {@link loadSub2apiKeys} / {@link loadSub2apiModels})。
 *
 * @returns {BootstrapResult}
 */
export async function runSub2apiBootstrap(deps: RunBootstrapDeps): Promise<BootstrapResult> {
  const params = parseBootstrapParams(deps.search);
  if (!params.token) {
    return { ok: false, reason: 'no-token' };
  }

  // 1. 存 token(sessionStorage + 内存)
  setSub2apiToken(params.token);

  // 1a. 存 user_id(供「同浏览器换账户」时清洗本地偏好,避免跨账户配置污染)
  if (params.userId) {
    setSub2apiUserId(params.userId);
  }

  // 1b. 存父页面 origin(若带 src_host),供"去 sub2api 创建 Key"跳转用
  if (params.srcHost) {
    setSub2apiOrigin(params.srcHost);
  }

  // 2. 清 URL 里的敏感参数(token/user_id 等),保留路径
  try {
    const url = new URL(deps.origin + (deps.search.startsWith('?') ? '/' + deps.search : ''));
    ['token', 'user_id', 'theme', 'lang', 'ui_mode', 'src_host', 'src_url'].forEach((k) =>
      url.searchParams.delete(k),
    );
    deps.replaceUrl(url.pathname + (url.search ? url.search : ''));
  } catch {
    deps.replaceUrl('/');
  }

  return { ok: true };
}
