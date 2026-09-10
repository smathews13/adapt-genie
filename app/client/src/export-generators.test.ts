import { describe, expect, it } from 'vitest';

import { markdownPdf, tablePdf, tablePngLayout, wrappedCanvasLines } from './export-generators';

describe('selectable text PDF generation', () => {
  it('writes text operators and adds pages for long content', async () => {
    const blob = await markdownPdf(Array.from({ length: 100 }, (_, index) => `Reader line ${index}`).join('\n'));
    const pdf = await blob.text();
    expect(blob.type).toBe('application/pdf');
    expect(pdf).toContain('(Reader line 0) Tj');
    expect(pdf).toContain('(Reader line 99) Tj');
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(pdf).toContain('xref');
  });

  it('keeps complete table values, row labels and source attribution as selectable text', async () => {
    const longValue = `start-${'x'.repeat(240)}-end`;
    const pdf = await (
      await tablePdf({
        headers: ['Region', 'Revenue'],
        rows: [
          ['East', longValue],
          ['West', '$9'],
        ],
        sources: ['catalog.gold.revenue'],
      })
    ).text();
    expect(pdf).toContain('(Source: catalog.gold.revenue) Tj');
    expect(pdf).toContain('(Columns: Region, Revenue) Tj');
    expect(pdf).toContain('(Row 1) Tj');
    expect(pdf).toContain('(Region: East) Tj');
    expect(pdf).toContain('(Row 2) Tj');
    const selectedText = [...pdf.matchAll(/\(([^()]*)\) Tj/g)].map((match) => match[1]).join('');
    expect(selectedText).toContain(longValue);
  });
});

describe('complete PNG layout', () => {
  const measure = (text: string) => text.length * 8;

  it('splits unbroken values without dropping a character', () => {
    const value = `prefix-${'A'.repeat(500)}-suffix`;
    const lines = wrappedCanvasLines(value, 80, measure);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join('')).toBe(value);
  });

  it('wraps every source and cell character into the canvas layout', () => {
    const source = `catalog.${'source'.repeat(120)}`;
    const value = `value-${'z'.repeat(800)}-end`;
    const layout = tablePngLayout(
      {
        headers: ['Long value'],
        rows: [[value]],
        sources: [source],
      },
      measure
    );
    expect(layout.sourceLines.length).toBeGreaterThan(1);
    expect(layout.sourceLines.join('')).toBe(`Source: ${source}`);
    expect(layout.rowLines[1][0].join('')).toBe(value);
    expect(layout.width).toBeLessThanOrEqual(16_384);
    expect(layout.height).toBeLessThanOrEqual(16_384);
  });

  it('fails loudly instead of truncating an impossible canvas', () => {
    const tooManyColumns = Array.from({ length: 200 }, (_, index) => `Column ${index}`);
    expect(() => tablePngLayout({ headers: tooManyColumns, rows: [], sources: [] }, measure)).toThrow(
      'too wide for a PNG'
    );
    const tooManyRows = Array.from({ length: 1_000 }, () => ['row']);
    expect(() => tablePngLayout({ headers: ['Value'], rows: tooManyRows, sources: [] }, measure)).toThrow(
      'too large for a PNG'
    );
  });
});
