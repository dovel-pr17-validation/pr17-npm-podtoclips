const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _test } = require('./videoUrlIngest.cjs');

test('fast URL downloads cap quality and enable concurrent fragments', () => {
  const oldGlobal = process.env.EASYED_UPGRADES_ENABLED;
  const oldFast = process.env.YT_DLP_FAST_MODE_ENABLED;
  process.env.EASYED_UPGRADES_ENABLED = '1';
  process.env.YT_DLP_FAST_MODE_ENABLED = '1';
  const args = _test.downloadArgs('/tmp/download', 'https://example.com/video');
  if (oldGlobal === undefined) delete process.env.EASYED_UPGRADES_ENABLED;
  else process.env.EASYED_UPGRADES_ENABLED = oldGlobal;
  if (oldFast === undefined) delete process.env.YT_DLP_FAST_MODE_ENABLED;
  else process.env.YT_DLP_FAST_MODE_ENABLED = oldFast;
  assert.ok(args.includes('--concurrent-fragments'));
  const format = args[args.indexOf('-f') + 1];
  assert.match(format, /height<=1080/);
  assert.ok(format.indexOf('bestvideo') < format.indexOf('best[ext=mp4]'));
});

test('global rollback restores legacy yt-dlp arguments', () => {
  const oldGlobal = process.env.EASYED_UPGRADES_ENABLED;
  process.env.EASYED_UPGRADES_ENABLED = '0';
  const args = _test.downloadArgs('/tmp/download', 'https://example.com/video');
  if (oldGlobal === undefined) delete process.env.EASYED_UPGRADES_ENABLED;
  else process.env.EASYED_UPGRADES_ENABLED = oldGlobal;
  assert.equal(args.includes('--concurrent-fragments'), false);
  assert.equal(args[args.indexOf('-f') + 1], process.env.YT_DLP_FORMAT || 'best[ext=mp4]/bestaudio[ext=m4a]/best');
});

test('cookie authentication and JS challenge runtime apply to metadata and downloads', () => {
  const oldCookiesPath = process.env.YT_DLP_COOKIES_PATH;
  const oldJsRuntime = process.env.YT_DLP_JS_RUNTIME;
  process.env.YT_DLP_COOKIES_PATH = '/secrets/youtube/cookies.txt';
  process.env.YT_DLP_JS_RUNTIME = 'node';

  const metadata = _test.metadataArgs('https://www.youtube.com/watch?v=example');
  const download = _test.downloadArgs('/tmp/download', 'https://www.youtube.com/watch?v=example');

  if (oldCookiesPath === undefined) delete process.env.YT_DLP_COOKIES_PATH;
  else process.env.YT_DLP_COOKIES_PATH = oldCookiesPath;
  if (oldJsRuntime === undefined) delete process.env.YT_DLP_JS_RUNTIME;
  else process.env.YT_DLP_JS_RUNTIME = oldJsRuntime;

  for (const args of [metadata, download]) {
    assert.equal(args[args.indexOf('--cookies') + 1], '/secrets/youtube/cookies.txt');
    assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node');
    assert.ok(args.includes('--ignore-config'));
  }
});

test('read-only mounted cookies are copied to an isolated writable file', async () => {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easyed-cookie-fixture-'));
  const sourcePath = path.join(fixtureDir, 'cookies.txt');
  await fs.writeFile(sourcePath, '# Netscape HTTP Cookie File\n');

  const prepared = await _test.prepareWritableCookieArgs(['--cookies', sourcePath, '--skip-download']);
  try {
    const writablePath = prepared.args[prepared.args.indexOf('--cookies') + 1];
    assert.notEqual(writablePath, sourcePath);
    assert.equal(await fs.readFile(writablePath, 'utf8'), '# Netscape HTTP Cookie File\n');
  } finally {
    await prepared.cleanup();
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
});

test('Free URL metadata is rejected before downloading an overlong source', () => {
  const options = {
    durationLimitCode: 'FREE_SOURCE_LIMIT_EXCEEDED',
    durationLimitMessage: 'Free workspaces can process podcasts up to 2 hours long.',
  };
  assert.doesNotThrow(() => _test.assertMetadataDuration({ duration: 7200 }, 7200, options));
  assert.throws(() => _test.assertMetadataDuration({ duration: 7201 }, 7200, options), /2 hours long/);
  assert.throws(() => _test.assertMetadataDuration({ duration: null }, 7200, options), /could not be verified/);
});

test('Paid URL metadata is rejected before downloading a source over four hours twenty minutes', () => {
  const options = {
    durationLimitCode: 'PAID_SOURCE_LIMIT_EXCEEDED',
    durationLimitMessage: 'Paid workspaces can process podcasts up to 4 hours 20 minutes long.',
  };
  assert.doesNotThrow(() => _test.assertMetadataDuration({ duration: 15600 }, 15600, options));
  assert.throws(() => _test.assertMetadataDuration({ duration: 15601 }, 15600, options), /4 hours 20 minutes/);
});
