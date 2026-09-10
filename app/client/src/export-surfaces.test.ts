import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const answerCard = readFileSync(new URL('./AnswerCard.tsx', import.meta.url), 'utf8');
const tables = readFileSync(new URL('./DataEntityLinks.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');
const generators = readFileSync(new URL('./export-generators.ts', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./export-actions.ts', import.meta.url), 'utf8');
const menu = readFileSync(new URL('./ExportMenu.tsx', import.meta.url), 'utf8');

describe('export surface wiring', () => {
  it('offers the required answer actions and retains conversation export support', () => {
    expect(answerCard).toContain("label: 'Copy Markdown'");
    expect(answerCard).toContain("label: 'Download Markdown'");
    expect(answerCard).toContain("label: 'Download PDF'");
    expect(actions).toContain('readAllConversationMessages(conversationId)');
    expect(actions).toContain('copyConversationExport');
    expect(actions).toContain('downloadConversationMarkdown');
    expect(actions).toContain('downloadConversationPdf');
  });

  it('puts answer export beside completed-answer feedback, not above the question', () => {
    expect(answerCard.indexOf('<ExportMenu')).toBeGreaterThan(answerCard.indexOf('className="feedback"'));
    expect(home).not.toContain('label="Export conversation"');
    expect(home).not.toContain('className="conversation-export"');
  });

  it('offers TSV, PNG and PDF directly on parsed answer tables', () => {
    expect(actions).toContain('exportTable(block, sources)');
    expect(tables).toContain("label: 'Copy TSV'");
    expect(tables).toContain("label: 'Download PNG'");
    expect(tables).toContain("label: 'Download PDF'");
  });

  it('keeps non-visual export work behind one lazy action boundary', () => {
    for (const visual of [answerCard, tables]) {
      expect(visual).toContain("await import('./export-actions')");
      expect(visual).not.toMatch(
        /^import .*from ['"]\.\/(?:export-serializers|export-generators|export-download|conversation-export)['"];?$/m
      );
    }
    expect(actions).toContain("from './export-serializers'");
    expect(actions).toContain("from './conversation-export'");
    expect(actions).toContain("from './export-download'");
    expect(actions).toContain("await import('./export-generators')");
  });

  it('never screenshots the DOM or launches a browser', () => {
    expect(generators).not.toMatch(/html2canvas|playwright|puppeteer|outerHTML|foreignObject/i);
    expect(generators).toContain("document.createElement('canvas')");
    expect(generators).toContain('printablePdfText(line.text)');
    expect(generators).toContain('paginatePdf');
    expect(generators).toContain('/Subtype /Type1 /BaseFont /Helvetica');
    expect(generators).not.toMatch(/canvas\.(?:width|height)\s*=\s*Math\.min/);
    expect(generators).toContain('too large for a PNG');
  });

  it('uses keyboard-addressable menu semantics and announces completion', () => {
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
    expect(menu).toContain('aria-live="polite"');
  });
});
