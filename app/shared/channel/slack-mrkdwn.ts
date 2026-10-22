/**
 * Convert the agent's Markdown into Slack mrkdwn.
 *
 * Slack does not render CommonMark: `**bold**` shows its asterisks, `- item`
 * shows its hyphen, `# heading` shows its hash, and pipe tables arrive as rows
 * of bars. Code is held aside first so nothing inside it is rewritten, and
 * `&`, `<`, `>` are escaped everywhere else because Slack reads `<...>` as a
 * link or mention.
 */

const HOLD = '\u0000';

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? url.replace(/[<>|]/g, encodeURIComponent)
      : null;
  } catch {
    return null;
  }
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableRule(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

/** A pipe table becomes aligned monospace, the one table shape Slack shows. */
function tableBlock(rows: string[]): string {
  const cells = rows
    .filter((row) => !isTableRule(row))
    .map((row) =>
      row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim().replace(/\*\*|__|`/g, ''))
    );
  const widths: number[] = [];
  for (const row of cells) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return [
    '```',
    ...cells.map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i]))
        .join('  ')
        .trimEnd()
    ),
    '```',
  ].join('\n');
}

function inline(line: string, held: string[]): string {
  const hold = (value: string) => `${HOLD}${held.push(value) - 1}${HOLD}`;
  let text = line.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`\`${escapeText(code)}\``));
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    const target = safeUrl(url);
    return target ? hold(`<${target}|${escapeText(label).replace(/\|/g, '/')}>`) : match;
  });
  text = escapeText(text);
  text = text.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, (_m, _d, body: string) => hold(`*${body}*`));
  text = text.replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\w)/g, '$1_$2_');
  text = text.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '~$1~');
  return text;
}

function block(line: string, held: string[]): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  if (heading) return `*${inline(heading[1].replace(/\*\*|__/g, ''), held)}*`;
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return '';
  const quote = /^\s*>\s?(.*)$/.exec(line);
  if (quote) return `>${inline(quote[1], held)}`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) {
    const depth = Math.floor(bullet[1].replace(/\t/g, '  ').length / 2);
    return `${'    '.repeat(depth)}${depth ? '◦' : '•'} ${inline(bullet[2], held)}`;
  }
  const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
  if (numbered) {
    const depth = Math.floor(numbered[1].replace(/\t/g, '  ').length / 2);
    return `${'    '.repeat(depth)}${numbered[2]}. ${inline(numbered[3], held)}`;
  }
  return inline(line, held);
}

export function markdownToMrkdwn(markdown: string): string {
  const held: string[] = [];
  const hold = (value: string) => `${HOLD}${held.push(value) - 1}${HOLD}`;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const fence = /^\s*(```|~~~)/.exec(lines[i]);
    if (fence) {
      const body: string[] = [];
      for (i += 1; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i += 1) body.push(lines[i]);
      out.push(hold(['```', escapeText(body.join('\n')), '```'].join('\n')));
      continue;
    }
    if (isTableRow(lines[i]) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const rows: string[] = [];
      for (; i < lines.length && isTableRow(lines[i]); i += 1) rows.push(lines[i]);
      i -= 1;
      out.push(hold(escapeText(tableBlock(rows))));
      continue;
    }
    out.push(block(lines[i], held));
  }
  let text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  for (let pass = 0; pass < 2 && text.includes(HOLD); pass += 1) {
    text = text.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_m, index: string) => held[Number(index)]);
  }
  return text;
}

/**
 * Split mrkdwn into pieces Slack accepts in one section, at paragraph breaks
 * first and line breaks second, so a long narrative is shown rather than
 * replaced by the size-limit summary. A code block is never split.
 */
export function splitMrkdwn(text: string, limit: number): string[] {
  const units: { text: string; sep: string }[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length <= limit || paragraph.startsWith('```')) units.push({ text: paragraph, sep: '\n\n' });
    else paragraph.split('\n').forEach((line, i) => units.push({ text: line, sep: i ? '\n' : '\n\n' }));
  }
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const joined = current ? `${current}${unit.sep}${unit.text}` : unit.text;
    if (joined.length <= limit) current = joined;
    else {
      if (current) chunks.push(current);
      current = unit.text;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
