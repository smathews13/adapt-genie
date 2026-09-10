export async function copyExportText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function downloadExportBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

export function downloadExportText(text: string, filename: string, type = 'text/markdown;charset=utf-8'): void {
  downloadExportBlob(new Blob([text], { type }), filename);
}
