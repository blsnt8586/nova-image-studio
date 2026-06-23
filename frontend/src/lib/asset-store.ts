'use client';

import { uploadAssetToBackend, listRemoteAssets, type RemoteAsset } from '@/lib/asset-remote-storage';
import { pushTextAssets, fetchRemoteTextAssets } from '@/lib/text-asset-remote-storage';
import { hashBlob } from '@/lib/blob-hash';

export type AssetSourceKind =
  | 'text-to-image'
  | 'image-to-image'
  | 'agent'
  | 'reverse-prompt'
  | 'gif'
  | 'upload'
  | 'random'
  | 'prompt-gallery'
  | 'manual';

export type AssetKind = 'image' | 'text';

export interface ImageAsset {
  id: string;
  kind?: 'image';
  blobKey: string;
  hash: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  tags: string[];
  note: string;
  sourceKind: AssetSourceKind;
  sourceLabel: string;
  sourceRef?: string;
  prompt?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface TextAsset {
  id: string;
  kind: 'text';
  hash: string;
  content: string;
  sizeBytes: number;
  sourceKind: AssetSourceKind;
  sourceLabel: string;
  sourceRef?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export type AssetItem = ImageAsset | TextAsset;

export interface AssetBlobRecord {
  key: string;
  hash: string;
  blob: Blob;
  thumbnailBlob?: Blob;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface AddImageAssetInput {
  blob: Blob;
  name?: string;
  tags?: string[];
  note?: string;
  sourceKind: AssetSourceKind;
  sourceLabel?: string;
  sourceRef?: string;
  prompt?: string;
}

export interface UpdateImageAssetInput {
  name?: string;
  tags?: string[];
  note?: string;
}

export interface AddTextAssetInput {
  content: string;
  sourceKind: AssetSourceKind;
  sourceLabel?: string;
  sourceRef?: string;
}

const DB_NAME = 'nova-assets-db';
const DB_VERSION = 1;
const ASSETS_STORE = 'assets';
const BLOBS_STORE = 'asset-blobs';
const THUMB_MAX_SIDE = 512;

function now(): number {
  return Date.now();
}

function makeId(prefix = 'asset'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashText(text: string): Promise<string> {
  const normalized = text.trim();
  const encoder = new TextEncoder();
  const buffer = encoder.encode(normalized);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
    return `text-${bufferToHex(digest)}`;
  }
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `text-fnv32-${buffer.length}-${hash.toString(16).padStart(8, '0')}`;
}

function isTextAsset(asset: AssetItem | null | undefined): asset is TextAsset {
  return asset?.kind === 'text';
}

function isImageAsset(asset: AssetItem | null | undefined): asset is ImageAsset {
  return Boolean(asset) && asset?.kind !== 'text';
}

export function getAssetFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('avif')) return 'avif';
  return 'png';
}

function sanitizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const unique = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag) unique.add(tag);
  }
  return Array.from(unique);
}

function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function getImageDimensionsAndThumbnail(blob: Blob): Promise<{
  width?: number;
  height?: number;
  thumbnailBlob?: Blob;
}> {
  if (typeof document === 'undefined') return {};
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromObjectUrl(url);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return {};

    const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(width, height));
    const thumbWidth = Math.max(1, Math.round(width * scale));
    const thumbHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { width, height };
    ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);
    const thumbnailBlob = await canvasToBlob(canvas, 'image/webp', 0.82);
    return { width, height, thumbnailBlob: thumbnailBlob || undefined };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openAssetsDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const store = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
        store.createIndex('hash', 'hash', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: 'key' });
      }
    };
  });
}

function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise(resolve => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => resolve([]);
  });
}

function getFromStore<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | null> {
  return new Promise(resolve => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve((req.result as T) || null);
    req.onerror = () => resolve(null);
  });
}

async function putAssetAndBlob(asset: AssetItem, blobRecord: AssetBlobRecord | null): Promise<void> {
  const db = await openAssetsDB();
  if (!db) throw new Error('当前浏览器不支持素材库本地存储');
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ASSETS_STORE, BLOBS_STORE], 'readwrite');
    if (blobRecord) tx.objectStore(BLOBS_STORE).put(blobRecord);
    tx.objectStore(ASSETS_STORE).put(asset);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => {
      const error = tx.error || new Error('素材库写入失败');
      db.close();
      reject(error);
    };
  });
}

export async function addImageAsset(input: AddImageAssetInput): Promise<ImageAsset> {
  const sourceBlob = input.blob;
  const mimeType = sourceBlob.type || 'image/png';
  const hash = await hashBlob(sourceBlob);
  const key = hash;
  const createdAt = now();
  const db = await openAssetsDB();
  if (!db) {
    throw new Error('当前浏览器不支持素材库本地存储');
  }

  let existingBlob: AssetBlobRecord | null = null;
  let existingAssets: AssetItem[] = [];
  existingBlob = await getFromStore<AssetBlobRecord>(db, BLOBS_STORE, key);
  existingAssets = await getAllFromStore<AssetItem>(db, ASSETS_STORE);
  db.close();

  const sameSourceAsset = existingAssets.filter(isImageAsset).find(asset =>
    asset.hash === hash &&
    asset.sourceKind === input.sourceKind &&
    asset.sourceRef &&
    asset.sourceRef === input.sourceRef
  );
  if (sameSourceAsset) {
    const updated: ImageAsset = {
      ...sameSourceAsset,
      lastUsedAt: createdAt,
      updatedAt: createdAt,
      tags: sanitizeTags([...sameSourceAsset.tags, ...(input.tags || [])]),
      note: input.note || sameSourceAsset.note,
    };
    await putAssetAndBlob(updated, null);
    return updated;
  }

  const dimensions: { width?: number; height?: number; thumbnailBlob?: Blob } = existingBlob
    ? { width: existingBlob.width, height: existingBlob.height }
    : await getImageDimensionsAndThumbnail(sourceBlob);
  const blobRecord: AssetBlobRecord | null = existingBlob
    ? null
    : {
      key,
      hash,
      blob: sourceBlob,
      thumbnailBlob: dimensions.thumbnailBlob,
      mimeType,
      sizeBytes: sourceBlob.size,
      width: dimensions.width,
      height: dimensions.height,
      createdAt,
    };

  const asset: ImageAsset = {
    id: makeId(),
    kind: 'image',
    blobKey: key,
    hash,
    name: input.name?.trim() || `素材-${new Date(createdAt).toLocaleString()}`,
    mimeType,
    sizeBytes: sourceBlob.size,
    width: dimensions.width,
    height: dimensions.height,
    tags: sanitizeTags(input.tags),
    note: input.note?.trim() || '',
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel || getSourceKindLabel(input.sourceKind),
    sourceRef: input.sourceRef,
    prompt: input.prompt,
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: createdAt,
  };
  await putAssetAndBlob(asset, blobRecord);
  // 上云(第一档持久化):best-effort,不阻塞、失败不影响本地素材库。
  void uploadAssetToBackend(asset, sourceBlob).catch(() => undefined);
  return asset;
}

export async function addTextAsset(input: AddTextAssetInput): Promise<TextAsset> {
  const content = input.content.trim();
  if (!content) throw new Error('提示词内容不能为空');
  const hash = await hashText(content);
  const createdAt = now();
  const db = await openAssetsDB();
  if (!db) {
    throw new Error('当前浏览器不支持素材库本地存储');
  }

  const assets = await getAllFromStore<AssetItem>(db, ASSETS_STORE);
  db.close();
  const existing = assets.find(asset => isTextAsset(asset) && asset.hash === hash);
  if (existing && isTextAsset(existing)) {
    const updated: TextAsset = {
      ...existing,
      lastUsedAt: createdAt,
      updatedAt: createdAt,
    };
    await putAssetAndBlob(updated, null);
    void pushAllTextAssets().catch(() => undefined);
    return updated;
  }

  const asset: TextAsset = {
    id: makeId('text-asset'),
    kind: 'text',
    hash,
    content,
    sizeBytes: new TextEncoder().encode(content).byteLength,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel || getSourceKindLabel(input.sourceKind),
    sourceRef: input.sourceRef,
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: createdAt,
  };
  await putAssetAndBlob(asset, null);
  void pushAllTextAssets().catch(() => undefined);
  return asset;
}

/**
 * 把当前本地全部文本素材集合推到后端(best-effort)。供新增/删除文本素材后调用。
 * 文本素材无本体,整体作为 JSON 存入 user_settings(详见 text-asset-remote-storage)。
 */
async function pushAllTextAssets(): Promise<void> {
  const texts = await listTextAssets();
  await pushTextAssets(texts);
}

/**
 * 从后端取回文本素材并把本地缺失的(按 hash 去重)合并进本地素材库。
 * best-effort:无会话/失败时不做任何事,不抛错。换设备登录后调用即可看到云端收藏的提示词。
 */
export async function syncRemoteTextAssets(): Promise<void> {
  let remote: TextAsset[];
  try {
    remote = await fetchRemoteTextAssets();
  } catch {
    return;
  }
  if (remote.length === 0) return;

  let local: TextAsset[];
  try {
    local = await listTextAssets();
  } catch {
    return;
  }
  const localHashes = new Set(local.map(item => item.hash));

  for (const item of remote) {
    if (!item || item.kind !== 'text' || localHashes.has(item.hash)) continue;
    try {
      await putAssetAndBlob(item, null);
      localHashes.add(item.hash);
    } catch {
      // 单条写入失败跳过,不影响其余
    }
  }
}

/**
 * 把一个云端图片素材下载进本地 IndexedDB(不回传上云,避免循环)。
 * 按内容 hash 去重;以 objectKey 记到 sourceRef 上,便于下次跳过已导入项。
 * 失败抛错由调用方吞掉。
 */
async function importRemoteImageAsset(remote: RemoteAsset): Promise<void> {
  const resp = await fetch(remote.url);
  if (!resp.ok) throw new Error(`下载云端素材失败 (HTTP ${resp.status})`);
  const blob = await resp.blob();
  const mimeType = blob.type || remote.mime || 'image/png';
  const hash = await hashBlob(blob);
  const key = hash;
  const createdAt = remote.createdAt ? Date.parse(remote.createdAt) || now() : now();

  const db = await openAssetsDB();
  if (!db) throw new Error('当前浏览器不支持素材库本地存储');
  const existingBlob = await getFromStore<AssetBlobRecord>(db, BLOBS_STORE, key);
  const existingAssets = await getAllFromStore<AssetItem>(db, ASSETS_STORE);
  db.close();

  // 已存在同内容素材:仅补登记 objectKey(标记为已导入),不重复建项
  const sameContent = existingAssets
    .filter(isImageAsset)
    .find(asset => asset.hash === hash);
  if (sameContent) {
    if (sameContent.sourceRef !== remote.objectKey) {
      await putAssetAndBlob({ ...sameContent, sourceRef: remote.objectKey, updatedAt: now() }, null);
    }
    return;
  }

  const dimensions = existingBlob
    ? { width: existingBlob.width, height: existingBlob.height, thumbnailBlob: undefined as Blob | undefined }
    : await getImageDimensionsAndThumbnail(blob);
  const blobRecord: AssetBlobRecord | null = existingBlob
    ? null
    : {
      key,
      hash,
      blob,
      thumbnailBlob: dimensions.thumbnailBlob,
      mimeType,
      sizeBytes: blob.size,
      width: dimensions.width,
      height: dimensions.height,
      createdAt,
    };

  const asset: ImageAsset = {
    id: makeId(),
    kind: 'image',
    blobKey: key,
    hash,
    name: remote.name || `素材-${new Date(createdAt).toLocaleString()}`,
    mimeType,
    sizeBytes: blob.size,
    width: dimensions.width,
    height: dimensions.height,
    tags: [],
    note: '',
    sourceKind: 'upload',
    sourceLabel: getSourceKindLabel('upload'),
    sourceRef: remote.objectKey,
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: createdAt,
  };
  await putAssetAndBlob(asset, blobRecord);
}

/**
 * 从后端取回图片素材并把本地缺失的下载合并进本地素材库(best-effort)。
 * 已按 objectKey 导入过的跳过;无会话/失败时不做任何事,不抛错。
 * 换设备登录后调用即可看到云端图片素材。
 */
export async function syncRemoteImageAssets(): Promise<void> {
  let remote: RemoteAsset[];
  try {
    remote = await listRemoteAssets();
  } catch {
    return;
  }
  if (remote.length === 0) return;

  let local: AssetItem[];
  try {
    local = await listAssets('image');
  } catch {
    return;
  }
  // 已导入的 objectKey 集合:跳过避免重复下载
  const importedKeys = new Set(
    local.filter(isImageAsset).map(asset => asset.sourceRef).filter(Boolean) as string[],
  );

  for (const item of remote) {
    if (!item || !item.objectKey || importedKeys.has(item.objectKey)) continue;
    try {
      await importRemoteImageAsset(item);
      importedKeys.add(item.objectKey);
    } catch {
      // 单条下载/写入失败跳过,不影响其余
    }
  }
}

export async function findImageAssetByBlob(blob: Blob): Promise<ImageAsset | null> {
  const hash = await hashBlob(blob);
  const db = await openAssetsDB();
  if (!db) return null;
  const assets = await getAllFromStore<AssetItem>(db, ASSETS_STORE);
  db.close();
  return assets.filter(isImageAsset).find(asset => asset.hash === hash) || null;
}

export async function listAssets(kind?: AssetKind): Promise<AssetItem[]> {
  const db = await openAssetsDB();
  if (!db) return [];
  const assets = await getAllFromStore<AssetItem>(db, ASSETS_STORE);
  db.close();
  return assets
    .filter(asset => {
      if (!kind) return true;
      if (kind === 'image') return isImageAsset(asset);
      return isTextAsset(asset);
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function listImageAssets(): Promise<ImageAsset[]> {
  const assets = await listAssets('image');
  return assets.filter(isImageAsset);
}

export async function listTextAssets(): Promise<TextAsset[]> {
  const assets = await listAssets('text');
  return assets.filter(isTextAsset);
}

export async function getImageAsset(assetId: string): Promise<ImageAsset | null> {
  const db = await openAssetsDB();
  if (!db) return null;
  const asset = await getFromStore<AssetItem>(db, ASSETS_STORE, assetId);
  db.close();
  return isImageAsset(asset) ? asset : null;
}

export async function getTextAsset(assetId: string): Promise<TextAsset | null> {
  const db = await openAssetsDB();
  if (!db) return null;
  const asset = await getFromStore<AssetItem>(db, ASSETS_STORE, assetId);
  db.close();
  return isTextAsset(asset) ? asset : null;
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  const asset = await getImageAsset(assetId);
  if (!asset) return null;
  const db = await openAssetsDB();
  if (!db) return null;
  const record = await getFromStore<AssetBlobRecord>(db, BLOBS_STORE, asset.blobKey);
  db.close();
  return record?.blob || null;
}

export async function getAssetThumbnailBlob(asset: ImageAsset): Promise<Blob | null> {
  const db = await openAssetsDB();
  if (!db) return null;
  const record = await getFromStore<AssetBlobRecord>(db, BLOBS_STORE, asset.blobKey);
  db.close();
  return record?.thumbnailBlob || record?.blob || null;
}

export async function updateImageAsset(assetId: string, input: UpdateImageAssetInput): Promise<void> {
  const current = await getImageAsset(assetId);
  if (!current) throw new Error('素材不存在');
  const updated: ImageAsset = {
    ...current,
    name: input.name?.trim() || current.name,
    tags: input.tags ? sanitizeTags(input.tags) : current.tags,
    note: typeof input.note === 'string' ? input.note : current.note,
    updatedAt: now(),
  };
  await putAssetAndBlob(updated, null);
}

export async function touchImageAsset(assetId: string): Promise<void> {
  const current = await getImageAsset(assetId);
  if (!current) return;
  await putAssetAndBlob({ ...current, lastUsedAt: now(), updatedAt: now() }, null);
}

export async function touchAsset(assetId: string): Promise<void> {
  const db = await openAssetsDB();
  if (!db) return;
  const asset = await getFromStore<AssetItem>(db, ASSETS_STORE, assetId);
  db.close();
  if (!asset) return;
  await putAssetAndBlob({ ...asset, lastUsedAt: now(), updatedAt: now() }, null);
}

export async function deleteAsset(assetId: string): Promise<void> {
  const db = await openAssetsDB();
  if (!db) throw new Error('当前浏览器不支持素材库本地存储');
  const asset = await getFromStore<AssetItem>(db, ASSETS_STORE, assetId);
  if (!asset) {
    db.close();
    throw new Error('素材不存在');
  }
  const assets = await getAllFromStore<AssetItem>(db, ASSETS_STORE);
  const shouldDeleteBlob = isImageAsset(asset) && assets.filter(item => isImageAsset(item) && item.id !== assetId && item.blobKey === asset.blobKey).length === 0;
  const wasTextAsset = isTextAsset(asset);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ASSETS_STORE, BLOBS_STORE], 'readwrite');
    tx.objectStore(ASSETS_STORE).delete(assetId);
    if (isImageAsset(asset) && shouldDeleteBlob) tx.objectStore(BLOBS_STORE).delete(asset.blobKey);
    tx.oncomplete = () => {
      db.close();
      // 文本素材删除后,把更新后的集合推到后端(best-effort,不阻塞)
      if (wasTextAsset) void pushAllTextAssets().catch(() => undefined);
      resolve();
    };
    tx.onerror = () => {
      const error = tx.error || new Error('素材删除失败');
      db.close();
      reject(error);
    };
  });
}

export async function deleteImageAsset(assetId: string): Promise<void> {
  await deleteAsset(assetId);
}

export function getSourceKindLabel(kind: AssetSourceKind): string {
  switch (kind) {
    case 'text-to-image': return '文生图';
    case 'image-to-image': return '图生图';
    case 'agent': return 'Agent';
    case 'reverse-prompt': return '反推提示词';
    case 'gif': return 'GIF 工作流';
    case 'upload': return '用户上传';
    case 'random': return '随机图片';
    case 'prompt-gallery': return '提示词广场';
    case 'manual': return '手动导入';
    default: return '图片素材';
  }
}

export function formatAssetSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '未知大小';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`;
}
