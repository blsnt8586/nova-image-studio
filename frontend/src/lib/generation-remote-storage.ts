'use client';

import { generationsApi as defaultGenerationsApi, type GenerationRecord } from '@/lib/resource-clients';
import { presignPut as defaultPresignPut, presignGet as defaultPresignGet, uploadBlob as defaultUploadBlob } from '@/lib/storage-client';
import { isSub2apiSession, ApiError } from '@/lib/api-client';
import { notifyStorageLimit } from '@/lib/storage-limit-notifier';
import { hashBlob } from '@/lib/blob-hash';
import { getStoredBlob, fetchImageAsBlob } from '@/lib/image-downloader';
import { getImageSrc, type StoredJob } from '@/lib/job-store';

/**
 * 生图历史远端持久化(第一档)。
 *
 * sub2api 会话时:任务完成后把图片本体经预签名直传 MinIO,再把 objectKey
 * 与生成参数写入 generations 表 → 换设备/浏览器/origin 仍可取回。
 * 本地 IndexedDB 继续作为离线/降级副本(由 job-store 负责),这里只负责"上云"。
 *
 * 去重 + 上限:每张图 create 先行(带 contentHash),由后端判定:
 * - 命中去重 → 返回旧行(objectKey 不同)→ 跳过本体上传,避免孤儿对象;
 * - 达到上限 → 后端 409 → 停止后续上传,广播上限事件提示导出(本体仍留本地);
 * - 否则正常上传;上传失败回滚已登记行。
 *
 * 全部 best-effort:任何一步失败都吞掉,绝不影响本地展示与 UI。
 */

function mimeToExt(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

export interface GenerationRemoteDeps {
  isSession: () => boolean;
  presignPut: typeof defaultPresignPut;
  presignGet: typeof defaultPresignGet;
  uploadBlob: typeof defaultUploadBlob;
  generationsApi: Pick<typeof defaultGenerationsApi, 'list' | 'create' | 'remove'>;
  /** 取某个 job 第 index 张图的 Blob;先查本地 IndexedDB,再退回按 URL 下载。 */
  getBlob: (job: StoredJob, index: number) => Promise<Blob | null>;
}

const defaultDeps: GenerationRemoteDeps = {
  isSession: isSub2apiSession,
  presignPut: defaultPresignPut,
  presignGet: defaultPresignGet,
  uploadBlob: defaultUploadBlob,
  generationsApi: defaultGenerationsApi,
  getBlob: defaultGetBlob,
};

/** 默认 Blob 取法:本地 IndexedDB 优先,否则把可访问 URL 下载成 Blob。 */
async function defaultGetBlob(job: StoredJob, index: number): Promise<Blob | null> {
  const local = await getStoredBlob(job.id, index).catch(() => null);
  if (local) return local;

  const ref = job.images?.[index] ?? job.imageData;
  if (!ref) return null;
  const src = getImageSrc(ref);
  if (!src || src.startsWith('data:')) {
    // data: URL 也可下载,但通常已被存入 IndexedDB;此处仅处理 http(s)/blob
    if (src.startsWith('data:')) {
      return fetchImageAsBlob(src).catch(() => null);
    }
    return null;
  }
  return fetchImageAsBlob(src).catch(() => null);
}

/**
 * 把一个已完成 job 的图片上云并登记到 generations。
 * 返回成功登记的 objectKey 列表(可能为空)。仅在 sub2api 会话时执行。
 * 命中后端上限(409)时停止后续上传并广播事件;命中去重时跳过本体上传。
 */
export async function uploadGenerationToBackend(
  job: StoredJob,
  deps: Partial<GenerationRemoteDeps> = {},
): Promise<string[]> {
  const d = { ...defaultDeps, ...deps };
  if (!d.isSession()) return [];
  if (job.status !== 'completed') return [];

  const count = job.images?.length || (job.imageData ? 1 : 0);
  const keys: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const blob = await d.getBlob(job, i).catch(() => null);
    if (!blob) continue;

    const mime = blob.type || 'image/png';
    let newKey: string;
    let putUrl: string;
    try {
      const presigned = await d.presignPut('generation', mimeToExt(mime), mime);
      newKey = presigned.objectKey;
      putUrl = presigned.url;
    } catch {
      continue; // best-effort:单张失败不影响其余
    }

    const contentHash = await hashBlob(blob).catch(() => undefined);

    // create 先行:让后端按 contentHash 去重、按上限限流。
    let row: GenerationRecord;
    try {
      row = await d.generationsApi.create({
        mode: job.mode,
        modelId: job.model || '',
        prompt: job.prompt || '',
        objectKey: newKey,
        contentHash,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 达到上限:本体仍留本地,提示用户导出后清理;停止后续上传。
        notifyStorageLimit({ kind: 'generation', message: err.message });
        break;
      }
      continue;
    }

    // 命中去重:返回的是已存在旧行(objectKey 不同)→ 无需上传本体。
    if (row.objectKey && row.objectKey !== newKey) {
      keys.push(row.objectKey);
      continue;
    }

    // 全新行:上传本体;失败回滚已登记行。
    try {
      await d.uploadBlob(putUrl, blob);
      keys.push(newKey);
    } catch {
      try {
        await d.generationsApi.remove(row.id);
      } catch {
        // 回滚失败也吞掉(best-effort)
      }
    }
  }
  return keys;
}

export interface RemoteGeneration {
  id: string;
  mode: string;
  modelId: string;
  prompt: string;
  url: string;
  createdAt: string;
}

/**
 * 列出当前用户云端的生图历史,并为每条签发可读 URL。
 * 无会话或失败返回空数组(调用方退回纯本地历史)。
 */
export async function listRemoteGenerations(
  deps: Partial<GenerationRemoteDeps> = {},
): Promise<RemoteGeneration[]> {
  const d = { ...defaultDeps, ...deps };
  if (!d.isSession()) return [];

  let rows: GenerationRecord[];
  try {
    rows = await d.generationsApi.list();
  } catch {
    return [];
  }

  const out: RemoteGeneration[] = [];
  for (const row of rows) {
    try {
      const { url } = await d.presignGet(row.objectKey);
      out.push({
        id: row.id,
        mode: row.mode,
        modelId: row.modelId,
        prompt: row.prompt,
        url,
        createdAt: row.createdAt,
      });
    } catch {
      // 单条签发失败跳过
    }
  }
  return out;
}

/** 把 RemoteGeneration 映射成一个可直接展示的合成 StoredJob(图片走 URL: 直读,不落 IDB)。 */
function remoteGenerationToJob(remote: RemoteGeneration): StoredJob {
  const imageData = `URL:${remote.url}`;
  return {
    id: `remote-${remote.id}`,
    status: 'completed',
    mode: (remote.mode as StoredJob['mode']) || 'text-to-image',
    prompt: remote.prompt || '',
    output_size: 'auto',
    temperature: 0,
    aspect_ratio: 'auto',
    model: remote.modelId || '',
    created_at: remote.createdAt || new Date().toISOString(),
    imageData,
    images: [imageData],
    remoteGenerationId: remote.id,
  };
}

/**
 * 取回云端生图历史并与本地任务列表合并(跨设备展示)。
 * - 已经在本地的(按 remoteGenerationId 去重)跳过;
 * - 其余作为合成的 completed job 追加(图片经 presigned URL 直读,不写 IDB)。
 * 返回需要追加的合成 job 列表(可能为空)。无会话/失败返回 []。
 */
export async function buildRemoteGenerationJobs(
  existingJobs: StoredJob[],
  deps: Partial<GenerationRemoteDeps> = {},
): Promise<StoredJob[]> {
  const remote = await listRemoteGenerations(deps);
  if (remote.length === 0) return [];

  const known = new Set(
    existingJobs.map(job => job.remoteGenerationId).filter(Boolean) as string[],
  );
  const additions: StoredJob[] = [];
  for (const item of remote) {
    if (!item || known.has(item.id)) continue;
    additions.push(remoteGenerationToJob(item));
    known.add(item.id);
  }
  return additions;
}
