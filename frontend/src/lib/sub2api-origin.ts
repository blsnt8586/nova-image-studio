'use client';

/**
 * sub2api 来源 origin(父页面所在站点)存储。
 *
 * 来源:嵌入时父页面通过 URL query `src_host` 传入(见 sub2api 的 buildEmbeddedUrl)。
 * 用途:nova 检测到用户在 sub2api 尚无 API Key 时,引导其新标签打开 `${origin}/keys` 创建。
 *
 * 设计:与 sub2api-token 一致,存 sessionStorage + 内存(非机密,但仅当次会话需要)。
 */

const ORIGIN_KEY = 'sub2api-origin';

let memoryOrigin: string | null = null;

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

/** 归一化:仅接受 http(s) 绝对 origin,去掉尾部斜杠;非法返回空串。 */
function normalizeOrigin(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** 写入 sub2api origin(非法/空白被忽略)。 */
export function setSub2apiOrigin(origin: string): void {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return;
  memoryOrigin = normalized;
  if (hasSessionStorage()) {
    try {
      window.sessionStorage.setItem(ORIGIN_KEY, normalized);
    } catch {
      // 隐私模式等:仅保留内存副本
    }
  }
}

/** 读取 sub2api origin:优先内存,回落 sessionStorage;无则 null。 */
export function getSub2apiOrigin(): string | null {
  if (memoryOrigin) return memoryOrigin;
  if (hasSessionStorage()) {
    try {
      const stored = window.sessionStorage.getItem(ORIGIN_KEY);
      if (stored) {
        memoryOrigin = stored;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/** sub2api API Key 管理页地址;无 origin 时返回 null(调用方据此降级)。 */
export function getSub2apiKeysUrl(): string | null {
  const origin = getSub2apiOrigin();
  return origin ? `${origin}/keys` : null;
}

/** 是否运行在 iframe 内(嵌入场景)。 */
function isEmbedded(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true; // 跨源访问 window.parent 抛错也说明被嵌入
  }
}

/**
 * 请求导航到 sub2api 的某个目标页(当前用于引导去 /keys 创建密钥)。
 *
 * - 嵌入(iframe)场景:postMessage 通知父页面 sub2api 在「当前页」内路由跳转,
 *   体验顺滑(避免新标签)。父页面需监听 'sub2api:navigate' 消息(见 CustomPageView)。
 * - 非嵌入场景:回落为新标签打开绝对 URL。
 *
 * @param target 语义化目标标识(如 'keys'),父页面据此映射到路由,避免裸 URL 重定向风险。
 */
export function requestSub2apiNavigate(target: 'keys'): void {
  const origin = getSub2apiOrigin();

  if (isEmbedded() && origin) {
    try {
      window.parent.postMessage({ type: 'sub2api:navigate', target }, origin);
      return;
    } catch {
      // postMessage 失败则继续走新标签兜底
    }
  }

  const url = target === 'keys' ? getSub2apiKeysUrl() : null;
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
