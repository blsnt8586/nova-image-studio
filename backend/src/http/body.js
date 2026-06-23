'use strict';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB(预签名后本体走 MinIO,这里只传元数据/快照)

/**
 * 读取并解析请求 JSON body。空 body 返回 {}。
 * 超过 maxBytes 抛错;非法 JSON 抛错;流错误透传。
 *
 * @param {import('http').IncomingMessage} req
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<object>}
 */
function readJsonBody(req, opts = {}) {
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        reject(new Error('请求体过大'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });

    req.on('error', (err) => {
      if (aborted) return;
      aborted = true;
      reject(err);
    });
  });
}

module.exports = { readJsonBody, DEFAULT_MAX_BYTES };
