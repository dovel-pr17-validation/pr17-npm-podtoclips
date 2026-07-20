const { neon } = require('@neondatabase/serverless');

let sqlClient = null;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for Neon Postgres.');
  }

  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }

  return sqlClient;
}

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

module.exports = {
  getSql,
  hasDatabaseUrl,
};

