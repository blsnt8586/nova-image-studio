'use client';

/**
 * sub2api 入口 token(JWT)存储。
 *
 * 设计:
 * - 真 JWT 只存 sessionStorage + 内存,绝不进 localStorage / 模型 registry。
 * - registry 里的代理模型 apiKey 用中性哨兵 {@link SUB2API_PROXY_API_KEY} 占位,
 *   发请求前由 {@link resolveAuthApiKey} 换成 live JWT。
 */

const TOKEN_KEY = 'sub2api-token';

/** 代理模型在 registry 中占位的中性 apiKey(非机密,可安全落 localStorage)。 */
export const SUB2API_PROXY_API_KEY = '__sub2api_proxy__';

let memoryToken: string | null = null;

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

/**
 * 写入 token(空白被忽略)。同时存内存与 sessionStorage。
 */
export function setSub2apiToken(token: string): void {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    return;
  }
  memoryToken = trimmed;
  if (hasSessionStorage()) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, trimmed);
    } catch {
      // 隐私模式等:仅保留内存副本
    }
  }
}

/**
 * 读取 token:优先内存,回落 sessionStorage。
 */
export function getSub2apiToken(): string | null {
  if (memoryToken) {
    return memoryToken;
  }
  if (hasSessionStorage()) {
    try {
      const stored = window.sessionStorage.getItem(TOKEN_KEY);
      if (stored) {
        memoryToken = stored;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 清除 token(内存 + sessionStorage)。
 */
export function clearSub2apiToken(): void {
  memoryToken = null;
  if (hasSessionStorage()) {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * 发请求前解析实际用于 Authorization 的 key:
 * - 若模型 key 是哨兵 → 换成 live JWT(取不到则退回哨兵,后端会回 401)。
 * - 否则原样返回(用户自配模型的真 key)。
 */
export function resolveAuthApiKey(modelApiKey: string): string {
  if (modelApiKey === SUB2API_PROXY_API_KEY) {
    return getSub2apiToken() || SUB2API_PROXY_API_KEY;
  }
  return modelApiKey;
}
