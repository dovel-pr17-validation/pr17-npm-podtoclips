const localAi = require('../adapters/localAi.cjs');

function getAiAdapter() {
  if (process.env.AI_PROVIDER === 'openrouter') {
    return require('../adapters/openRouterAi.cjs');
  }

  return {
    provider: 'local',
    ...localAi,
  };
}

function getAiStatus() {
  return getAiAdapter().provider;
}

module.exports = {
  getAiAdapter,
  getAiStatus,
};
