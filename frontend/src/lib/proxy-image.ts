'use client';

/**
 * 提示词广场图片改走后端代理。
 *
 * 提示词广场图片 src 多为第三方绝对地址(GitHub raw / 图床),浏览器直连在国内
 * 常被墙(部分图转圈,需开 VPN)。本服务器为国外节点(CN 精品链路),改走
 * `浏览器 → 本服务器 → 第三方` 即可绕开直连被墙。后端路由见 /api/nova/img-proxy
 * (带白名单 + SSRF 防护)。
 *
 * 仅改写第三方 http(s) 绝对地址;本站相对地址、data:/blob: 等本地资源原样返回。
 *
 * @param {string} src 原图片地址
 * @returns {string} 走代理的地址,或原值
 */
const IMAGE_PROXY_ROUTE = '/api/nova/img-proxy';

export function proxyImage(src: string): string {
  if (typeof src !== 'string' || src.length === 0) return '';
  // 已是本站相对地址(含已代理过的),或本地资源协议,原样返回。
  if (src.startsWith('/')) return src;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src;
  return `${IMAGE_PROXY_ROUTE}?url=${encodeURIComponent(src)}`;
}
