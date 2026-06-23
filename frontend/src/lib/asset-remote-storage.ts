'use client';

import { assetsApi as defaultAssetsApi, type AssetRecord } from '@/lib/resource-clients';
import { presignPut as defaultPresignPut, presignGet as defaultPresignGet, uploadBlob as defaultUploadBlob } from '@/lib/storage-client';
import { isSub2apiSession, ApiError } from '@/lib/api-client';
import { notifyStorageLimit } from '@/lib/storage-limit-notifier';
import type { ImageAsset } from '@/lib/asset-store';

/**
 * 素材库远端持久化(第一档)。
 *
 * sub2api 会话时:新增图片素材后把本体经预签名直传 MinIO,再把 objectKey 与
 * 元数据写入 assets 表 → 换设备/浏览器/origin 仍可取回。
 * 本地 IndexedDB 继续作为离线/降级副本(由 asset-store 负责)。
 *
 * 去重 + 上限:create 先行(带 contentHash),由后端判定:
 * - 命中去重(同用户同 hash 已存在)→ 返回旧行(objectKey 与本次新签 key 不同)→ 跳过本体上传,避免产生孤儿对象;
 * - 达到每用户上限 → 后端 409 → 不上传,本体仍留本地,并广播上限事件提示导出;
 * - 否则正常上传;上传失败回滚已登记的行。
 *
 * 注意:文本素材(saved prompts)无本体,assets 表要求 object_key,故文本素材暂不
 * 上云(仍存本地)。如需跨设备同步文本素材,后续可归入 user_settings 或新表。
 *
 * 全部 best-effort:任何一步失败都吞掉,不影响本地素材库。
 */

function mimeToExt(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

export interface AssetRemoteDeps {
  isSession: () => boolean;
  presignPut: typeof defaultPresignPut;
  presignGet: typeof defaultPresignGet;
  uploadBlob: typeof defaultUploadBlob;
  assetsApi: Pick<typeof defaultAssetsApi, 'list' | 'create' | 'remove'>;
}

const defaultDeps: AssetRemoteDeps = {
  isSession: isSub2apiSession,
  presignPut: defaultPresignPut,
  presignGet: defaultPresignGet,
  uploadBlob: defaultUploadBlob,
  assetsApi: defaultAssetsApi,
};

/**
 * 把一个图片素材上云并登记到 assets。返回最终 objectKey 或 null(未做/失败/上限)。
 * 仅 sub2api 会话时执行。create 先行以便后端去重/限流;命中去重时跳过本体上传。
 */
export async function uploadAssetToBackend(
  asset: ImageAsset,
  blob: Blob,
  deps: Partial<AssetRemoteDeps> = {},
): Promise<string | null> {
  const d = { ...defaultDeps, ...deps };
  if (!d.isSession()) return null;
  if (!blob) return null;

  const mime = blob.type || asset.mimeType || 'image/png';
  let newKey: string;
  let putUrl: string;
  try {
    const presigned = await d.presignPut('asset', mimeToExt(mime), mime);
    newKey = presigned.objectKey;
    putUrl = presigned.url;
  } catch {
    return null;
  }

  // create 先行:让后端按 contentHash 去重、按上限限流(不浪费一次 MinIO PUT)。
  let row: AssetRecord;
  try {
    row = await d.assetsApi.create({
      objectKey: newKey,
      mime,
      size: blob.size,
      kind: 'image',
      name: asset.name || '',
      contentHash: asset.hash || undefined,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      notifyStorageLimit({ kind: 'asset', message: err.message });
    }
    return null;
  }

  // 命中去重:后端返回的是已存在的旧行(objectKey 不等于本次新签 key)→ 无需上传本体。
  if (row.objectKey && row.objectKey !== newKey) {
    return row.objectKey;
  }

  // 全新行:上传本体;失败则回滚已登记行,避免悬空记录。
  try {
    await d.uploadBlob(putUrl, blob);
    return newKey;
  } catch {
    try {
      await d.assetsApi.remove(row.id);
    } catch {
      // 回滚失败也吞掉(best-effort)
    }
    return null;
  }
}

export interface RemoteAsset {
  id: string;
  objectKey: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: string;
}

/**
 * 列出当前用户云端的图片素材并签发可读 URL。
 * 无会话或失败返回空数组(调用方退回本地素材库)。
 */
export async function listRemoteAssets(
  deps: Partial<AssetRemoteDeps> = {},
): Promise<RemoteAsset[]> {
  const d = { ...defaultDeps, ...deps };
  if (!d.isSession()) return [];

  let rows: AssetRecord[];
  try {
    rows = await d.assetsApi.list();
  } catch {
    return [];
  }

  const out: RemoteAsset[] = [];
  for (const row of rows) {
    try {
      const { url } = await d.presignGet(row.objectKey);
      out.push({
        id: row.id,
        objectKey: row.objectKey,
        name: row.name,
        mime: row.mime,
        size: row.size,
        url,
        createdAt: row.createdAt,
      });
    } catch {
      // 单条签发失败跳过
    }
  }
  return out;
}
