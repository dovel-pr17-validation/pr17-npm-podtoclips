const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { cacheKeyForVideoUrl } = require('../utils/videoCacheKey.cjs');

const execFileAsync = promisify(execFile);

function getYtDlpPath() {
  return process.env.YT_DLP_PATH || 'yt-dlp';
}

function assertSupportedUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error('Enter a valid podcast or video URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https video URLs are supported.');
  }

  return parsed.toString();
}

function fastDownloadEnabled() {
  return process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.YT_DLP_FAST_MODE_ENABLED !== '0';
}

function sharedYtDlpArgs() {
  const args = ['--ignore-config'];
  const cookiesPath = String(process.env.YT_DLP_COOKIES_PATH || '').trim();
  const jsRuntime = String(process.env.YT_DLP_JS_RUNTIME || '').trim();

  if (cookiesPath) args.push('--cookies', cookiesPath);
  if (jsRuntime) args.push('--js-runtimes', jsRuntime);
  return args;
}

function metadataArgs(videoUrl) {
  return [
    ...sharedYtDlpArgs(),
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    videoUrl,
  ];
}

async function prepareWritableCookieArgs(args) {
  const cookieIndex = args.indexOf('--cookies');
  if (cookieIndex === -1 || !args[cookieIndex + 1]) {
    return { args, cleanup: async () => {} };
  }

  const cookieDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easyed-yt-cookies-'));
  const writablePath = path.join(cookieDir, 'cookies.txt');
  try {
    await fsp.copyFile(args[cookieIndex + 1], writablePath);
  } catch (error) {
    await fsp.rm(cookieDir, { recursive: true, force: true });
    throw error;
  }
  const writableArgs = [...args];
  writableArgs[cookieIndex + 1] = writablePath;

  return {
    args: writableArgs,
    cleanup: async () => fsp.rm(cookieDir, { recursive: true, force: true }),
  };
}

function downloadArgs(outputDir, videoUrl) {
  const maxFilesize = process.env.YT_DLP_MAX_FILESIZE || '2G';
  const legacyFormat = process.env.YT_DLP_FORMAT || 'best[ext=mp4]/bestaudio[ext=m4a]/best';
  const fastFormat = process.env.YT_DLP_FAST_FORMAT
    || 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4][height<=1080][height>=720][acodec!=none]/best[height<=1080]/best';
  const args = [
    ...sharedYtDlpArgs(),
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '--max-filesize',
    maxFilesize,
  ];
  if (fastDownloadEnabled()) {
    args.push(
      '--concurrent-fragments', String(process.env.YT_DLP_CONCURRENT_FRAGMENTS || 6),
      '--retries', String(process.env.YT_DLP_RETRIES || 3),
      '--fragment-retries', String(process.env.YT_DLP_FRAGMENT_RETRIES || 5),
      '--socket-timeout', String(process.env.YT_DLP_SOCKET_TIMEOUT_SECONDS || 20),
      '--merge-output-format', 'mp4',
    );
  }
  args.push('-f', fastDownloadEnabled() ? fastFormat : legacyFormat, '-o', path.join(outputDir, 'source.%(ext)s'), videoUrl);
  return args;
}

async function runYtDlp(args, options = {}) {
  const prepared = await prepareWritableCookieArgs(args);
  try {
    return await execFileAsync(getYtDlpPath(), prepared.args, {
      timeout: Number(process.env.YT_DLP_TIMEOUT_MS || 10 * 60 * 1000),
      maxBuffer: Number(process.env.YT_DLP_MAX_BUFFER || 1024 * 1024 * 20),
      ...options,
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missingBinary = new Error('yt-dlp is required for URL imports. Install yt-dlp or set YT_DLP_PATH.');
      missingBinary.statusCode = 503;
      throw missingBinary;
    }
    throw new Error(error.stderr?.trim() || error.message || 'Video URL import failed.');
  } finally {
    await prepared.cleanup();
  }
}

async function fetchMetadata(videoUrl) {
  const { stdout } = await runYtDlp(metadataArgs(videoUrl));
  return JSON.parse(stdout);
}

async function findDownloadedFile(outputDir) {
  const entries = await fsp.readdir(outputDir);
  const mediaFiles = entries
    .filter((file) => !file.endsWith('.json') && !file.endsWith('.part') && !file.startsWith('.'))
    .map((file) => path.join(outputDir, file));

  if (mediaFiles.length === 0) {
    throw new Error('yt-dlp finished without producing a media file.');
  }

  mediaFiles.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return mediaFiles[0];
}

function assertMetadataDuration(metadata, maxDurationSeconds, options = {}) {
  if (!maxDurationSeconds) return;
  const duration = Number(metadata?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    const error = new Error(options.durationUnknownMessage || 'The source duration could not be verified for this plan.');
    error.statusCode = 413;
    error.code = options.durationLimitCode || 'SOURCE_DURATION_LIMIT_EXCEEDED';
    throw error;
  }
  if (duration > Number(maxDurationSeconds)) {
    const error = new Error(options.durationLimitMessage || 'This source exceeds the maximum duration for this plan.');
    error.statusCode = 413;
    error.code = options.durationLimitCode || 'SOURCE_DURATION_LIMIT_EXCEEDED';
    throw error;
  }
}

function mimeTypeForExtension(extension) {
  const normalized = extension.toLowerCase();
  if (normalized === '.mp4') return 'video/mp4';
  if (normalized === '.m4a') return 'audio/mp4';
  if (normalized === '.mp3') return 'audio/mpeg';
  if (normalized === '.webm') return 'video/webm';
  if (normalized === '.wav') return 'audio/wav';
  if (normalized === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

async function importVideoUrl(rawUrl, options = {}) {
  const videoUrl = assertSupportedUrl(rawUrl);
  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easyed-url-import-'));

  try {
    const metadata = await fetchMetadata(videoUrl);
    assertMetadataDuration(metadata, options.maxDurationSeconds, options);
    await runYtDlp(downloadArgs(outputDir, videoUrl));

    const filePath = await findDownloadedFile(outputDir);
    const extension = path.extname(filePath) || '.bin';

    return {
      file: {
        path: filePath,
        originalname: `${metadata.title || 'video-link'}${extension}`,
        mimetype: mimeTypeForExtension(extension),
        size: fs.statSync(filePath).size,
      },
      metadata: {
        sourceUrl: videoUrl,
        canonicalUrl: metadata.webpage_url || videoUrl,
        cacheKey: cacheKeyForVideoUrl(metadata.webpage_url || videoUrl),
        provider: metadata.extractor_key || metadata.extractor || 'yt-dlp',
        title: metadata.title || '',
        author: metadata.uploader || metadata.channel || '',
        durationSeconds: metadata.duration || null,
        thumbnailUrl: metadata.thumbnail || null,
        downloadProfile: fastDownloadEnabled() ? 'quality_1080p_concurrent_v2' : 'legacy',
      },
      cleanup: async () => {
        await fsp.rm(outputDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fsp.rm(outputDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  importVideoUrl,
  validateVideoUrl: assertSupportedUrl,
  fetchMetadata,
  _test: { assertMetadataDuration, downloadArgs, metadataArgs, sharedYtDlpArgs, prepareWritableCookieArgs, fastDownloadEnabled },
};
