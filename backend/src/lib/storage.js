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

function signingKey() {
  return process.env.STORAGE_SIGNING_KEY || process.env.JWT_SECRET || 'rpe-dev-storage-signing-key';
}

function signLocalUrl(key, expEpoch) {
  const h = crypto.createHmac('sha256', signingKey());
  h.update(`${key}\n${expEpoch}`);
  return h.digest('hex');
}

function verifyLocalSig(key, expEpoch, sig) {
  if (!key || !expEpoch || !sig) return false;
  if (Number(expEpoch) * 1000 < Date.now()) return false;
  const expected = signLocalUrl(key, expEpoch);
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function localAbsPath(key) {
  // Resolve safely under LOCAL_ROOT to prevent path traversal.
  const full = path.resolve(LOCAL_ROOT, key);
  if (!full.startsWith(path.resolve(LOCAL_ROOT) + path.sep) && full !== path.resolve(LOCAL_ROOT)) {
    throw new Error('invalid storage key');
  }
  return full;
}

async function getSignedUrl(key, ttlSeconds = 300) {
  if (DRIVER === 'local') {
    // Local driver: HMAC-signed self-served URL, served by /api/storage/local/*
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, ttlSeconds);
    const sig = signLocalUrl(key, exp);
    return `/api/storage/local/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
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

module.exports = { putObject, getObject, getSignedUrl, deleteObject, DRIVER, BUCKET, verifyLocalSig, localAbsPath, LOCAL_ROOT };
