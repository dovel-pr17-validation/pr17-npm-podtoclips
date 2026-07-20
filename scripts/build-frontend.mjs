import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { transformHtmlTemplate } from '@unhead/react/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const prerenderDir = path.join(root, '.prerender');
const distDir = path.join(root, 'dist');
const productionEnv = loadEnv('production', root, '');
const uiV2Enabled = (process.env.VITE_UI_V2_ENABLED ?? productionEnv.VITE_UI_V2_ENABLED) !== '0';
const rawSiteUrl = (process.env.VITE_SITE_URL ?? productionEnv.VITE_SITE_URL ?? '').trim();
let configuredSiteUrl = '';
if (rawSiteUrl) {
  const parsedSiteUrl = new URL(rawSiteUrl);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsedSiteUrl.hostname);
  if (parsedSiteUrl.protocol !== 'https:' && !isLocal) {
    throw new Error('VITE_SITE_URL must use HTTPS outside local development.');
  }
  parsedSiteUrl.search = '';
  parsedSiteUrl.hash = '';
  configuredSiteUrl = parsedSiteUrl.toString().replace(/\/$/, '');
}

const run = (args) => {
  const result = spawnSync(viteBin, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(['build']);

if (!uiV2Enabled) process.exit(0);

run(['build', '--ssr', 'src/entry-server.tsx', '--outDir', '.prerender']);

const entryPath = path.join(prerenderDir, 'entry-server.js');
if (!existsSync(entryPath)) throw new Error(`Missing prerender entry at ${entryPath}`);

const { renderLanding } = await import(`${pathToFileURL(entryPath).href}?v=${Date.now()}`);
const indexPath = path.join(distDir, 'index.html');
const shellHtml = await readFile(indexPath, 'utf8');
const renderDocument = async (location) => {
  const rendered = renderLanding(location);
  const withBody = shellHtml.replace('<div id="root"></div>', `<div id="root">${rendered.html}</div>`);
  return transformHtmlTemplate(rendered.head, withBody);
};

const html = await renderDocument('/');
for (const previewVariant of ['original', 'podcast', 'optimized']) {
  const previewHtml = await renderDocument(`/landing/${previewVariant}`);
  const previewDir = path.join(distDir, 'landing', previewVariant);
  await mkdir(previewDir, { recursive: true });
  await writeFile(path.join(previewDir, 'index.html'), previewHtml);
}
const pricingHtml = await renderDocument('/pricing');
const pricingDir = path.join(distDir, 'pricing');
await mkdir(pricingDir, { recursive: true });
await writeFile(path.join(pricingDir, 'index.html'), pricingHtml);
const legalRoutes = ['legal', 'legal/terms', 'legal/privacy', 'legal/refunds', 'legal/acceptable-use', 'legal/cookies'];
for (const legalRoute of legalRoutes) {
  const legalHtml = await renderDocument(`/${legalRoute}`);
  const legalDir = path.join(distDir, ...legalRoute.split('/'));
  await mkdir(legalDir, { recursive: true });
  await writeFile(path.join(legalDir, 'index.html'), legalHtml);
}

if (configuredSiteUrl) {
  const sitemapUrls = ['', ...legalRoutes].map((route) => `  <url><loc>${configuredSiteUrl}/${route}</loc></url>`).join('\n');
  await writeFile(
    path.join(distDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`,
  );
  const robotsPath = path.join(distDir, 'robots.txt');
  const robots = await readFile(robotsPath, 'utf8');
  await writeFile(robotsPath, `${robots.trim()}\nSitemap: ${configuredSiteUrl}/sitemap.xml\n`);
} else {
  console.warn('VITE_SITE_URL is not set; canonical and sitemap generation were intentionally skipped.');
}

await writeFile(indexPath, html);
await rm(prerenderDir, { recursive: true, force: true });
