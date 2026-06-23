'use client';

/**
 * sub2api 入口用户标识(user_id)存储。
 *
 * 设计:
 * - 与 {@link import('./sub2api-token')} 同构:存 sessionStorage + 内存。
 * - 仅用于「同浏览器换账户时清洗本地偏好」(见 settings-sync 的水合清洗),
 *   不是机密,但按会话粒度存放更贴合"一个标签页一个登录态"的语义。
 */

const USER_ID_KEY = 'sub2api-user-id';

let memoryUserId: string | null = null;

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

/**
 * 写入 user_id(空白被忽略;数字会被规范化为字符串)。同时存内存与 sessionStorage。
 */
export function setSub2apiUserId(userId: string): void {
  const trimmed = userId === null || userId === undefined ? '' : String(userId).trim();
  if (!trimmed) {
    return;
  }
  memoryUserId = trimmed;
  if (hasSessionStorage()) {
    try {
      window.sessionStorage.setItem(USER_ID_KEY, trimmed);
    } catch {
      // 隐私模式等:仅保留内存副本
    }
  }
}

/**
 * 读取 user_id:优先内存,回落 sessionStorage。
 */
export function getSub2apiUserId(): string | null {
  if (memoryUserId) {
    return memoryUserId;
  }
  if (hasSessionStorage()) {
    try {
      const stored = window.sessionStorage.getItem(USER_ID_KEY);
      if (stored) {
        memoryUserId = stored;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 清除 user_id(内存 + sessionStorage)。
 */
export function clearSub2apiUserId(): void {
  memoryUserId = null;
  if (hasSessionStorage()) {
    try {
      window.sessionStorage.removeItem(USER_ID_KEY);
    } catch {
      // ignore
    }
  }
}
