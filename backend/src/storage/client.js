'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createStorage } = require('./s3');

let storage = null;
let client = null;

/**
 * 构建(惰性)真实 S3/MinIO 存储服务。仅做接线,逻辑在 createStorage 里(已单测)。
 * 因含真实 SDK 副作用,本文件不计入覆盖率统计。
 *
 * @param {{ s3: { endpoint, accessKey, secretKey, bucket, region } }} config
 */
function getStorage(config) {
  if (!storage) {
    const { s3 } = config;
    client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
      forcePathStyle: true, // MinIO 需要 path-style
    });
    storage = createStorage({
      client,
      getSignedUrl,
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectCommand,
      bucket: s3.bucket,
    });
  }
  return storage;
}

/**
 * 删除对象(TTL/用户删除时调用)。调用方需先校验 objectKey 归属。
 * @param {{ s3: { bucket } }} config
 * @param {string} objectKey
 */
async function deleteObject(config, objectKey) {
  getStorage(config); // 确保 client 已初始化
  await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey }));
}

function resetStorage() {
  storage = null;
  client = null;
}

module.exports = { getStorage, deleteObject, resetStorage };
