const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(__dirname, '..', '..', 'storage');

function ensureStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

async function putUploadedFile(file, key) {
  ensureStorage();
  const targetPath = path.join(STORAGE_DIR, key);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(file.path, targetPath);
  return {
    key,
    url: `/api/assets/${encodeURIComponent(key)}`,
    path: targetPath,
    size: fs.statSync(targetPath).size,
  };
}

async function putFile(sourcePath, key) {
  ensureStorage();
  const targetPath = path.join(STORAGE_DIR, key);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return {
    key,
    url: `/api/assets/${encodeURIComponent(key)}`,
    path: targetPath,
    size: fs.statSync(targetPath).size,
  };
}

async function putJson(key, value) {
  ensureStorage();
  const targetPath = path.join(STORAGE_DIR, key);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2));
  return {
    key,
    url: `/api/assets/${encodeURIComponent(key)}`,
    path: targetPath,
    size: fs.statSync(targetPath).size,
  };
}

async function getJson(key) {
  const filePath = resolveKey(key);
  if (!filePath) throw new Error(`Object not found: ${key}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveKey(key) {
  const decoded = decodeURIComponent(key);
  const targetPath = path.join(STORAGE_DIR, decoded);
  if (!targetPath.startsWith(STORAGE_DIR)) return null;
  return fs.existsSync(targetPath) ? targetPath : null;
}

async function existsKey(key) {
  return Boolean(resolveKey(key));
}

async function deleteKey(key) {
  const filePath = resolveKey(key);
  if (filePath) fs.rmSync(filePath, { force: true });
}

module.exports = {
  provider: 'local',
  description: 'local filesystem',
  STORAGE_DIR,
  putUploadedFile,
  putFile,
  putJson,
  getJson,
  existsKey,
  deleteKey,
  resolveKey,
};
