'use strict';

const { fail, send } = require('../http/response');
const { extractToken } = require('../auth/with-auth');
const { resolveProxyTarget, PROXY_PREFIX } = require('./target');

// 转发时剔除的逐跳/会被覆盖的请求头
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'authorization',
  'accept-encoding',
  // nova 内部头:用于选择 sub2api API Key,绝不外泄到上游
  'x-sub2api-key-id',
]);

// 前端用来指定所选 sub2api API Key 的内部头
const KEY_ID_HEADER = 'x-sub2api-key-id';

/**
 * 读取请求体为 Buffer(用于转发非流式请求)。
 * @param {AsyncIterable<Buffer>} req
 * @returns {Promise<Buffer>}
 */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * 透传上游响应头(剔除会引发问题的头)。
 * @param {Map<string,string>|Headers} upstreamHeaders
 * @returns {Record<string,string>}
 */
function passthroughResponseHeaders(upstreamHeaders) {
  const out = {};
  const entries = typeof upstreamHeaders.entries === 'function'
    ? upstreamHeaders.entries()
    : [];
  for (const [k, v] of entries) {
    const lower = String(k).toLowerCase();
    if (lower === 'content-encoding' || lower === 'transfer-encoding' || lower === 'connection') {
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * 创建生图/列模型代理处理器。
 * 校验 JWT 认身份 → 按所选 keyId 代查 sub2api sk- key → 持该 sk- key 转发到
 * sub2api `/v1/*` → 把响应流回客户端。
 *
 * sub2api 是双凭证:JWT 仅用于管理端 `/api/v1/*`,生图端 `/v1/*` 只认 sk- key。
 * sk- key 永远只在后端解析与转发,绝不进入浏览器。
 *
 * @param {object} deps
 * @param {Function} deps.fetchImpl
 * @param {(token: string) => Promise<object|null>} deps.verify
 * @param {{ resolveKey: (args: {token,keyId,userId}) => Promise<string|null> }} deps.keysClient
 * @param {string} deps.sub2apiBaseUrl
 * @returns {(req, res) => Promise<boolean>} 返回 true 表示已接管该请求。
 */
function createProxyHandler(deps) {
  const { fetchImpl, verify, keysClient, sub2apiBaseUrl } = deps;

  return async function proxy(req, res) {
    const pathname = (req.url || '').split('#')[0];

    // 仅接管代理前缀
    const rawPath = pathname.split('?')[0];
    if (rawPath !== PROXY_PREFIX && !rawPath.startsWith(PROXY_PREFIX + '/')) {
      return false;
    }

    // 鉴权
    const token = extractToken(req);
    if (!token) {
      send(res, 401, fail('未认证:缺少 token'));
      return true;
    }
    let identity;
    try {
      identity = await verify(token);
    } catch {
      send(res, 503, fail('身份服务暂不可用,请稍后再试'));
      return true;
    }
    if (!identity) {
      send(res, 401, fail('认证失败:token 无效或已过期'));
      return true;
    }

    // 解析目标(含越权/穿越校验)
    const target = resolveProxyTarget(pathname, sub2apiBaseUrl);
    if (!target) {
      send(res, 400, fail('非法的代理路径'));
      return true;
    }

    // 按所选 keyId 代查 sk- key(身份取自代验结果,绝不信任 URL/客户端)
    const headerKeyId = req.headers && req.headers[KEY_ID_HEADER];
    const keyId = Array.isArray(headerKeyId) ? headerKeyId[0] : (headerKeyId || null);
    let apiKey;
    try {
      apiKey = await keysClient.resolveKey({ token, keyId, userId: identity.userId });
    } catch {
      send(res, 503, fail('密钥服务暂不可用,请稍后再试'));
      return true;
    }
    if (!apiKey) {
      send(res, 400, fail('未找到可用的 API Key,请在设置中选择'));
      return true;
    }

    // 组装转发头
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (!STRIP_REQUEST_HEADERS.has(String(k).toLowerCase())) {
        fwdHeaders[k] = v;
      }
    }
    fwdHeaders.Authorization = `Bearer ${apiKey}`;

    const method = (req.method || 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const body = hasBody ? await readBody(req) : undefined;

    // 转发
    let upstream;
    try {
      upstream = await fetchImpl(target, {
        method,
        headers: fwdHeaders,
        body: body && body.length ? body : undefined,
      });
    } catch {
      send(res, 502, fail('上游生图服务不可达'));
      return true;
    }

    // 回流响应(支持流式)
    res.writeHead(upstream.status, passthroughResponseHeaders(upstream.headers));
    if (upstream.body && typeof upstream.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of upstream.body) {
        res.write(Buffer.from(chunk));
      }
      res.end();
    } else if (typeof upstream.text === 'function') {
      res.end(await upstream.text());
    } else {
      res.end();
    }
    return true;
  };
}

module.exports = { createProxyHandler };
