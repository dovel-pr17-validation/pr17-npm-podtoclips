const localTranscription = require('../adapters/localTranscription.cjs');

function getTranscriptionAdapter() {
  if (process.env.TRANSCRIPTION_PROVIDER === 'assemblyai') {
    return require('../adapters/assemblyAiTranscription.cjs');
  }

  return {
    provider: 'local',
    ...localTranscription,
  };
}

function getTranscriptionStatus() {
  return getTranscriptionAdapter().provider;
}

module.exports = {
  getTranscriptionAdapter,
  getTranscriptionStatus,
};
