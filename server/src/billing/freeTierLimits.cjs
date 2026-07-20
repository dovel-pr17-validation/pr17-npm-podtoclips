const FREE_MAX_SOURCE_DURATION_SECONDS = 2 * 60 * 60;
const PAID_MAX_SOURCE_DURATION_SECONDS = (4 * 60 * 60) + (20 * 60);
const FREE_MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;

function sourceDurationSeconds(source) {
  const value = Number(source?.durationSeconds ?? source?.import?.durationSeconds);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sourceLimitError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 413;
  return error;
}

function durationLimitFor(entitlement) {
  if (entitlement?.plan === 'free') {
    return {
      code: 'FREE_SOURCE_LIMIT_EXCEEDED',
      label: 'Free',
      message: 'Free workspaces can process podcasts up to 2 hours long.',
      seconds: FREE_MAX_SOURCE_DURATION_SECONDS,
    };
  }
  return {
    code: 'PAID_SOURCE_LIMIT_EXCEEDED',
    label: 'Paid',
    message: 'Paid workspaces can process podcasts up to 4 hours 20 minutes long.',
    seconds: PAID_MAX_SOURCE_DURATION_SECONDS,
  };
}

function isSourceLimitError(error) {
  return [
    'FREE_SOURCE_LIMIT_EXCEEDED',
    'PAID_SOURCE_LIMIT_EXCEEDED',
    'SOURCE_DURATION_LIMIT_EXCEEDED',
    'SOURCE_SIZE_LIMIT_EXCEEDED',
  ].includes(error?.code);
}

function assertUploadSizeAllowed(entitlement, size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    const error = new Error('Podcast file size must be greater than zero.');
    error.statusCode = 400;
    throw error;
  }
  if (bytes > MAX_DIRECT_UPLOAD_BYTES) {
    throw sourceLimitError('Podcast files cannot exceed 20 GiB.', 'SOURCE_SIZE_LIMIT_EXCEEDED');
  }
  if (entitlement?.plan === 'free' && bytes > FREE_MAX_SOURCE_BYTES) {
    throw sourceLimitError('Free workspaces can upload files up to 5 GiB and 2 hours long.', 'FREE_SOURCE_LIMIT_EXCEEDED');
  }
}

function assertDurationAllowed(entitlement, durationSeconds, { requireKnown = true } = {}) {
  const limit = durationLimitFor(entitlement);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    if (requireKnown) throw sourceLimitError(`The source duration could not be verified for the ${limit.label} plan.`, limit.code);
    return;
  }
  if (duration > limit.seconds) {
    throw sourceLimitError(limit.message, limit.code);
  }
}

module.exports = {
  FREE_MAX_SOURCE_BYTES,
  FREE_MAX_SOURCE_DURATION_SECONDS,
  MAX_DIRECT_UPLOAD_BYTES,
  PAID_MAX_SOURCE_DURATION_SECONDS,
  assertDurationAllowed,
  assertUploadSizeAllowed,
  durationLimitFor,
  isSourceLimitError,
  sourceDurationSeconds,
};
