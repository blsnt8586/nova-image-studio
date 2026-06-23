'use client';

/**
 * 内容 hash 工具(SHA-256,降级 fnv32)。
 *
 * 与后端去重约定一致:同一份图片本体产生同一 contentHash,后端按
 * (user_id, content_hash) 去重,避免重复上云/重复入库占用存储。
 *
 * 从 asset-store 抽出,供素材库与生图历史两条上云路径共用同一实现。
 */

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 计算 Blob 的内容 hash。优先 SHA-256;无 WebCrypto 时退回带长度前缀的 fnv32。 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
    return bufferToHex(digest);
  }
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv32-${blob.size}-${hash.toString(16).padStart(8, '0')}`;
}
