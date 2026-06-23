'use strict';

const { ok, send } = require('../http/response');
const { withAuth } = require('../auth/with-auth');

/**
 * GET /api/me — 返回当前 token 对应的身份。
 * 仅回传 userId/role/email,绝不回传原始 token。
 *
 * @param {object} deps
 * @param {(token: string) => Promise<object|null>} deps.verify 已绑定依赖的代验函数
 * @returns {(req, res) => Promise<void>}
 */
function createMeHandler(deps) {
  return withAuth(async function me(req, res, ctx) {
    return send(res, 200, ok({
      userId: ctx.userId,
      role: ctx.role,
      email: ctx.email,
    }));
  }, deps);
}

module.exports = { createMeHandler };
