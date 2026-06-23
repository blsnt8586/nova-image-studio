'use client';

import { canvasesApi as defaultCanvasesApi } from '@/lib/resource-clients';
import { isSub2apiSession } from '@/lib/api-client';
import { localForageStorage } from '@/components/canvas/lib/localforage-storage';

/**
 * 画布持久化适配器(阶段 3)。
 *
 * 设计:复用 Zustand persist 的 PersistStorage 接缝,整存整取。
 * - sub2api 会话:把整个 store 快照存为后端一行「workspace」画布(按 user_id 隔离),
 *   换设备/浏览器登录后仍可取回;后端异常时降级到本地 localForage。
 * - 非会话(单机模式):原样走 localForage。
 *
 * 选择整存整取而非按 project 拆行,是为了:
 * 1) 与现有 store 形状零耦合(store 仍认为自己在用一个 KV);
 * 2) 一次往返即可同步,避免多 project 的 N+1。
 */

const WORKSPACE_NAME = 'workspace';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StorageValue = { state: any; version?: number };

interface CanvasesApiLike {
  list: (...args: unknown[]) => Promise<Array<{ id: string; name?: string; snapshotJson?: unknown }>>;
  create: (input: { name?: string; snapshotJson: unknown }, ...args: unknown[]) => Promise<{ id: string }>;
  update: (id: string, input: { name?: string; snapshotJson?: unknown }, ...args: unknown[]) => Promise<unknown>;
}

interface LocalLike {
  getItem: (k: string) => string | null | Promise<string | null>;
  setItem: (k: string, v: string) => unknown;
  removeItem: (k: string) => unknown;
}

export interface CanvasPersistDeps {
  local: LocalLike;
  isSession: () => boolean;
  canvasesApi: CanvasesApiLike;
}

/**
 * 构造画布 PersistStorage。依赖注入便于单测。
 */
export function createCanvasPersistStorage(deps: CanvasPersistDeps) {
  const { local, isSession, canvasesApi } = deps;
  // 记住已发现的 workspace 画布行 id,后续走 update 而非 create
  let workspaceId: string | null = null;

  async function readLocal(name: string): Promise<StorageValue | null> {
    const raw = await local.getItem(name);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StorageValue;
    } catch {
      return null;
    }
  }

  async function getItem(name: string): Promise<StorageValue | null> {
    if (!isSession()) {
      return readLocal(name);
    }
    try {
      const rows = await canvasesApi.list();
      const row = rows.find((r) => r.name === WORKSPACE_NAME) || rows[0];
      if (!row) return null;
      workspaceId = row.id;
      return (row.snapshotJson as StorageValue) ?? null;
    } catch {
      // 后端不可达时不致命:降级到本地缓存,避免画布"消失"
      return readLocal(name);
    }
  }

  async function setItem(name: string, value: StorageValue): Promise<void> {
    // 始终写一份本地缓存,作为离线/降级副本
    try {
      await local.setItem(name, JSON.stringify(value));
    } catch {
      // 本地写失败不致命
    }

    if (!isSession()) return;

    try {
      if (!workspaceId) {
        // 尚未发现 → 先查一次,避免重复创建
        const rows = await canvasesApi.list();
        const existing = rows.find((r) => r.name === WORKSPACE_NAME) || rows[0];
        if (existing) workspaceId = existing.id;
      }
      if (workspaceId) {
        await canvasesApi.update(workspaceId, { snapshotJson: value });
      } else {
        const created = await canvasesApi.create({ name: WORKSPACE_NAME, snapshotJson: value });
        workspaceId = created.id;
      }
    } catch {
      // 写后端失败:本地副本已写,留待下次同步;不抛出以免打断 UI
    }
  }

  async function removeItem(name: string): Promise<void> {
    await local.removeItem(name);
  }

  return { getItem, setItem, removeItem };
}

/** 生产环境用的单例适配器(接真实 localForage + 后端 client)。 */
export const canvasPersistStorage = createCanvasPersistStorage({
  local: localForageStorage,
  isSession: isSub2apiSession,
  canvasesApi: defaultCanvasesApi as unknown as CanvasesApiLike,
});
