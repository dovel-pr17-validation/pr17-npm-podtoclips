const localSocial = require('../adapters/localSocial.cjs');

function getSocialAdapter() {
  if (process.env.SOCIAL_PROVIDER === 'openrouter') {
    return require('../adapters/openRouterSocial.cjs');
  }

  return {
    provider: 'local',
    ...localSocial,
  };
}

function getSocialStatus() {
  return getSocialAdapter().provider;
}

module.exports = {
  getSocialAdapter,
  getSocialStatus,
};
