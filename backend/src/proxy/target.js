'use strict';

const PROXY_PREFIX = '/api/proxy';

/**
 * 把 nova 侧的代理路径映射到 sub2api 的目标 URL。
 * 仅放行 `${PROXY_PREFIX}/...` 下的路径,做严格的越权/穿越校验。
 *
 * @param {string} pathnameWithQuery 形如 `/api/proxy/v1/models?limit=5`(可含 query)
 * @param {string} sub2apiBaseUrl
 * @returns {string | null} 目标 URL;非法/越界返回 null。
 */
function resolveProxyTarget(pathnameWithQuery, sub2apiBaseUrl) {
  if (typeof pathnameWithQuery !== 'string') {
    return null;
  }

  const qIndex = pathnameWithQuery.indexOf('?');
  const rawPath = qIndex === -1 ? pathnameWithQuery : pathnameWithQuery.slice(0, qIndex);
  const query = qIndex === -1 ? '' : pathnameWithQuery.slice(qIndex);

  // 必须以前缀开头
  if (rawPath !== PROXY_PREFIX && !rawPath.startsWith(PROXY_PREFIX + '/')) {
    return null;
  }

  // 截取前缀之后的后缀(以 / 开头)
  const suffix = rawPath.slice(PROXY_PREFIX.length); // '' 或 '/v1/...'
  if (!suffix.startsWith('/')) {
    return null;
  }

  // 防穿越:任何 '..' 段或绝对 URL 注入直接拒绝
  if (suffix.includes('..')) {
    return null;
  }
  // 防绝对 URL / 协议注入(如 /api/proxy/http://evil)
  if (/^\/[a-z][a-z0-9+.-]*:\/\//i.test(suffix)) {
    return null;
  }

  const base = String(sub2apiBaseUrl || '').replace(/\/+$/, '');
  return base + suffix + query;
}

module.exports = { resolveProxyTarget, PROXY_PREFIX };
