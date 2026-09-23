import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const TOKEN_FILES = new Set(['styles/astrolabe-tokens.css', 'styles/tokens.css']);
const BRAND_SELECTOR_FILE = 'styles/brand.css';
const BRAND_MARK_FILES = new Set(['BrandIcon.tsx']);
const ROUTE_PAINT_DEBT = new Set<string>();

const PAINT = /#[0-9a-f]{3,8}\b|rgba?\(|color-mix\(/gi;

function componentFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return componentFiles(absolute, relative);
    if (entry.name.endsWith('.css')) return [relative];
    if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) return [relative];
    return [];
  });
}

function declarations(relative: string): string {
  return readFileSync(`${SOURCE_ROOT}/${relative}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('ADAPT component paint boundary', () => {
  it('keeps all production CSS and TSX on canonical tokens', () => {
    const violations = new Map<string, string[]>();

    for (const relative of componentFiles(SOURCE_ROOT)) {
      if (TOKEN_FILES.has(relative) || ROUTE_PAINT_DEBT.has(relative) || BRAND_MARK_FILES.has(relative)) continue;
      let source = declarations(relative);
      if (relative === BRAND_SELECTOR_FILE) {
        source = source.replace(/\[fill='#[0-9a-f]{6}'\]/gi, '');
      }
      const paints = [...new Set(source.match(PAINT) ?? [])];
      if (paints.length > 0) violations.set(relative, paints);
    }

    expect([...violations]).toEqual([]);
  });

  it('has no route paint allowlist', () => {
    expect([...ROUTE_PAINT_DEBT]).toEqual([]);
  });

  it('limits literal brand paint to reviewed SVG selectors', () => {
    const brand = declarations(BRAND_SELECTOR_FILE);
    expect(brand.match(PAINT) ?? []).toEqual(['#2272B4', '#6FAEDD', '#B7D6EE']);
    expect(declarations('BrandIcon.tsx').match(PAINT) ?? []).toEqual(['#11171C']);
  });
});
