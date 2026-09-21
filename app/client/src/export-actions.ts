import type { NormalizedAnswer } from './answer-shape';
import type { Chart } from './AnswerCharts';
import { readAllConversationMessages } from './conversation-messages';
import {
  answerCharts,
  conversationChartsByMessage,
  safeExportFilename,
  serializeAnswerHtml,
  serializeAnswerJson,
  serializeAnswerMarkdown,
  serializeChartJson,
  serializeConversationHtml,
  serializeConversationJson,
  serializeConversationMarkdown,
  serializeTableTsv,
  type ConversationChartImages,
  type ExportHtmlTheme,
  type ExportTable,
} from './export-serializers';
import { copyExportText, downloadExportBlob, downloadExportText } from './export-download';

/**
 * The answer's charts as PNG data URLs, keyed by id, or an empty map.
 *
 * The picture rendering lives behind a dynamic import: it pulls Plotly, which is
 * the 1.4 MB chunk, and only a download that actually carries a chart should pay
 * for it. An answer with no charts never loads it.
 */
async function answerChartImages(
  answer: NormalizedAnswer,
  format: 'png' | 'jpeg' = 'png'
): Promise<Map<string, string>> {
  const charts = answerCharts(answer);
  if (charts.length === 0) return new Map();
  const { chartPngDataUrls } = await import('./chart-image');
  return chartPngDataUrls(charts, format);
}

/**
 * Copy stays text-only: charts are rasters, and a few hundred KB of base64 in the
 * clipboard is not what someone pasting into Slack or an editor wants. The download
 * paths below carry the pictures.
 */
export async function copyAnswerMarkdown(answer: NormalizedAnswer, question: string): Promise<void> {
  await copyExportText(serializeAnswerMarkdown(question, answer));
}

export async function downloadAnswerMarkdown(answer: NormalizedAnswer, question: string): Promise<void> {
  const filename = safeExportFilename(question || answer.takeaway, 'md');
  const markdown = serializeAnswerMarkdown(question, answer, await answerChartImages(answer));
  downloadExportText(markdown, filename);
}

export async function downloadAnswerPdf(answer: NormalizedAnswer, question: string): Promise<void> {
  // Charts embed as JPEG (DCTDecode) image XObjects: the PDF writer's one
  // embeddable image filter. The Markdown carries them as jpeg data URLs and the
  // writer pulls the picture out of the `![…](data:image/jpeg;…)` line.
  const filename = safeExportFilename(question || answer.takeaway, 'pdf');
  const markdown = serializeAnswerMarkdown(question, answer, await answerChartImages(answer, 'jpeg'));
  const { markdownPdf } = await import('./export-binary');
  downloadExportBlob(markdownPdf(markdown), filename);
}

export async function downloadAnswerHtml(
  answer: NormalizedAnswer,
  question: string,
  theme: ExportHtmlTheme = 'page'
): Promise<void> {
  const filename = safeExportFilename(question || answer.takeaway, 'html');
  const html = serializeAnswerHtml(question, answer, await answerChartImages(answer), theme);
  downloadExportText(html, filename, 'text/html;charset=utf-8');
}

export function downloadAnswerJson(answer: NormalizedAnswer, question: string): void {
  const filename = safeExportFilename(question || answer.takeaway, 'json');
  downloadExportText(serializeAnswerJson(question, answer), filename, 'application/json;charset=utf-8');
}

/* ── Single-chart export ─────────────────────────────────────────────────────── */

/** Decodes a `data:...;base64,...` URL to a Blob so a rendered chart can be saved as a file. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function downloadChartPng(chart: Chart, name?: string): Promise<void> {
  const { chartPngDataUrl } = await import('./chart-image');
  const blob = dataUrlToBlob(await chartPngDataUrl(chart));
  downloadExportBlob(blob, safeExportFilename(name || chart.title || 'chart', 'png'));
}

export function downloadChartJson(chart: Chart, name?: string): void {
  downloadExportText(
    serializeChartJson(chart),
    safeExportFilename(name || chart.title || 'chart', 'json'),
    'application/json;charset=utf-8'
  );
}

/* ── Table export ────────────────────────────────────────────────────────────── */

export async function copyTableTsv(table: ExportTable): Promise<void> {
  await copyExportText(serializeTableTsv(table));
}

export async function downloadTablePng(table: ExportTable, name: string): Promise<void> {
  const { tablePng } = await import('./export-binary');
  const filename = safeExportFilename(name, 'png');
  downloadExportBlob(await tablePng(table), filename);
}

export async function downloadTablePdf(table: ExportTable, name: string): Promise<void> {
  const { tablePdf } = await import('./export-binary');
  const filename = safeExportFilename(name, 'pdf');
  downloadExportBlob(tablePdf(table), filename);
}

/* ── Whole-conversation export ───────────────────────────────────────────────── */

/**
 * Every answer turn's charts as PNG data URLs, keyed by message id.
 *
 * Same lazy-Plotly boundary as the single-answer path: a thread with no charts
 * never loads the 1.4 MB library. Keyed by message so two turns cannot collide
 * on the `chart-1` id each of them mints.
 */
async function conversationChartImages(
  messages: readonly import('./app-types').ConversationMessage[],
  format: 'png' | 'jpeg' = 'png'
): Promise<ConversationChartImages> {
  const byMessage = conversationChartsByMessage(messages);
  if (byMessage.size === 0) return new Map();
  const { chartPngDataUrls } = await import('./chart-image');
  const entries = await Promise.all(
    [...byMessage].map(async ([id, charts]) => [id, await chartPngDataUrls(charts, format)] as const)
  );
  return new Map(entries);
}

/**
 * Copy stays text-only for the same reason the answer copy does: a transcript's
 * worth of base64 chart data is not what someone pasting into Slack wants.
 */
export async function copyConversationExport(conversationId: string, title: string): Promise<void> {
  await copyExportText(serializeConversationMarkdown(title, await readAllConversationMessages(conversationId)));
}

export async function downloadConversationMarkdown(conversationId: string, title: string): Promise<void> {
  const messages = await readAllConversationMessages(conversationId);
  const markdown = serializeConversationMarkdown(title, messages, await conversationChartImages(messages));
  downloadExportText(markdown, safeExportFilename(title, 'md'));
}

export async function downloadConversationHtml(
  conversationId: string,
  title: string,
  theme: ExportHtmlTheme = 'page'
): Promise<void> {
  const messages = await readAllConversationMessages(conversationId);
  const html = serializeConversationHtml(title, messages, await conversationChartImages(messages), theme);
  downloadExportText(html, safeExportFilename(title, 'html'), 'text/html;charset=utf-8');
}

export async function downloadConversationJson(conversationId: string, title: string): Promise<void> {
  downloadExportText(
    serializeConversationJson(title, await readAllConversationMessages(conversationId)),
    safeExportFilename(title, 'json'),
    'application/json;charset=utf-8'
  );
}

export async function downloadConversationPdf(conversationId: string, title: string): Promise<void> {
  const messages = await readAllConversationMessages(conversationId);
  const markdown = serializeConversationMarkdown(title, messages, await conversationChartImages(messages, 'jpeg'));
  const { markdownPdf } = await import('./export-binary');
  downloadExportBlob(markdownPdf(markdown), safeExportFilename(title, 'pdf'));
}
