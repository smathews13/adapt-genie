import type { Answer } from './app-types';
import type { Block } from './answer-markdown';
import type { SourceRef } from './answer-shape';
import { readerConversationTurns } from './conversation-export';
import { readAllConversationMessages } from './conversation-messages';
import { copyExportText, downloadExportBlob, downloadExportText } from './export-download';
import {
  answerMarkdown,
  conversationMarkdown,
  deterministicFilename,
  exportTable,
  tableCsv,
} from './export-serializers';

export async function copyAnswerExport(question: string, answer: Answer): Promise<void> {
  await copyExportText(answerMarkdown(question, answer));
}

export function downloadAnswerMarkdown(question: string, answer: Answer, label: string): void {
  downloadExportText(answerMarkdown(question, answer), deterministicFilename(label, 'md'));
}

export async function downloadAnswerPdf(question: string, answer: Answer, label: string): Promise<void> {
  const { markdownPdf } = await import('./export-generators');
  downloadExportBlob(await markdownPdf(answerMarkdown(question, answer)), deterministicFilename(label, 'pdf'));
}

function parsedTable(block: Extract<Block, { kind: 'table' }>, sources: readonly SourceRef[]) {
  return exportTable(block, sources);
}

function tableLabel(table: ReturnType<typeof parsedTable>): string {
  return table.headers.filter(Boolean).join('-') || 'answer-table';
}

export function downloadTableCsv(block: Extract<Block, { kind: 'table' }>, sources: readonly SourceRef[]): void {
  const table = parsedTable(block, sources);
  downloadExportText(tableCsv(table), deterministicFilename(tableLabel(table), 'csv'), 'text/csv;charset=utf-8');
}

async function storedConversationMarkdown(conversationId: string, title: string): Promise<string> {
  const messages = await readAllConversationMessages(conversationId);
  return conversationMarkdown(title, readerConversationTurns(messages));
}

export async function copyConversationExport(conversationId: string, title: string): Promise<void> {
  await copyExportText(await storedConversationMarkdown(conversationId, title));
}

export async function downloadConversationMarkdown(conversationId: string, title: string): Promise<void> {
  downloadExportText(await storedConversationMarkdown(conversationId, title), deterministicFilename(title, 'md'));
}

export async function downloadConversationPdf(conversationId: string, title: string): Promise<void> {
  const markdown = await storedConversationMarkdown(conversationId, title);
  const { markdownPdf } = await import('./export-generators');
  downloadExportBlob(await markdownPdf(markdown), deterministicFilename(title, 'pdf'));
}
