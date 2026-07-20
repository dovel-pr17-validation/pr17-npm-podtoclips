import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
const originalPreviewHtml = await readFile(path.join(root, 'dist', 'landing', 'original', 'index.html'), 'utf8');
const podcastPreviewHtml = await readFile(path.join(root, 'dist', 'landing', 'podcast', 'index.html'), 'utf8');
const optimizedPreviewHtml = await readFile(path.join(root, 'dist', 'landing', 'optimized', 'index.html'), 'utf8');
const pricingPreviewHtml = await readFile(path.join(root, 'dist', 'pricing', 'index.html'), 'utf8');
const legalHtml = await readFile(path.join(root, 'dist', 'legal', 'index.html'), 'utf8');
const termsHtml = await readFile(path.join(root, 'dist', 'legal', 'terms', 'index.html'), 'utf8');
const privacyHtml = await readFile(path.join(root, 'dist', 'legal', 'privacy', 'index.html'), 'utf8');
const refundsHtml = await readFile(path.join(root, 'dist', 'legal', 'refunds', 'index.html'), 'utf8');
const robots = await readFile(path.join(root, 'dist', 'robots.txt'), 'utf8');
const sitemap = await readFile(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
const socialImage = await sharp(path.join(root, 'dist', 'og-easy-edits.png')).metadata();

const assertions = [
  ['approved hero preserved', /<h1[^>]*>.*One recording\..*Your next month of/s.test(html)],
  ['intent-aligned title', /<title>AI Podcast Clip Generator &amp; Video Clipping Tool/.test(html)],
  ['intent-aligned description', /<meta name="description" content="Turn long podcasts and interviews/.test(html)],
  ['clear AI podcast platform description', html.includes('Turn podcasts and interviews into a massive number of production grade enterprise level clips.')],
  ['podcast clip generator language', /<title>AI Podcast Clip Generator/.test(html)],
  ['video repurposing language', html.includes('Podcast repurposing at scale')],
  ['enterprise outcome language', html.includes('AI podcast clipping at scale')],
  ['result-driven pipeline language', html.includes('repeatable content pipeline')],
  ['index directive', /<meta name="robots" content="index, follow/.test(html)],
  ['absolute canonical', /<link rel="canonical" href="https:\/\//.test(html)],
  ['absolute Open Graph URL', /<meta property="og:url" content="https:\/\//.test(html)],
  ['absolute Open Graph image', /<meta property="og:image" content="https:\/\//.test(html)],
  ['WebSite JSON-LD', /"@type":"WebSite"/.test(html)],
  ['login entry point', /href="\/login"[^>]*>Log in/.test(html)],
  ['signup entry point', /href="\/signup"[^>]*>Sign up/.test(html)],
  ['workspace disallowed in robots', /Disallow: \/app/.test(robots)],
  ['editor disallowed in robots', /Disallow: \/editor/.test(robots)],
  ['sitemap declared in robots', /Sitemap: https:\/\//.test(robots)],
  ['canonical homepage in sitemap', /<loc>https:\/\/[^<]+\/<\/loc>/.test(sitemap)],
  ['approved social image selected', html.includes('og-easy-edits.png')],
  ['1200px social image', socialImage.width === 1200],
  ['630px social image', socialImage.height === 630],
  ['original preview is pre-rendered', originalPreviewHtml.includes('One recording.')],
  ['original preview is noindex', /<meta name="robots" content="noindex, nofollow"/.test(originalPreviewHtml)],
  ['original preview has no canonical', !/<link rel="canonical"/.test(originalPreviewHtml)],
  ['original preview uses original social image', originalPreviewHtml.includes('og-easy-edits.png')],
  ['podcast preview is pre-rendered', podcastPreviewHtml.includes('The AI podcast clipper')],
  ['podcast preview is noindex', /<meta name="robots" content="noindex, nofollow"/.test(podcastPreviewHtml)],
  ['optimized preview is pre-rendered', optimizedPreviewHtml.includes('Podcast repurposing at scale')],
  ['optimized preview is noindex', /<meta name="robots" content="noindex, nofollow"/.test(optimizedPreviewHtml)],
  ['pricing preview is pre-rendered', pricingPreviewHtml.includes('Create enterprise clips.')],
  ['pricing preview is noindex', /<meta name="robots" content="noindex, nofollow"/.test(pricingPreviewHtml)],
  ['pricing preview has no canonical', !/<link rel="canonical"/.test(pricingPreviewHtml)],
  ['legal center is pre-rendered', legalHtml.includes('Legal terms and policies.')],
  ['legal center is indexable', /<meta name="robots" content="index, follow/.test(legalHtml)],
  ['terms are pre-rendered', termsHtml.includes('Terms of Service')],
  ['privacy policy is pre-rendered', privacyHtml.includes('Privacy Policy')],
  ['refund policy is pre-rendered', refundsHtml.includes('Refund and Cancellation Policy')],
  ['final-sale refund rule is pre-rendered', refundsHtml.includes('All sales are final')],
  ['legal pages have canonical URLs', /<link rel="canonical" href="https:\/\/[^\"]+\/legal\/terms"/.test(termsHtml)],
  ['terms are in sitemap', /<loc>https:\/\/[^<]+\/legal\/terms<\/loc>/.test(sitemap)],
];

const failures = assertions.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  throw new Error(`SEO verification failed: ${failures.join(', ')}`);
}

console.log(`SEO verification passed (${assertions.length} checks).`);
