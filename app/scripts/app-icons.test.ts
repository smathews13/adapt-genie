import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ACCENT, ICON_FILES, INK, PLATE, iconPng, iconSvg } from './app-icons.mts';

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../client/public', import.meta.url)));
const INDEX = path.resolve(fileURLToPath(new URL('../client/index.html', import.meta.url)));

describe('ADAPT application icons', () => {
  it('names ADAPT in the document and manifest', async () => {
    const html = await readFile(INDEX, 'utf8');
    const manifest = JSON.parse(await readFile(path.join(PUBLIC_DIR, 'site.webmanifest'), 'utf8'));
    expect(html).toContain('<title>ADAPT</title>');
    expect(manifest.name).toBe('ADAPT');
    expect(manifest.short_name).toBe('ADAPT');
    expect(html.toLowerCase()).not.toContain('<title>astro' + 'labe</title>');
  });

  it('ships every icon requested by the document and manifest', async () => {
    const html = await readFile(INDEX, 'utf8');
    const manifest = JSON.parse(await readFile(path.join(PUBLIC_DIR, 'site.webmanifest'), 'utf8'));
    const requested = [
      ...[...html.matchAll(/href="\/([\w-]+\.png)"/g)].map((match) => match[1]),
      ...manifest.icons.map((icon: { src: string }) => icon.src.replace(/^\//, '')),
    ];
    for (const name of requested) {
      const size = ICON_FILES[name];
      expect(size, name).toBeDefined();
      if (!size) throw new Error(`No generated icon size registered for ${name}`);
      const actual = await readFile(path.join(PUBLIC_DIR, name));
      const metadata = await sharp(actual).metadata();
      expect(metadata.width, name).toBeGreaterThan(0);
      expect(metadata.height, name).toBe(metadata.width);
      expect(actual.equals(await iconPng(size))).toBe(true);
    }
  });

  it('uses the static ADAPT loading mark and brand colors', () => {
    const svg = iconSvg(32);
    expect(svg).toContain('M 15 100 L 50 13 L 85 100');
    expect(svg).toContain(`stroke="${INK}"`);
    expect(svg).toContain(`fill="${ACCENT}"`);
    expect(svg).toContain(`fill="${PLATE}"`);
    expect(svg).not.toContain('astro' + 'labe');
  });
});
