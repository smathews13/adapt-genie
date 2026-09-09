/**
 * Deterministically rasterize ADAPT's A mark for every browser icon size.
 *
 * The geometry is the static frame of AdaptLoadingAnimation: a white A peak
 * with the teal dot and crossbar on the app's dark surface. `sharp` is a
 * build-time dependency only; the generated PNGs are committed in
 * `client/public`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import sharp from 'sharp';

export const ICON_FILES: Readonly<Record<string, number>> = {
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'favicon-48x48.png': 48,
  'apple-touch-icon.png': 180,
  'favicon-192x192.png': 192,
  'favicon-512x512.png': 512,
};

export const PLATE = '#11171c';
export const INK = '#ffffff';
export const ACCENT = '#3ec6b4';

const SUPERSAMPLE = 4;

export function iconSvg(size: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 112 112" fill="none">`,
    `<rect width="112" height="112" rx="18" fill="${PLATE}" />`,
    '<g transform="translate(6 0)">',
    `<path d="M 15 100 L 50 13 L 85 100" stroke="${INK}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" />`,
    `<circle cx="50" cy="11" r="8.5" fill="${ACCENT}" />`,
    `<path d="M 36 66 L 64 66" stroke="${ACCENT}" stroke-width="11" stroke-linecap="round" />`,
    '</g>',
    '</svg>',
  ].join('');
}

/** The icon at one size, as PNG bytes. */
export async function iconPng(size: number): Promise<Buffer> {
  const svg = iconSvg(size).replace(
    `width="${size}" height="${size}"`,
    `width="${size * SUPERSAMPLE}" height="${size * SUPERSAMPLE}"`
  );
  return sharp(Buffer.from(svg)).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
}

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../client/public', import.meta.url)));

async function main(): Promise<number> {
  const flag = process.argv.indexOf('--out');
  const out = flag === -1 ? PUBLIC_DIR : path.resolve(process.argv[flag + 1]);
  await mkdir(out, { recursive: true });
  for (const [name, size] of Object.entries(ICON_FILES)) {
    const png = await iconPng(size);
    await writeFile(path.join(out, name), png);
    console.log(`${String(png.length).padStart(7)} bytes  ${name}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  process.exitCode = await main();
}
