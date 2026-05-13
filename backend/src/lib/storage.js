// S3-compatible storage abstraction. Backends: S3/MinIO (default) or local disk.
// Configure via STORAGE_DRIVER=s3|local + STORAGE_BUCKET + AWS_* / S3_ENDPOINT.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const DRIVER = process.env.STORAGE_DRIVER || 'local';
const BUCKET = process.env.STORAGE_BUCKET || 'rpe-chain';
const LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT || path.join(__dirname, '..', '..', 'uploads', 'storage');

let s3Client = null;
function getS3() {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', // MinIO needs path-style
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined,
  });
  return s3Client;
}

async function putObject(key, body, contentType = 'application/octet-stream') {
  if (DRIVER === 'local') {
    const full = path.join(LOCAL_ROOT, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    return { key, etag: crypto.createHash('md5').update(body).digest('hex'), driver: 'local' };
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const out = await getS3().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
  }));
  return { key, etag: out.ETag, driver: 's3' };
}

async function getObject(key) {
  if (DRIVER === 'local') {
    const full = path.join(LOCAL_ROOT, key);
    return fs.readFileSync(full);
  }
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const out = await getS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function getSignedUrl(key, ttlSeconds = 300) {
  if (DRIVER === 'local') {
    // Local driver: return a self-served URL via a signed-token path.
    // For dev only — production should always use S3/MinIO.
    return `/api/storage/local/${encodeURIComponent(key)}`;
  }
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');
  return presign(getS3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttlSeconds });
}

async function deleteObject(key) {
  if (DRIVER === 'local') {
    const full = path.join(LOCAL_ROOT, key);
    try { fs.unlinkSync(full); } catch { /* noop */ }
    return;
  }
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

logger.info({ driver: DRIVER, bucket: BUCKET }, 'storage initialised');

module.exports = { putObject, getObject, getSignedUrl, deleteObject, DRIVER, BUCKET };
