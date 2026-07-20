const fs = require('fs');
const { getObjectStorage } = require('../objectStorage/index.cjs');

const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com/v2';

function getApiKey() {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY is required when TRANSCRIPTION_PROVIDER=assemblyai.');
  }
  return process.env.ASSEMBLYAI_API_KEY;
}

async function assemblyRequest(path, options = {}) {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: getApiKey(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `AssemblyAI request failed with ${response.status}`);
  }

  return data;
}

async function uploadLocalAsset(filePath) {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      Authorization: getApiKey(),
      'Content-Type': 'application/octet-stream',
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `AssemblyAI upload failed with ${response.status}`);
  }
  return data.upload_url;
}

async function resolveAssemblyAudioUrl(episode) {
  const objectStorage = getObjectStorage();

  if (objectStorage.resolveKey) {
    const filePath = objectStorage.resolveKey(episode.source.assetKey);
    if (filePath) return uploadLocalAsset(filePath);
  }

  if (objectStorage.getSignedReadUrl) {
    return objectStorage.getSignedReadUrl(episode.source.assetKey);
  }

  if (episode.source.assetUrl?.startsWith('http')) return episode.source.assetUrl;

  throw new Error('Could not create an AssemblyAI-accessible audio URL for this episode.');
}

function normalizeWord(word) {
  const speaker = word.speaker ? `Speaker ${word.speaker}` : 'Speaker 1';
  return {
    word: word.text,
    start: Number(((word.start || 0) / 1000).toFixed(2)),
    end: Number(((word.end || 0) / 1000).toFixed(2)),
    speaker,
  };
}

function normalizeSpeakers(words) {
  return [...new Set(words.map((word) => word.speaker))]
    .filter(Boolean)
    .map((speaker) => ({
      id: speaker,
      label: speaker,
    }));
}

async function pollTranscript(transcriptId) {
  const pollMs = Number(process.env.ASSEMBLYAI_POLL_MS || 3000);
  const maxAttempts = Number(process.env.ASSEMBLYAI_MAX_POLL_ATTEMPTS || 120);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const transcript = await assemblyRequest(`/transcript/${transcriptId}`);
    if (transcript.status === 'completed') return transcript;
    if (transcript.status === 'error') {
      throw new Error(transcript.error || 'AssemblyAI transcription failed.');
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error('AssemblyAI transcription timed out.');
}

async function transcribeEpisode(episode) {
  const audioUrl = await resolveAssemblyAudioUrl(episode);
  const submitted = await assemblyRequest('/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
      language_detection: true,
      punctuate: true,
      format_text: true,
    }),
  });

  const transcript = await pollTranscript(submitted.id);
  const words = (transcript.words || []).map(normalizeWord);

  return {
    provider: 'assemblyai',
    vendorTranscriptId: transcript.id,
    language: transcript.language_code || 'auto',
    text: transcript.text || '',
    words,
    speakers: normalizeSpeakers(words),
    durationSeconds: words.length ? words[words.length - 1].end : Number(((transcript.audio_duration || 0)).toFixed(2)),
    sourceAssetKey: episode.source.assetKey,
  };
}

module.exports = {
  provider: 'assemblyai',
  transcribeEpisode,
};
