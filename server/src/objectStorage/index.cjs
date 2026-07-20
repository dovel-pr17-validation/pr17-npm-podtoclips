const localObjectStorage = require('../adapters/localObjectStorage.cjs');

function shouldUseR2() {
  return process.env.OBJECT_STORAGE_PROVIDER === 'r2';
}

function getObjectStorage() {
  if (!shouldUseR2()) return localObjectStorage;
  return require('../adapters/r2ObjectStorage.cjs');
}

function getObjectStorageStatus() {
  const provider = getObjectStorage();
  return {
    provider: provider.provider,
    description: provider.description,
  };
}

module.exports = {
  getObjectStorage,
  getObjectStorageStatus,
};
