function requireEpisodeBillingAccountId(episode) {
  const accountId = String(episode?.source?.billing?.accountId || '').trim();
  if (accountId) return accountId;

  const error = new Error('This clip generation is missing its authenticated billing account.');
  error.code = 'BILLING_IDENTITY_MISSING';
  error.statusCode = 409;
  throw error;
}

module.exports = { requireEpisodeBillingAccountId };
