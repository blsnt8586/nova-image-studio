'use strict';

/**
 * 统一 ApiResponse 信封:{ success, data?, error?, meta? }
 * 不直接写 res,返回纯对象,便于单测与组合。
 */

/**
 * 构造成功信封。
 * @param {*} data 业务数据
 * @param {object} [meta] 分页等元信息
 * @returns {{ success: true, data: *, meta?: object }}
 */
function ok(data, meta) {
  const body = { success: true, data: data === undefined ? null : data };
  if (meta !== undefined) {
    body.meta = meta;
  }
  return body;
}

/**
 * 构造失败信封。
 * @param {string} error 用户友好的错误描述
 * @returns {{ success: false, error: string }}
 */
function fail(error) {
  return { success: false, error: typeof error === 'string' ? error : 'Unknown error' };
}

/**
 * 把信封写到 Node http 的 res。
 * @param {import('http').ServerResponse} res
 * @param {number} status HTTP 状态码
 * @param {object} body 信封对象
 */
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

module.exports = { ok, fail, send };
