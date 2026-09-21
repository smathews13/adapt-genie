import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const answerCard = readFileSync(new URL('./AnswerCard.tsx', import.meta.url), 'utf8');
const tables = readFileSync(new URL('./DataEntityLinks.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');
const binary = readFileSync(new URL('./export-binary.ts', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./export-actions.ts', import.meta.url), 'utf8');
const menu = readFileSync(new URL('./ExportMenu.tsx', import.meta.url), 'utf8');

describe('export surface wiring', () => {
  it('offers all four answer formats on the answer card', () => {
    for (const label of [
      "label: 'Copy Markdown'",
      "label: 'Download Markdown'",
      "label: 'Download HTML'",
      "label: 'Download HTML for slides'",
      "label: 'Download JSON'",
      "label: 'Download PDF'",
    ]) {
      expect(answerCard).toContain(label);
    }
  });

  it('mounts the whole-conversation export menu on HomePage with every format', () => {
    expect(home).toContain('<ConversationExportMenu');
    expect(home).toContain('conversation-export-toolbar');
    expect(menu).toContain('downloadConversationMarkdown');
    expect(menu).toContain('downloadConversationHtml');
    expect(menu).toContain('downloadConversationJson');
    expect(menu).toContain('downloadConversationPdf');
    expect(actions).toContain('readAllConversationMessages(conversationId)');
  });

  it('offers TSV, PNG and PDF on parsed answer tables', () => {
    expect(tables).toContain("label: 'Copy TSV'");
    expect(tables).toContain("label: 'Download PNG'");
    expect(tables).toContain("label: 'Download PDF'");
    expect(actions).toContain('copyTableTsv');
    expect(actions).toContain('downloadTablePng');
    expect(actions).toContain('downloadTablePdf');
  });

  it('keeps non-visual export work behind one lazy action boundary', () => {
    for (const visual of [answerCard, tables]) {
      expect(visual).toContain("await import('./export-actions')");
      expect(visual).not.toMatch(
        /^import .*from ['"]\.\/(?:export-serializers|export-binary|export-download|chart-image)['"];?$/m
      );
    }
    expect(actions).toContain("from './export-serializers'");
    expect(actions).toContain("from './export-download'");
    expect(actions).toContain("await import('./export-binary')");
    expect(actions).toContain("await import('./chart-image')");
  });

  it('never screenshots the DOM or launches a browser in the PDF/PNG writer', () => {
    expect(binary).not.toMatch(/html2canvas|playwright|puppeteer|outerHTML|foreignObject/i);
    expect(binary).toContain("document.createElement('canvas')");
    expect(binary).toContain('/Subtype /Type1 /BaseFont /Helvetica');
    expect(binary).toContain('/Filter /DCTDecode');
    expect(binary).toContain('too large for a PNG');
  });

  it('uses keyboard-addressable menu semantics and announces completion', () => {
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
    expect(menu).toContain('aria-live="polite"');
    expect(menu).toContain("message: 'Export complete'");
    expect(menu).toContain('export-menu-notice--${notice.tone}');
  });
});
