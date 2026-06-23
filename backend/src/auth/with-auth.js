'use strict';

const { fail, send } = require('../http/response');

/**
 * 从请求中提取 token:优先 Authorization: Bearer,其次 ?token= 查询参数。
 * @param {import('http').IncomingMessage} req
 * @returns {string | null}
 */
function extractToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }
  // 仅用于入口首跳:从 ?token= 取(随后前端会立即清理 URL)
  if (typeof req.url === 'string') {
    const qIndex = req.url.indexOf('?');
    if (qIndex !== -1) {
      const params = new URLSearchParams(req.url.slice(qIndex + 1));
      const t = params.get('token');
      if (t) {
        return t;
      }
    }
  }
  return null;
}

/**
 * 鉴权包装:校验 token,注入身份到 ctx.userId/ctx.role/ctx.email,再调 handler。
 * 失败短路返回 401/503,不调用 handler。
 *
 * @param {(req, res, ctx) => Promise<void>} handler
 * @param {object} deps
 * @param {(token: string) => Promise<object|null>} deps.verify 代验函数(已绑定 redis/fetch/baseUrl)
 * @returns {(req, res) => Promise<void>}
 */
function withAuth(handler, deps) {
  const { verify } = deps;
  return async function authed(req, res) {
    const token = extractToken(req);
    if (!token) {
      return send(res, 401, fail('未认证:缺少 token'));
    }

    let identity;
    try {
      identity = await verify(token);
    } catch (err) {
      const status = err && err.status === 503 ? 503 : 500;
      return send(res, status, fail('身份服务暂不可用,请稍后再试'));
    }

    if (!identity) {
      return send(res, 401, fail('认证失败:token 无效或已过期'));
    }

    const ctx = {
      userId: identity.userId,
      role: identity.role,
      email: identity.email,
      token,
    };
    return handler(req, res, ctx);
  };
}

/**
 * 管理员包装:在 withAuth 基础上额外要求 role === 'admin',否则 403。
 *
 * @param {(req, res, ctx) => Promise<void>} handler
 * @param {object} deps 同 withAuth
 * @returns {(req, res) => Promise<void>}
 */
function withAdmin(handler, deps) {
  return withAuth(async function adminGuard(req, res, ctx) {
    if (ctx.role !== 'admin') {
      return send(res, 403, fail('无权限:需要管理员'));
    }
    return handler(req, res, ctx);
  }, deps);
}

module.exports = { extractToken, withAuth, withAdmin };
