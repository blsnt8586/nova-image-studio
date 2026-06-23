'use client';

import { apiRequest, type FetchImpl } from '@/lib/api-client';

/**
 * MinIO 预签名直传客户端。
 * 上传流程:presignPut → 拿到 url+objectKey → uploadBlob(直传 MinIO) →
 * 把 objectKey 作为元数据写入对应资源(generations/assets)。
 */

export type StorageType = 'asset' | 'generation' | 'canvas';

export interface PresignResult {
  url: string;
  objectKey: string;
}

/** 申请上传用预签名 PUT。objectKey 由后端按当前用户生成,前端不可指定。 */
export function presignPut(
  type: StorageType,
  ext: string,
  contentType: string,
  fetchImpl?: FetchImpl,
): Promise<PresignResult> {
  return apiRequest<PresignResult>(
    '/api/storage/presign',
    { method: 'POST', json: { op: 'put', type, ext, contentType } },
    fetchImpl,
  );
}

/** 申请读取用预签名 GET。后端会校验 objectKey 属于当前用户。 */
export function presignGet(objectKey: string, fetchImpl?: FetchImpl): Promise<PresignResult> {
  return apiRequest<PresignResult>(
    '/api/storage/presign',
    { method: 'POST', json: { op: 'get', objectKey } },
    fetchImpl,
  );
}

/** 直传 blob 到预签名 URL(不带 Authorization,签名已含授权)。 */
export async function uploadBlob(
  url: string,
  blob: Blob,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const res = await fetchImpl(url, {
    method: 'PUT',
    body: blob,
    headers: blob.type ? { 'Content-Type': blob.type } : undefined,
  });
  if (!res.ok) {
    throw new Error(`上传失败 (HTTP ${res.status})`);
  }
}
