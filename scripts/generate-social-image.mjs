import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = await sharp(path.join(root, 'public', 'brand', 'Untitled design-4.svg'))
  .trim()
  .resize(50, 50, { fit: 'contain' })
  .png()
  .toBuffer();

for (const asset of ['og-easy-edits', 'og-podcast-clips']) {
  const source = await readFile(path.join(root, 'public', `${asset}.svg`));
  const sourceWithoutExternalLogo = source.toString().replace(/<image href="\/brand\/Untitled%20design-4\.svg"[^>]*\/>/, '');
  await sharp(Buffer.from(sourceWithoutExternalLogo), { density: 144 })
    .resize(1200, 630, { fit: 'fill' })
    .composite([{ input: logo, left: 64, top: 52 }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(root, 'public', `${asset}.png`));
}
