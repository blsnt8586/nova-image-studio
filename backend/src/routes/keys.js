'use strict';

const { ok, fail, send } = require('../http/response');
const { withAuth } = require('../auth/with-auth');

/**
 * GET /api/keys — 返回当前用户的 sub2api API Key 列表(脱敏)。
 * 仅回传 { id, name, status },绝不回传 sk- key 本体。供前端下拉选择 keyId。
 *
 * @param {object} deps
 * @param {(token: string) => Promise<object|null>} deps.verify 已绑定依赖的代验函数
 * @param {{ listKeys: (token: string) => Promise<Array|null> }} deps.keysClient
 * @returns {(req, res) => Promise<void>}
 */
function createKeysHandler(deps) {
  const { keysClient } = deps;
  return withAuth(async function keys(req, res, ctx) {
    let list;
    try {
      list = await keysClient.listKeys(ctx.token);
    } catch (err) {
      const status = err && err.status === 503 ? 503 : 500;
      return send(res, status, fail('密钥服务暂不可用,请稍后再试'));
    }
    // 二次脱敏:只取展示字段,杜绝上游误带 key 本体。
    const safe = (list || []).map((k) => ({ id: k.id, name: k.name, status: k.status }));
    return send(res, 200, ok(safe));
  }, deps);
}

module.exports = { createKeysHandler };
