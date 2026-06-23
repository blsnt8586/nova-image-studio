'use client';

/**
 * 云端存储上限通知(轻量事件总线)。
 *
 * 上云路径(素材/生图)命中后端 409(达到每用户上限)时,best-effort 调用
 * notifyStorageLimit;UI 层(WorkspaceShell)订阅后弹 toast,提示用户先导出/
 * 备份再清理。图片仍保留在本地 IndexedDB,只是未同步到云端,故纯提示、不阻塞。
 */

export type StorageLimitKind = 'asset' | 'generation';

export interface StorageLimitEvent {
  kind: StorageLimitKind;
  message: string;
}

type Listener = (event: StorageLimitEvent) => void;

const listeners = new Set<Listener>();

/** 订阅上限事件。返回取消订阅函数。 */
export function onStorageLimit(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 广播一次上限事件。单个订阅者抛错不影响其余。 */
export function notifyStorageLimit(event: StorageLimitEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // 隔离订阅者异常
    }
  }
}
