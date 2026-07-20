const localRenderer = require('../adapters/localRenderer.cjs');

function getRenderer() {
  if (process.env.RENDER_PROVIDER === 'cloud_run') {
    return require('../adapters/cloudRunRenderer.cjs');
  }

  return {
    provider: 'local-plan',
    ...localRenderer,
  };
}

function getRendererStatus() {
  return getRenderer().provider;
}

module.exports = {
  getRenderer,
  getRendererStatus,
};
