'use strict';

const { ok, fail, send } = require('../http/response');
const { withAuth } = require('../auth/with-auth');

/**
 * GET /api/account-status — 返回当前用户的账户可用状态。
 *
 * 内部用 JWT 调 sub2api profile + 有效订阅,计算「余额 ≤ 0 且无有效订阅」→ outOfFunds。
 * 余额数值不外泄,仅回 { outOfFunds, hasActiveSubscription } 供前端决定是否提示充值。
 *
 * @param {object} deps
 * @param {(token: string) => Promise<object|null>} deps.verify 已绑定依赖的代验函数
 * @param {{ getAccountStatus: (token: string) => Promise<object|null> }} deps.profileClient
 * @returns {(req, res) => Promise<void>}
 */
function createAccountStatusHandler(deps) {
  const { profileClient } = deps;
  return withAuth(async function accountStatus(req, res, ctx) {
    let status;
    try {
      status = await profileClient.getAccountStatus(ctx.token);
    } catch (err) {
      const code = err && err.status === 503 ? 503 : 500;
      return send(res, code, fail('账户服务暂不可用,请稍后再试'));
    }
    if (status === null) {
      return send(res, 401, fail('认证失败:token 无效或已过期'));
    }
    return send(res, 200, ok(status));
  }, deps);
}

module.exports = { createAccountStatusHandler };
