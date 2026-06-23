'use client';

import { getSub2apiToken } from '@/lib/sub2api-token';

/**
 * 后端 API 客户端。统一:
 * - 带 sub2api JWT 的 Authorization 头(authFetch)
 * - 解析 `{ success, data?, error? }` 信封(apiRequest)
 *
 * 仅在 sub2api 会话(有 token)时使用;无 token 时调用方应退回本地存储。
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type FetchImpl = typeof fetch;

/** 是否处于 sub2api 会话(决定走后端还是本地存储)。 */
export function isSub2apiSession(): boolean {
  return Boolean(getSub2apiToken());
}

/**
 * 带鉴权头的 fetch。把当前 JWT 注入 Authorization: Bearer。
 * @param input 请求 URL
 * @param init fetch 选项(headers 会被保留并合并 Authorization)
 * @param fetchImpl 可注入的 fetch(测试用)
 */
export async function authFetch(
  input: string,
  init: RequestInit = {},
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getSub2apiToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetchImpl(input, { ...init, headers });
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  /** 便捷:传对象自动序列化为 JSON 并设置 Content-Type。 */
  json?: unknown;
  body?: BodyInit | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 发起 API 请求并解析信封。成功返回 data;失败抛 ApiError(带 HTTP status)。
 */
export async function apiRequest<T = unknown>(
  input: string,
  init: ApiRequestInit = {},
  fetchImpl: FetchImpl = fetch,
): Promise<T> {
  const headers = new Headers(init.headers || {});
  let body = init.body ?? null;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }

  const rest: ApiRequestInit = { ...init };
  delete rest.json;
  const res = await authFetch(input, { ...rest, headers, body }, fetchImpl);

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!res.ok || !envelope || envelope.success !== true) {
    const message = (envelope && envelope.error) || `请求失败 (HTTP ${res.status})`;
    throw new ApiError(message, res.status);
  }

  return envelope.data as T;
}
