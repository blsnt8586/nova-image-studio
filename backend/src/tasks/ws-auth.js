'use strict';

/**
 * WebSocket 任务订阅鉴权(阶段 4)。
 *
 * 多用户模式下,连接只能订阅自己拥有的任务:订阅前用代验 JWT 解出的 userId
 * 与任务归属(task.user_id)比对。单机/老模式(multiUser=false)放行,保持向后兼容。
 *
 * 全部 fail-closed:身份缺失、查不到归属、查询抛错一律拒绝订阅。
 *
 * @param {object} deps
 * @param {boolean} deps.multiUser 是否启用多用户隔离
 * @param {(taskId: string) => Promise<string|number|null>} deps.getTaskOwner 返回任务归属 userId
 * @param {(token: string) => Promise<{ userId: string|number }|null>} [deps.verify] 代验函数
 */
function createTaskSubscriptionGuard(deps) {
  const { multiUser, getTaskOwner, verify } = deps;

  function norm(v) {
    return v === null || v === undefined ? null : String(v);
  }

  /** 代验一个原始 token,返回已验证的 userId(字符串);失败返回 null。 */
  async function identifyToken(token) {
    if (typeof verify !== 'function') return null;
    if (typeof token !== 'string' || !token.trim()) return null;
    try {
      const identity = await verify(token.trim());
      if (!identity || identity.userId === undefined || identity.userId === null) {
        return null;
      }
      return norm(identity.userId);
    } catch {
      return null;
    }
  }

  /** 从升级请求 URL 的 ?token= 解出已验证的 userId(字符串);失败返回 null。 */
  async function identify(url) {
    let token;
    try {
      const u = new URL(url, 'http://placeholder');
      token = u.searchParams.get('token');
    } catch {
      return null;
    }
    return identifyToken(token);
  }

  /** 该连接(userId)是否可订阅 taskId。 */
  async function canSubscribe(userId, taskId) {
    if (!multiUser) return true;
    const uid = norm(userId);
    if (!uid) return false;
    try {
      const owner = norm(await getTaskOwner(taskId));
      return owner !== null && owner === uid;
    } catch {
      return false;
    }
  }

  return { identify, identifyToken, canSubscribe };
}

module.exports = { createTaskSubscriptionGuard };
