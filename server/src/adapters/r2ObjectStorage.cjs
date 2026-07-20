const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');

let r2Client;

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for R2 storage.`);
  }
  return process.env[name];
}

function createR2Client() {
  if (r2Client) return r2Client;

  r2Client = new S3Client({
    region: 'auto',
    endpoint: requireEnv('CLOUDFLARE_R2_ENDPOINT'),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv('CLOUDFLARE_R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
    },
  });

  return r2Client;
}

async function putFile(localPath, key, contentType = 'application/octet-stream') {
  const client = createR2Client();
  const size = fs.statSync(localPath).size;

  await client.send(new PutObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentType: contentType,
  }));

  return {
    key,
    url: process.env.CLOUDFLARE_R2_PUBLIC_URL ? `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}` : `/api/assets/${encodeURIComponent(key)}`,
    size,
  };
}

async function putUploadedFile(file, key) {
  try {
    return await putFile(file.path, key, file.mimetype);
  } finally {
    fs.rm(file.path, { force: true }, () => {});
  }
}

async function putJson(key, value) {
  const tmpPath = `/tmp/${key.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  try {
    return await putFile(tmpPath, key, 'application/json');
  } finally {
    fs.rm(tmpPath, { force: true }, () => {});
  }
}

async function getSignedReadUrl(key, options = {}) {
  const client = createR2Client();
  const expiresIn = Math.max(30, Math.min(3600, Number(options.expiresIn || 3600)));
  const responseContentDisposition = options.downloadName
    ? `attachment; filename="${String(options.downloadName).replace(/["\\\r\n]/g, '_')}"`
    : undefined;
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
      Key: key,
      ...(responseContentDisposition ? { ResponseContentDisposition: responseContentDisposition } : {}),
    }),
    { expiresIn }
  );
}

async function getSignedUploadUrl(key, contentType = 'application/octet-stream') {
  const client = createR2Client();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: Number(process.env.DIRECT_UPLOAD_URL_TTL_SECONDS || 3600) },
  );
}

async function streamToText(body) {
  if (typeof body?.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function getJson(key) {
  const client = createR2Client();
  const result = await client.send(new GetObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
  }));
  return JSON.parse(await streamToText(result.Body));
}

async function existsKey(key) {
  const client = createR2Client();
  try {
    await client.send(new HeadObjectCommand({
      Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
      Key: key,
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function deleteKey(key) {
  const client = createR2Client();
  await client.send(new DeleteObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
  }));
}

module.exports = {
  provider: 'r2',
  description: 'Cloudflare R2',
  putUploadedFile,
  putFile,
  putJson,
  getJson,
  existsKey,
  deleteKey,
  getSignedReadUrl,
  getSignedUploadUrl,
};
