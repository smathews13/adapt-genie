import type { ExportTable } from './export-serializers';

const PDF_PAGE_TOP = 748;
const PDF_PAGE_BOTTOM = 44;

interface PdfLine {
  text: string;
  size: number;
  bold?: boolean;
  mono?: boolean;
  indent?: number;
  gapAfter?: number;
}

function printablePdfText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrappedText(value: string, width = 92): string[] {
  if (!value) return [''];
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > width) {
    const whitespace = remaining.lastIndexOf(' ', width);
    const cut = whitespace > 0 ? whitespace + 1 : width;
    lines.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  lines.push(remaining);
  return lines;
}

function pdfLines(markdown: string): PdfLine[] {
  return markdown.split('\n').flatMap((line): PdfLine[] => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const size = heading[1].length === 1 ? 18 : heading[1].length === 2 ? 15 : 12;
      return wrappedText(heading[2], size >= 15 ? 64 : 82).map((text, index, lines) => ({
        text,
        size,
        bold: true,
        gapAfter: index === lines.length - 1 ? 6 : 0,
      }));
    }
    const list = /^(\s*)([-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      return wrappedText(list[3].replace(/\*\*|`/g, ''), 82).map((text, index) => ({
        text: `${index === 0 ? `${list[2]} ` : ''}${text}`,
        size: 10,
        indent: 12 + list[1].length * 4 + (index > 0 ? 12 : 0),
      }));
    }
    if (/^\|.*\|$/.test(line)) {
      return wrappedText(line.replace(/\*\*|`/g, ''), 108).map((text) => ({ text, size: 8, mono: true }));
    }
    return wrappedText(line.replace(/\*\*|`/g, ''), 92).map((text) => ({
      text,
      size: 10,
      gapAfter: line ? 0 : 5,
    }));
  });
}

function paginatePdf(lines: readonly PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let y = PDF_PAGE_TOP;
  for (const line of lines) {
    const height = Math.max(12, line.size * 1.35) + (line.gapAfter ?? 0);
    if (y - height < PDF_PAGE_BOTTOM && pages[pages.length - 1].length > 0) {
      pages.push([]);
      y = PDF_PAGE_TOP;
    }
    pages[pages.length - 1].push(line);
    y -= height;
  }
  return pages;
}

function pdfDocument(lines: readonly PdfLine[]): Uint8Array {
  const pages = paginatePdf(lines);
  const pageObjectNumbers = pages.map((_, index) => 6 + index * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((page, index) => {
    const pageObject = pageObjectNumbers[index];
    const streamObject = pageObject + 1;
    let y = PDF_PAGE_TOP;
    const stream = page
      .map((line) => {
        const operation = `BT /${line.mono ? 'F3' : line.bold ? 'F2' : 'F1'} ${line.size} Tf ${44 + (line.indent ?? 0)} ${y} Td (${printablePdfText(line.text)}) Tj ET`;
        y -= Math.max(12, line.size * 1.35) + (line.gapAfter ?? 0);
        return operation;
      })
      .join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${streamObject} 0 R >>`,
      `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
    );
  });

  let pdf = '%PDF-1.7\n%\xff\xff\xff\xff\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function markdownPdf(markdown: string): Promise<Blob> {
  return Promise.resolve(new Blob([new Uint8Array(pdfDocument(pdfLines(markdown)))], { type: 'application/pdf' }));
}

function tablePdfLines(table: ExportTable): PdfLine[] {
  const width = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1);
  const headers = Array.from({ length: width }, (_, index) => table.headers[index] || `Column ${index + 1}`);
  const lines: PdfLine[] = [{ text: 'Table export', size: 18, bold: true, gapAfter: 6 }];
  if (table.sources.length > 0) {
    lines.push(...wrappedText(`Source: ${table.sources.join(', ')}`, 82).map((value) => ({ text: value, size: 10 })));
  }
  lines.push(...wrappedText(`Columns: ${headers.join(', ')}`, 82).map((value) => ({ text: value, size: 10 })));
  table.rows.forEach((row, rowIndex) => {
    lines.push({ text: `Row ${rowIndex + 1}`, size: 12, bold: true, gapAfter: 2 });
    headers.forEach((header, column) => {
      lines.push(
        ...wrappedText(`${header}: ${row[column] ?? ''}`, 80).map((value) => ({
          text: value,
          size: 10,
          indent: 12,
        }))
      );
    });
  });
  return lines;
}

export function tablePdf(table: ExportTable): Promise<Blob> {
  return Promise.resolve(new Blob([new Uint8Array(pdfDocument(tablePdfLines(table)))], { type: 'application/pdf' }));
}

export function wrappedCanvasLines(value: string, width: number, measure: (text: string) => number): string[] {
  if (!value) return [''];
  const lines: string[] = [];
  let line = '';
  for (const character of value) {
    const next = `${line}${character}`;
    if (line && measure(next) > width) {
      lines.push(line);
      line = character;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_AREA = 64_000_000;
const PREFERRED_CELL_WIDTH = 190;
const MIN_CELL_WIDTH = 96;
const PNG_PADDING = 12;
const PNG_LINE_HEIGHT = 20;

export interface TablePngLayout {
  width: number;
  height: number;
  cellWidth: number;
  sourceLines: string[];
  rowLines: string[][][];
  rowHeights: number[];
  sourceHeight: number;
}

export function tablePngLayout(table: ExportTable, measure: (text: string) => number): TablePngLayout {
  const rows = table.headers.length > 0 ? [table.headers, ...table.rows] : table.rows;
  const columns = Math.max(1, ...rows.map((row) => row.length));
  if (columns * MIN_CELL_WIDTH > MAX_CANVAS_DIMENSION) {
    throw new Error('This table is too wide for a PNG. Copy TSV or download PDF to preserve every column.');
  }
  const cellWidth = Math.min(PREFERRED_CELL_WIDTH, Math.floor(MAX_CANVAS_DIMENSION / columns));
  const width = columns * cellWidth;
  const sourceText = table.sources.length > 0 ? `Source: ${table.sources.join(', ')}` : '';
  const sourceLines = sourceText ? wrappedCanvasLines(sourceText, width - PNG_PADDING * 2, measure) : [];
  const sourceHeight = sourceLines.length > 0 ? sourceLines.length * PNG_LINE_HEIGHT + PNG_PADDING * 2 : 16;
  const rowLines = rows.map((row) =>
    Array.from({ length: columns }, (_, index) =>
      wrappedCanvasLines(row[index] ?? '', cellWidth - PNG_PADDING * 2, measure)
    )
  );
  const rowHeights = rowLines.map(
    (row) => Math.max(...row.map((lines) => lines.length), 1) * PNG_LINE_HEIGHT + PNG_PADDING * 2
  );
  const height = sourceHeight + rowHeights.reduce((sum, value) => sum + value, 0);
  if (height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_AREA) {
    throw new Error('This table is too large for a PNG. Copy TSV or download PDF to preserve every row.');
  }
  return { width, height, cellWidth, sourceLines, rowLines, rowHeights, sourceHeight };
}

export async function tablePng(table: ExportTable): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas export is unavailable');
  context.font = '14px system-ui, sans-serif';
  const layout = tablePngLayout(table, (text) => context.measureText(text).width);
  canvas.width = layout.width;
  canvas.height = layout.height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '14px system-ui, sans-serif';
  context.fillStyle = '#403d3d';
  layout.sourceLines.forEach((line, index) =>
    context.fillText(line, PNG_PADDING, PNG_PADDING + 15 + index * PNG_LINE_HEIGHT)
  );
  let y = layout.sourceHeight;
  layout.rowLines.forEach((row, rowIndex) => {
    const height = layout.rowHeights[rowIndex];
    if (rowIndex === 0 && table.headers.length > 0) {
      context.fillStyle = '#f1f0ee';
      context.fillRect(0, y, canvas.width, height);
      context.font = '600 14px system-ui, sans-serif';
    } else {
      context.font = '14px system-ui, sans-serif';
    }
    context.strokeStyle = '#cbc8c4';
    row.forEach((lines, column) => {
      const x = column * layout.cellWidth;
      context.strokeRect(x, y, layout.cellWidth, height);
      context.fillStyle = '#211f1f';
      lines.forEach((line, lineIndex) =>
        context.fillText(line, x + PNG_PADDING, y + PNG_PADDING + 15 + lineIndex * PNG_LINE_HEIGHT)
      );
    });
    y += height;
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export could not be generated');
  return blob;
}
