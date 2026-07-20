const localVisual = require('../adapters/localVisual.cjs');

function getVisualAdapter() {
  if (process.env.VISUAL_PROVIDER === 'openrouter') {
    return require('../adapters/ffmpegOpenRouterVisual.cjs');
  }

  return {
    provider: 'local',
    ...localVisual,
  };
}

function getVisualStatus() {
  return getVisualAdapter().provider;
}

module.exports = {
  getVisualAdapter,
  getVisualStatus,
};
