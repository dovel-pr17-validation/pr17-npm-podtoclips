const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function parseDurationSeconds(value) {
  const duration = Number(String(value || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    const error = new Error('The podcast duration could not be read.');
    error.code = 'MEDIA_DURATION_UNAVAILABLE';
    error.statusCode = 400;
    throw error;
  }
  return duration;
}

async function probeMediaDurationSeconds(source) {
  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    source,
  ], {
    timeout: Number(process.env.FFPROBE_TIMEOUT_MS || 120_000),
    maxBuffer: 1024 * 1024,
  });
  return parseDurationSeconds(stdout);
}

module.exports = { parseDurationSeconds, probeMediaDurationSeconds };
