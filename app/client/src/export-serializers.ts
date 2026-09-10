import { normalizeReaderAnswer } from '../../shared/answer-content-policy';
import { readerFacingNarrative, readerFacingTakeaway, stripToolCallDumps } from './reader-facing-answer';
import { inlinePlainText, parseAnswerMarkdown, type Block, type Inline } from './answer-markdown';
import type { NormalizedAnswer, SourceRef } from './answer-shape';

export type ReaderExportTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; answer: NormalizedAnswer };

export interface ExportTable {
  headers: string[];
  rows: string[][];
  sources: string[];
}

function inlineMarkdown(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return node.runs.map((run) => run.text).join('');
      if (node.kind === 'code') return `\`${node.runs.map((run) => run.text).join('')}\``;
      if (node.kind === 'strong') return `**${inlineMarkdown(node.children)}**`;
      if (node.kind === 'link') return `[${inlineMarkdown(node.children)}](${node.href})`;
      return '  \n';
    })
    .join('');
}

export function blockMarkdown(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
      return inlineMarkdown(block.children);
    case 'heading':
      return `${'#'.repeat(block.level)} ${inlineMarkdown(block.children)}`;
    case 'list':
      return block.items
        .map(
          (item, index) =>
            `${'  '.repeat(item.depth)}${block.ordered ? `${index + 1}.` : '-'} ${inlineMarkdown(item.children)}`
        )
        .join('\n');
    case 'rule':
      return '---';
    case 'code':
      return `\`\`\`${block.language}\n${block.text}\n\`\`\``;
    case 'table': {
      const rows = [block.header, ...block.rows].filter((row) => row !== undefined);
      if (rows.length === 0) return '';
      const width = Math.max(...rows.map((row) => row.cells.length));
      const line = (cells: readonly { children: Inline[] }[]) =>
        `| ${Array.from({ length: width }, (_, index) => inlineMarkdown(cells[index]?.children ?? []).replace(/\|/g, '\\|')).join(' | ')} |`;
      const header = block.header ?? {
        start: block.start,
        cells: Array.from({ length: width }, (_, index) => ({ start: block.start + index, children: [] })),
      };
      return [
        line(header.cells),
        `| ${Array.from({ length: width }, (_, index) => {
          const align = block.align[index];
          return align === 'center' ? ':---:' : align === 'right' ? '---:' : '---';
        }).join(' | ')} |`,
        ...block.rows.map((row) => line(row.cells)),
      ].join('\n');
    }
  }
}

function answerBodies(answer: NormalizedAnswer): string[] {
  const normalized = normalizeReaderAnswer(answer);
  const takeaway = readerFacingTakeaway(normalized.takeaway, normalized.narrative, {
    figures: normalized.figures,
    content: normalized.content,
  });
  const narrative = readerFacingNarrative(normalized.takeaway, normalized.narrative, {
    figures: normalized.figures,
    content: normalized.content,
  });
  const content = stripToolCallDumps(normalized.content ?? '');
  return [takeaway, narrative, content].filter((value, index, values) => {
    const text = value.trim();
    return Boolean(text) && values.findIndex((candidate) => candidate.trim() === text) === index;
  });
}

function sourceMarkdown(sources: readonly SourceRef[]): string {
  if (sources.length === 0) return '';
  return `### Sources\n${sources
    .map((source) => {
      const detail = [
        source.role === 'reading' ? 'queried for figures' : source.role === 'reference' ? 'definition' : '',
        source.freshness,
      ]
        .filter(Boolean)
        .join(', ');
      return `- \`${source.name}\`${detail ? ` — ${detail}` : ''}`;
    })
    .join('\n')}`;
}

export function answerContentMarkdown(answer: NormalizedAnswer): string {
  const normalized = normalizeReaderAnswer(answer);
  const sections = answerBodies(normalized).map((body) =>
    parseAnswerMarkdown(stripToolCallDumps(body)).map(blockMarkdown).filter(Boolean).join('\n\n')
  );
  if (normalized.caveats.length > 0) {
    sections.push(`### Caveats\n${normalized.caveats.map((caveat) => `- ${caveat}`).join('\n')}`);
  }
  const sources = sourceMarkdown(normalized.sources);
  if (sources) sections.push(sources);
  return sections.filter(Boolean).join('\n\n').trim();
}

export function answerMarkdown(question: string, answer: NormalizedAnswer): string {
  return [`## Question\n${question.trim()}`, '## Answer', answerContentMarkdown(answer)]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function conversationMarkdown(title: string, turns: readonly ReaderExportTurn[]): string {
  const body = turns
    .map((turn) => {
      const content = 'answer' in turn ? answerContentMarkdown(turn.answer) : turn.content.trim();
      return `## ${turn.role === 'user' ? 'User' : 'ADAPT'}\n\n${content}`.trim();
    })
    .join('\n\n---\n\n');
  return `# ${title.trim() || 'Conversation'}\n\n${body}`.trim();
}

export function exportTable(block: Extract<Block, { kind: 'table' }>, sources: readonly SourceRef[]): ExportTable {
  return {
    headers: block.header?.cells.map((cell) => inlinePlainText(cell.children).trim()) ?? [],
    rows: block.rows.map((row) => row.cells.map((cell) => inlinePlainText(cell.children).trim())),
    sources: sources.map((source) => source.name).filter(Boolean),
  };
}

function tsvCell(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export function tableTsv(table: ExportTable): string {
  const lines: string[] = [];
  if (table.sources.length > 0) lines.push(`# Source: ${table.sources.join(', ')}`);
  if (table.headers.length > 0) lines.push(table.headers.map(tsvCell).join('\t'));
  lines.push(...table.rows.map((row) => row.map(tsvCell).join('\t')));
  return lines.join('\n');
}

export function deterministicFilename(label: string, extension: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `adapt-${slug || 'export'}.${extension.replace(/^\./, '')}`;
}
