export function exportCompleteMessage(label: string): string {
  const match = /^(Copy|Download) (.+)$/.exec(label);
  if (!match) return 'Export complete';
  return `${match[2]} ${match[1] === 'Copy' ? 'copied' : 'downloaded'}`;
}
