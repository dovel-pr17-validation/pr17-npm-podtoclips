const { clerkMiddleware, getAuth } = require('@clerk/express');

function isClerkConfigured() {
  return Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

function assertClerkConfiguration() {
  if (process.env.CLERK_AUTH_REQUIRED === '1' && !isClerkConfigured()) {
    throw new Error('CLERK_AUTH_REQUIRED=1 requires CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.');
  }
}

function authorizedParties() {
  return String(process.env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function clerkSessionMiddleware() {
  if (!isClerkConfigured()) return (_req, _res, next) => next();
  const parties = authorizedParties();
  return clerkMiddleware(parties.length ? { authorizedParties: parties } : undefined);
}

function requireAuthenticatedRequest(req, res, next) {
  if (!isClerkConfigured()) return next();
  const auth = getAuth(req);
  if (!auth.isAuthenticated || !auth.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.authUserId = auth.userId;
  req.authSessionId = auth.sessionId;
  return next();
}

module.exports = {
  assertClerkConfiguration,
  clerkSessionMiddleware,
  isClerkConfigured,
  requireAuthenticatedRequest,
};
