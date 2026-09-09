import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MAX_PDF_BYTES,
  MAX_PDF_TEXT_CHARS,
  PdfExtractionPool,
  PdfTextError,
  extractPdfText,
  isPdfFilename,
  isPdfMimeType,
} from './pdf-text';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const testWorkerUrl = new URL('./__fixtures__/pdf-test-worker.mjs', import.meta.url);
const pools: PdfExtractionPool[] = [];

function loadFixture(name: string) {
  return readFile(path.join(fixtureDir, name));
}

let simpleText: Buffer;
let multipage: Buffer;
let imageOnly: Buffer;
let largeText: Buffer;
let encrypted: Buffer;

beforeAll(async () => {
  [simpleText, multipage, imageOnly, largeText, encrypted] = await Promise.all([
    loadFixture('simple-text.pdf'),
    loadFixture('multipage-report.pdf'),
    loadFixture('image-only.pdf'),
    loadFixture('large-text.pdf'),
    loadFixture('encrypted.pdf'),
  ]);
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe('extractPdfText', () => {
  it('extracts text from a single-page PDF', async () => {
    const text = await extractPdfText(simpleText);

    expect(text).toBe('Hello ' + 'player ' + 'insights');
  });

  it('accepts a Uint8Array as well as a Buffer', async () => {
    const text = await extractPdfText(new Uint8Array(simpleText));

    expect(text).toBe('Hello ' + 'player ' + 'insights');
  });

  it('does not detach the caller-supplied buffer', async () => {
    // PDF.js transfers the buffer it parses, so the module must copy first. A Node Buffer
    // is backed by a shared pool, so detaching it would corrupt unrelated buffers.
    const bytes = new Uint8Array(simpleText);

    await extractPdfText(bytes);

    expect(bytes.byteLength).toBeGreaterThan(0);
    // Proves the same input is still parseable, i.e. the bytes really did survive.
    await expect(extractPdfText(bytes)).resolves.toBe('Hello ' + 'player ' + 'insights');
  });

  describe('multi-page', () => {
    it('returns text from every page in reading order', async () => {
      const text = await extractPdfText(multipage);

      expect(text).toContain('Q3 ADAPT Retention Review');
      expect(text).toContain('Cohort Detail');
      expect(text).toContain('Recommendations');

      const headings = ['Q3 ADAPT Retention Review', 'Cohort Detail', 'Recommendations'].map((heading) =>
        text.indexOf(heading)
      );
      expect(headings).toEqual([...headings].sort((a, b) => a - b));
    });

    it('preserves body copy that only appears on later pages', async () => {
      const text = await extractPdfText(multipage);

      expect(text).toContain('19.6 percent, versus 29.9 percent for organic installs.');
      expect(text).toContain('Re-run the evaluation suite after the October model update.');
    });
  });

  describe('output length cap', () => {
    it('truncates to MAX_PDF_TEXT_CHARS by default', async () => {
      const text = await extractPdfText(largeText);

      expect(text).toHaveLength(MAX_PDF_TEXT_CHARS);
    });

    it('honours an explicit maxChars', async () => {
      const text = await extractPdfText(largeText, { maxChars: 500 });

      expect(text).toHaveLength(500);
      expect(text).toContain('Retention telemetry row');
    });

    it('leaves output below the cap untouched', async () => {
      const text = await extractPdfText(multipage);

      expect(text.length).toBeLessThan(MAX_PDF_TEXT_CHARS);
      expect(text.endsWith('update.')).toBe(true);
    });
  });

  describe('image-only PDFs', () => {
    it('throws a no-text error when there is no text layer', async () => {
      await expect(extractPdfText(imageOnly)).rejects.toThrow(PdfTextError);
      await expect(extractPdfText(imageOnly)).rejects.toMatchObject({ code: 'no-text' });
    });

    it('explains that scanned PDFs are unsupported', async () => {
      const error = await extractPdfText(imageOnly).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PdfTextError);
      expect((error as PdfTextError).message).toMatch(/No readable text/i);
    });
  });

  describe('invalid input', () => {
    it('throws a corrupt error for random bytes', async () => {
      const garbage = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 7 + 13) % 256));

      await expect(extractPdfText(garbage)).rejects.toMatchObject({
        name: 'PdfTextError',
        code: 'corrupt',
      });
    });

    it('throws a corrupt error for a non-PDF text file', async () => {
      await expect(extractPdfText(Buffer.from('this is not a pdf at all\n', 'utf8'))).rejects.toMatchObject({
        code: 'corrupt',
      });
    });

    it('throws a corrupt error for a truncated PDF', async () => {
      await expect(extractPdfText(multipage.subarray(0, 600))).rejects.toMatchObject({ code: 'corrupt' });
    });

    it('throws an empty error for a zero-length buffer', async () => {
      await expect(extractPdfText(Buffer.alloc(0))).rejects.toMatchObject({ code: 'empty' });
    });

    it('refuses more than 8 MB before creating or transferring a worker buffer', async () => {
      await expect(extractPdfText(Buffer.alloc(MAX_PDF_BYTES + 1))).rejects.toMatchObject({
        code: 'too-large',
        message: 'Choose a non-empty report no larger than 8 MB.',
      });
    });
  });

  describe('encrypted PDFs', () => {
    it('throws an encrypted error rather than crashing', async () => {
      await expect(extractPdfText(encrypted)).rejects.toMatchObject({
        name: 'PdfTextError',
        code: 'encrypted',
      });
    });

    it('tells the user to remove the password', async () => {
      const error = await extractPdfText(encrypted).catch((e: unknown) => e);

      expect((error as PdfTextError).message).toMatch(/password/i);
    });
  });

  describe('timeout', () => {
    it('rejects with a timeout error when the budget is exhausted', async () => {
      await expect(extractPdfText(largeText, { timeoutMs: 1 })).rejects.toMatchObject({ code: 'timeout' });
    });

    it('completes well inside the default budget', async () => {
      const start = performance.now();
      await extractPdfText(largeText);

      expect(performance.now() - start).toBeLessThan(5_000);
    });
  });

  it('preserves the underlying PDF.js failure as the error cause', async () => {
    const error = await extractPdfText(encrypted).catch((e: unknown) => e);

    expect((error as PdfTextError).cause).toBeInstanceOf(Error);
  });
});

describe('bounded PDF worker pool', () => {
  function pool(options: { maxConcurrent?: number; maxQueued?: number } = {}) {
    const created = new PdfExtractionPool({ workerUrl: testWorkerUrl, ...options });
    pools.push(created);
    return created;
  }

  it('caps active workers, bounds the queue, and rejects overload immediately', async () => {
    const workers = pool({ maxConcurrent: 1, maxQueued: 1 });
    const activeAbort = new AbortController();
    const queuedAbort = new AbortController();
    const active = workers.extract(Buffer.from('hang'), { signal: activeAbort.signal });
    const queued = workers.extract(Buffer.from('delay:100:queued'), { signal: queuedAbort.signal });

    await vi.waitFor(() => expect(workers.snapshot()).toEqual({ active: 1, queued: 1 }));
    const started = performance.now();
    await expect(workers.extract(Buffer.from('third'))).rejects.toMatchObject({ code: 'overloaded' });
    expect(performance.now() - started).toBeLessThan(100);

    activeAbort.abort();
    queuedAbort.abort();
    await Promise.allSettled([active, queued]);
    await vi.waitFor(() => expect(workers.snapshot()).toEqual({ active: 0, queued: 0 }));
  });

  it('removes queued work as soon as its request is cancelled', async () => {
    const workers = pool({ maxConcurrent: 1, maxQueued: 1 });
    const activeAbort = new AbortController();
    const queuedAbort = new AbortController();
    const active = workers.extract(Buffer.from('hang'), { signal: activeAbort.signal });
    const queued = workers.extract(Buffer.from('delay:0:must-not-run'), { signal: queuedAbort.signal });

    await vi.waitFor(() => expect(workers.snapshot()).toEqual({ active: 1, queued: 1 }));
    queuedAbort.abort();
    await expect(queued).rejects.toMatchObject({ code: 'cancelled' });
    expect(workers.snapshot()).toEqual({ active: 1, queued: 0 });

    activeAbort.abort();
    await expect(active).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('hard-terminates a timed-out worker and releases its slot', async () => {
    const workers = pool({ maxConcurrent: 1, maxQueued: 1 });

    await expect(workers.extract(Buffer.from('hang'), { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(workers.snapshot()).toEqual({ active: 0, queued: 0 });
    await expect(workers.extract(Buffer.from('echo:0:slot-reused'))).resolves.toBe('slot-reused');
  });

  it('hard-terminates an active worker when its request is cancelled', async () => {
    const workers = pool({ maxConcurrent: 1 });
    const controller = new AbortController();
    const extraction = workers.extract(Buffer.from('hang'), { signal: controller.signal });

    await vi.waitFor(() => expect(workers.snapshot().active).toBe(1));
    controller.abort();
    await expect(extraction).rejects.toMatchObject({ code: 'cancelled' });
    expect(workers.snapshot()).toEqual({ active: 0, queued: 0 });
  });

  it('clamps worker output again before resolving it in the server', async () => {
    const workers = pool();

    await expect(workers.extract(Buffer.from('oversize'), { maxChars: 321 })).resolves.toHaveLength(321);
  });

  it('leaves no tracked workers or queued uploads after close', async () => {
    const baselinePorts = process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length;
    const workers = pool({ maxConcurrent: 1, maxQueued: 1 });
    const first = workers.extract(Buffer.from('hang'));
    const second = workers.extract(Buffer.from('hang'));
    const settled = Promise.allSettled([first, second]);

    await vi.waitFor(() => expect(workers.snapshot()).toEqual({ active: 1, queued: 1 }));
    await workers.close();
    await settled;
    expect(workers.snapshot()).toEqual({ active: 0, queued: 0 });
    await vi.waitFor(() => {
      const openPorts = process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length;
      expect(openPorts).toBeLessThanOrEqual(baselinePorts);
    });
  });
});

describe('lazy dependency graph', () => {
  it('keeps unpdf out of the ordinary server module and only imports it inside the worker', async () => {
    const [serverModule, workerModule] = await Promise.all([
      readFile(new URL('./pdf-text.ts', import.meta.url), 'utf8'),
      readFile(new URL('./pdf-text-worker.mjs', import.meta.url), 'utf8'),
    ]);

    expect(serverModule).not.toMatch(/(?:from\s+['"]unpdf['"]|import\(\s*['"]unpdf['"]\s*\))/);
    expect(workerModule).toContain("await import('unpdf')");
  });
});

describe('isPdfFilename', () => {
  it.each(['report.pdf', 'REPORT.PDF', 'q3.retention.Pdf', 'a b c.pdf'])('accepts %s', (name) => {
    expect(isPdfFilename(name)).toBe(true);
  });

  it.each(['notes.md', 'data.json', 'rows.csv', 'plain.txt', 'deck.pptx', 'doc.docx', 'pdf', 'noext'])(
    'rejects %s',
    (name) => {
      expect(isPdfFilename(name)).toBe(false);
    }
  );
});

describe('isPdfMimeType', () => {
  it.each(['application/pdf', 'application/x-pdf', 'APPLICATION/PDF', 'application/pdf; charset=binary'])(
    'accepts %s',
    (mime) => {
      expect(isPdfMimeType(mime)).toBe(true);
    }
  );

  it.each(['text/plain', 'application/json', 'text/csv', 'application/octet-stream', ''])('rejects %s', (mime) => {
    expect(isPdfMimeType(mime)).toBe(false);
  });
});
