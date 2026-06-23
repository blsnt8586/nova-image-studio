'use client';

import { apiRequest, isSub2apiSession, type FetchImpl } from '@/lib/api-client';
import type { TextAsset } from '@/lib/asset-store';

/**
 * 文本素材(收藏的提示词)远端持久化。
 *
 * 文本素材无本体(blob),不走 MinIO/assets 表;而是把整个集合序列化为 JSON,
 * 经第二档「偏好设置」通道(/api/settings)存到 user_settings 的 `nova-text-assets` 键。
 * → 换设备/浏览器/origin 登录后可整体取回并合并进本地素材库。
 *
 * 设计要点:
 * - value 存 JSON 字符串(与 settings-sync 的原样字符串约定一致,jsonb 透明存取)。
 * - 仅 sub2api 会话时执行;全部 best-effort:任何一步失败都吞掉,不影响本地素材库。
 * - 注意:`nova-text-assets` **不在** 前端 SYNCED_SETTING_KEYS 里——
 *   文本素材存于 IndexedDB 而非 localStorage,故不能走 settings-sync 的水合/写回,
 *   必须由本模块显式 push/fetch。该键只需在后端 ALLOWED_SETTING_KEYS 白名单内即可。
 */

export const TEXT_ASSETS_SETTING_KEY = 'nova-text-assets';

export interface TextAssetRemoteDeps {
  isSession: () => boolean;
  fetchImpl?: FetchImpl;
}

const defaultDeps: TextAssetRemoteDeps = {
  isSession: isSub2apiSession,
};

/**
 * 把整个文本素材集合推到后端(value 为 JSON 字符串)。失败静默。
 * 仅 sub2api 会话时执行。
 */
export async function pushTextAssets(
  assets: TextAsset[],
  deps: Partial<TextAssetRemoteDeps> = {},
): Promise<boolean> {
  const d = { ...defaultDeps, ...deps };
  if (!d.isSession()) return false;

  try {
    const value = JSON.stringify(assets);
    await apiRequest(
      `/api/settings/${encodeURIComponent(TEXT_ASSETS_SETTING_KEY)}`,
      { method: 'PUT', json: { value } },
      d.fetchImpl,
    );
    return true;
  } catch {
    // 写后端失败不致命:本地副本仍在,留待下次变更重试
    return false;
  }
}

/**
 * 从后端取回文本素材集合。无会话/不可达/解析失败返回空数组(调用方退回本地)。
 */
export async function fetchRemoteTextAssets(
  deps: Partial<TextAssetRemoteDeps> = {},
): Promise<TextAsset[]> {
  const d = { ...defaultDeps, ...deps };
  if (!d.isSession()) return [];

  let map: Record<string, unknown>;
  try {
    map = await apiRequest<Record<string, unknown>>('/api/settings', { method: 'GET' }, d.fetchImpl);
  } catch {
    return [];
  }

  const raw = map ? map[TEXT_ASSETS_SETTING_KEY] : undefined;
  if (typeof raw !== 'string') return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 只保留结构合理的文本素材项
    return parsed.filter(
      (item): item is TextAsset =>
        Boolean(item) &&
        typeof item === 'object' &&
        item.kind === 'text' &&
        typeof item.id === 'string' &&
        typeof item.hash === 'string' &&
        typeof item.content === 'string',
    );
  } catch {
    return [];
  }
}
