'use client';

import { apiRequest, type FetchImpl } from '@/lib/api-client';

/**
 * 业务资源 REST 客户端(canvases / generations / assets)。
 * 全部经 apiRequest(带 JWT、解析信封),后端按 user_id 隔离。
 * 仅在 sub2api 会话时使用;无会话时调用方退回本地存储。
 */

export interface CanvasRecord {
  id: string;
  userId: string;
  name: string;
  snapshotJson: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasCreateInput {
  name?: string;
  snapshotJson: unknown;
}

export interface CanvasUpdateInput {
  name?: string;
  snapshotJson?: unknown;
}

export const canvasesApi = {
  list: (fetchImpl?: FetchImpl) =>
    apiRequest<CanvasRecord[]>('/api/canvases', { method: 'GET' }, fetchImpl),
  get: (id: string, fetchImpl?: FetchImpl) =>
    apiRequest<CanvasRecord>(`/api/canvases/${encodeURIComponent(id)}`, { method: 'GET' }, fetchImpl),
  create: (input: CanvasCreateInput, fetchImpl?: FetchImpl) =>
    apiRequest<CanvasRecord>('/api/canvases', { method: 'POST', json: input }, fetchImpl),
  update: (id: string, input: CanvasUpdateInput, fetchImpl?: FetchImpl) =>
    apiRequest<CanvasRecord>(`/api/canvases/${encodeURIComponent(id)}`, { method: 'PUT', json: input }, fetchImpl),
  remove: (id: string, fetchImpl?: FetchImpl) =>
    apiRequest<{ id: string }>(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' }, fetchImpl),
};

export interface GenerationRecord {
  id: string;
  userId: string;
  mode: string;
  modelId: string;
  prompt: string;
  objectKey: string;
  createdAt: string;
}

export interface GenerationCreateInput {
  mode: string;
  modelId?: string;
  prompt?: string;
  objectKey: string;
  /** 图片本体内容 hash;后端按 (user_id, content_hash) 去重。 */
  contentHash?: string;
}

export const generationsApi = {
  list: (fetchImpl?: FetchImpl) =>
    apiRequest<GenerationRecord[]>('/api/generations', { method: 'GET' }, fetchImpl),
  create: (input: GenerationCreateInput, fetchImpl?: FetchImpl) =>
    apiRequest<GenerationRecord>('/api/generations', { method: 'POST', json: input }, fetchImpl),
  remove: (id: string, fetchImpl?: FetchImpl) =>
    apiRequest<{ id: string }>(`/api/generations/${encodeURIComponent(id)}`, { method: 'DELETE' }, fetchImpl),
};

export interface AssetRecord {
  id: string;
  userId: string;
  objectKey: string;
  mime: string;
  size: number;
  kind: string;
  name: string;
  createdAt: string;
}

export interface AssetCreateInput {
  objectKey: string;
  mime?: string;
  size?: number;
  kind?: string;
  name?: string;
  /** 素材本体内容 hash;后端按 (user_id, content_hash) 去重。 */
  contentHash?: string;
}

export const assetsApi = {
  list: (fetchImpl?: FetchImpl) =>
    apiRequest<AssetRecord[]>('/api/assets', { method: 'GET' }, fetchImpl),
  create: (input: AssetCreateInput, fetchImpl?: FetchImpl) =>
    apiRequest<AssetRecord>('/api/assets', { method: 'POST', json: input }, fetchImpl),
  remove: (id: string, fetchImpl?: FetchImpl) =>
    apiRequest<{ id: string }>(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }, fetchImpl),
};
