import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const asset of ['og-easy-edits', 'og-podcast-clips']) {
  const source = await readFile(path.join(root, 'public', `${asset}.svg`));
  await sharp(source, { density: 144 })
    .resize(1200, 630, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(root, 'public', `${asset}.png`));
}
