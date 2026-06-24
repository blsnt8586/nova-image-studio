'use strict';

/**
 * 提示词广场图片代理。
 *
 * 背景:提示词广场的图片 src 多为第三方绝对地址(GitHub raw / 图床),浏览器直连,
 * 在国内常被墙 → 部分图转圈、需开 VPN 才全显示。本服务器为国外节点(CN 精品链路),
 * 让图片改走「浏览器 → 本服务器 → 第三方」即可绕开直连被墙的问题。
 *
 * 安全:这是「服务端发起任意外部请求」的能力,必须收口,否则成开放代理 / SSRF 跳板。
 * - 仅允许 http(s)。
 * - 主机必须命中白名单(后缀按「点边界」匹配,防 evil-githubusercontent.com 之类伪装)。
 * - 拒绝指向内网/本机/云元数据地址(127/10/192.168/169.254/localhost 等)。
 */

/** 默认允许代理的图片来源主机(后缀匹配)。 */
const DEFAULT_IMAGE_PROXY_HOSTS = [
  'githubusercontent.com', // raw.githubusercontent.com / camo 等
  'github.com',
  'githubassets.com',
  'pbs.twimg.com',
  'twimg.com',
  'proxy.ccode.vip', // 现有公共代理
  'jsdelivr.net', // cdn.jsdelivr.net(GitHub 镜像)
  'sinaimg.cn', // 常见图床
  // 提示词广场实际用到的图床(按出现频次枚举,见 image-proxy 白名单说明)
  'catbox.moe', // files.catbox.moe — 主图床
  'ibb.co', // i.ibb.co — imgbb
  'youmind.com', // cms-assets.youmind.com / marketing-assets.youmind.com
  'maynor1024.live', // upload.maynor1024.live / apipro.maynor1024.live
  'imgedify.com', // cdn.imgedify.com
  'shields.io', // img.shields.io — README badge
];

/**
 * 判断主机是否命中白名单后缀,且以「点边界」对齐,
 * 即 host === suffix 或 host 以 ('.' + suffix) 结尾。
 * @param {string} host 小写主机名
 * @param {string[]} allowHosts
 * @returns {boolean}
 */
function hostAllowed(host, allowHosts) {
  return allowHosts.some((suffix) => host === suffix || host.endsWith('.' + suffix));
}

/**
 * 判断是否为内网/本机/云元数据等危险地址(防 SSRF)。
 * 仅做明显的字面量判断(不解析 DNS);白名单已是主要防线,这里是纵深防御。
 * @param {string} host 小写主机名
 * @returns {boolean}
 */
function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  // IPv4 私网 / 环回 / 链路本地(含云元数据 169.254.169.254)
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

/**
 * 校验并归一化图片代理目标 URL。
 * @param {unknown} raw 传入的目标地址
 * @param {string[]} [allowHosts=DEFAULT_IMAGE_PROXY_HOSTS]
 * @returns {string|null} 合法则返回原 URL 字符串,否则 null。
 */
function validateImageProxyTarget(raw, allowHosts = DEFAULT_IMAGE_PROXY_HOSTS) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (isPrivateHost(host)) return null;
  if (!hostAllowed(host, allowHosts)) return null;
  return raw;
}

const FETCH_TIMEOUT_MS = 15000;
// 浏览器与中间层都可长缓存:提示词广场图片是稳定的静态资源。
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

/**
 * 构造图片代理请求处理器。
 * @param {object} deps
 * @param {typeof fetch} deps.fetchImpl
 * @param {string[]} [deps.allowHosts]
 * @returns {(req, res) => Promise<void>}
 */
function createImageProxyHandler({ fetchImpl, allowHosts = DEFAULT_IMAGE_PROXY_HOSTS }) {
  return async function handleImageProxy(req, res) {
    const sendError = (code, message) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: message }));
    };

    let target;
    try {
      const parsed = new URL(req.url || '', 'http://localhost');
      target = parsed.searchParams.get('url');
    } catch {
      return sendError(400, 'bad request url');
    }

    const valid = validateImageProxyTarget(target, allowHosts);
    if (!valid) {
      return sendError(400, 'missing or disallowed url');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const upstream = await fetchImpl(valid, {
        signal: controller.signal,
        headers: { Accept: 'image/*,*/*;q=0.8' },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        return sendError(502, `upstream ${upstream.status}`);
      }
      const contentType =
        (upstream.headers.get && upstream.headers.get('content-type')) || 'application/octet-stream';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(buf.length),
        'Cache-Control': CACHE_CONTROL,
      });
      res.end(buf);
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || controller.signal.aborted);
      return sendError(aborted ? 504 : 502, aborted ? 'upstream timeout' : 'upstream fetch failed');
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {
  validateImageProxyTarget,
  createImageProxyHandler,
  DEFAULT_IMAGE_PROXY_HOSTS,
};
