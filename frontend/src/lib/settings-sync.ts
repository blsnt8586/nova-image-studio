'use client';

import { apiRequest, isSub2apiSession, type FetchImpl } from '@/lib/api-client';
import { parseBootstrapParams } from '@/lib/sub2api-bootstrap';
import { setSub2apiToken } from '@/lib/sub2api-token';
import { getSub2apiUserId, setSub2apiUserId } from '@/lib/sub2api-user';

/**
 * 第二档「偏好设置」同步层(localStorage ↔ PG)。
 *
 * 设计要点:
 * - 后端 value 是 jsonb,这里**原样存取 localStorage 字符串**(不二次 parse/stringify),
 *   彻底规避「对象键存 JSON 串、theme 存裸串、开关存 'true'」三种格式的往返损坏。
 * - sub2api 会话时:登录后从 /api/settings 整体水合;无会话时纯本地,什么都不做。
 * - 首次进入若 PG 没有但本地已有 → 把本地值推上去(一次性迁移,救回历史本地设置)。
 * - 写回:包一层 localStorage.setItem,命中白名单键则 debounce PUT 后端。
 */

/** 需要跨设备同步的白名单键(必须与后端 ALLOWED_SETTING_KEYS 一致)。 */
export const SYNCED_SETTING_KEYS = Object.freeze([
  'nova-model-registry',
  'nova-t2i-settings',
  'nova-i2i-settings',
  'nova-reverse-prompt-settings',
  'nova-gif-settings',
  'nova-assets-settings',
  'nova-agent-params',
  'nova-agent-web-search',
  'nova-agent-intent-recognition',
  'theme',
]);

const SYNCED = new Set(SYNCED_SETTING_KEYS);
const PUSH_DEBOUNCE_MS = 800;

/**
 * 记录「当前本地白名单偏好属于哪个 sub2api 用户」的本地标记。
 * 仅本地簿记,不进同步白名单、不上云。用于检测同浏览器换账户。
 */
const ACTIVE_USER_KEY = 'nova-active-user';

/**
 * 换账户清洗:若当前会话 userId 与本地标记不一致,说明本地白名单偏好是
 * 上一个账户残留的——清掉它们,避免新账户「读到别人的配置」以及水合时
 * 把别人的配置当成本地迁移**推到新账户云端**(双向污染)。
 *
 * 仅在能拿到 userId 时动作;拿不到(直接访问/老入口未带 user_id)则不动,
 * 保持纯本地行为不变。用 removeItem(不经写回钩子,不会触发上推)。
 */
function purgeStaleLocalSettingsOnUserSwitch(): void {
  if (typeof window === 'undefined') return;
  const userId = getSub2apiUserId();
  if (!userId) return;

  let marked: string | null = null;
  try {
    marked = window.localStorage.getItem(ACTIVE_USER_KEY);
  } catch {
    return;
  }

  if (marked === userId) return; // 同一账户,无需清洗

  if (marked !== null) {
    // 确实换了账户:清掉上一个账户残留的白名单偏好
    for (const key of SYNCED_SETTING_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
  // marked === null:首次记录归属(可能是历史本地数据,保留以走一次性迁移)
  try {
    window.localStorage.setItem(ACTIVE_USER_KEY, userId);
  } catch {
    // 配额/隐私模式:标记失败不致命
  }
}

/** 确保会话:已有 token 直接用;否则尝试从 URL query 提取(与 Sub2apiBootstrap 幂等)。 */
function ensureSession(): boolean {
  if (isSub2apiSession()) return true;
  if (typeof window === 'undefined') return false;
  try {
    const { token, userId } = parseBootstrapParams(window.location.search);
    if (token) {
      setSub2apiToken(token);
      if (userId) setSub2apiUserId(userId);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/** 把单个键的当前 localStorage 值推到后端(value 为原始字符串)。失败静默。 */
async function pushSetting(key: string, fetchImpl?: FetchImpl): Promise<void> {
  if (typeof window === 'undefined') return;
  const value = window.localStorage.getItem(key);
  if (value === null) return;
  try {
    await apiRequest(
      `/api/settings/${encodeURIComponent(key)}`,
      { method: 'PUT', json: { value } },
      fetchImpl,
    );
  } catch {
    // 写后端失败不致命:本地副本已在,留待下次变更重试
  }
}

/**
 * 从后端整体水合设置到 localStorage。返回是否真正执行(无会话返回 false)。
 * @param deps.fetchImpl 注入 fetch(测试用)
 */
export async function hydrateSettings(deps: { fetchImpl?: FetchImpl } = {}): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!ensureSession()) return false;

  // 换账户清洗:必须在读取/迁移本地值之前,避免读到或上推上一个账户的残留。
  purgeStaleLocalSettingsOnUserSwitch();

  let map: Record<string, unknown> = {};
  try {
    map = await apiRequest<Record<string, unknown>>('/api/settings', { method: 'GET' }, deps.fetchImpl);
  } catch {
    // 后端不可达:保留本地,不阻塞启动
    return false;
  }

  const pushUps: Array<Promise<void>> = [];
  for (const key of SYNCED_SETTING_KEYS) {
    const remote = map ? map[key] : undefined;
    if (typeof remote === 'string') {
      // PG 为准:覆盖本地
      try {
        window.localStorage.setItem(key, remote);
      } catch {
        // 配额/隐私模式
      }
    } else if (window.localStorage.getItem(key) !== null) {
      // PG 没有但本地有 → 一次性迁移上去
      pushUps.push(pushSetting(key, deps.fetchImpl));
    }
  }
  await Promise.all(pushUps);
  return true;
}

let writeThroughInstalled = false;
let originalSetItem: ((key: string, value: string) => void) | null = null;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 安装写回:包一层 localStorage.setItem,命中白名单键则 debounce 推后端。
 * 幂等(只装一次);无会话时只写本地、不推后端。
 *
 * 注意:必须改 `Storage.prototype.setItem` 而非 `localStorage.setItem`——
 * 后者在 jsdom(及部分实现)里会被当作存一个名为 "setItem" 的项,无法覆盖方法。
 * 改原型后用 `this === window.localStorage` 把行为限定在 localStorage(不影响 sessionStorage)。
 */
export function installSettingsWriteThrough(deps: { fetchImpl?: FetchImpl } = {}): void {
  if (writeThroughInstalled) return;
  if (typeof window === 'undefined' || !window.localStorage || typeof Storage === 'undefined') return;
  writeThroughInstalled = true;

  const proto = Storage.prototype;
  const original = proto.setItem;
  originalSetItem = original;
  proto.setItem = function patchedSetItem(this: Storage, key: string, value: string) {
    original.call(this, key, value);
    if (this !== window.localStorage) return;
    if (!SYNCED.has(key) || !isSub2apiSession()) return;
    const existing = pendingTimers.get(key);
    if (existing) clearTimeout(existing);
    pendingTimers.set(
      key,
      setTimeout(() => {
        pendingTimers.delete(key);
        void pushSetting(key, deps.fetchImpl);
      }, PUSH_DEBOUNCE_MS),
    );
  };
}

/** 仅供测试:重置安装状态、还原原型 setItem、清理计时器。 */
export function __resetSettingsSyncForTest(): void {
  if (originalSetItem && typeof Storage !== 'undefined') {
    Storage.prototype.setItem = originalSetItem;
  }
  originalSetItem = null;
  writeThroughInstalled = false;
  for (const t of pendingTimers.values()) clearTimeout(t);
  pendingTimers.clear();
}
