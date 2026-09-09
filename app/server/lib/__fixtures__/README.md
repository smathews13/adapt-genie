# PDF fixtures for `server/lib/pdf-text.test.ts`

All five files are tiny (64 KB total) and checked in so the suite needs no network access
and no PDF toolchain.

| Fixture                | What it covers                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| `simple-text.pdf`      | Single page, one line of text, happy path.                           |
| `multipage-report.pdf` | 3 pages with headings and body copy, multi-page ordering.            |
| `large-text.pdf`       | 40 pages / ~123 K characters, exercises the output length cap.       |
| `image-only.pdf`       | Valid PDF with vector shapes and **no text layer**: the scan case.   |
| `encrypted.pdf`        | Standard security handler, non-empty user password: the locked case. |

Every one of them is listed in `mirror/reviewed-binaries.txt` with its sha256. A PDF is
binary, so `check-mirror-leaks.sh` cannot read one and refuses any that is not pinned there.
**Regenerate a fixture and the check will block until someone reads the new bytes and
re-pins them**. That is the point of the hash, not an obstacle to work around.

## Regenerating

`multipage-report.pdf` was rebuilt on 2026-09-08 to remove retired product language from its
body copy. It is a three-page document titled "Q3 ADAPT Retention Review" with retention
percentages in it. The copy uses generic descriptions such as "the strongest title" and
"the weakest" so invented fixture numbers cannot be mistaken for customer data. The
assertions in `pdf-text.test.ts` pin the ADAPT title, later-page copy, and page order.

It was rebuilt **without `pdf-lib`**, because a Databricks laptop cannot reach
`registry.npmjs.org` to install it. The script below needs no dependencies and writes the
PDF objects directly, the same way `make-encrypted.mjs` further down does. Prefer it if you
only need to change body copy; reach for the `pdf-lib` script if you need to change what a
fixture structurally _is_.

```js
// make-multipage.mjs, run with `node make-multipage.mjs <output.pdf>`.
import { writeFile } from 'node:fs/promises';

const pages = [
  {
    heading: 'Q3 ADAPT Retention Review',
    lines: [
      'Prepared for the ADAPT working group.',
      'Day-30 retention across the sample titles averaged 24.8 percent in Q3,',
      'up 2.1 points from Q2. The strongest title reached 31.4 percent.',
      'The weakest trailed the sample at 18.2 percent.',
    ],
  },
  {
    heading: 'Cohort Detail',
    lines: [
      'New-player cohorts acquired through paid social retained at',
      '19.6 percent, versus 29.9 percent for organic installs.',
      'Cross-label blocked sessions represented 1.2 percent of rows',
      'and were excluded from the gold aggregates.',
    ],
  },
  {
    heading: 'Recommendations',
    lines: [
      'Shift 15 percent of paid social spend toward organic channels.',
      'Instrument session-duration nulls in silver_gameplay_activity.',
      'Re-run the evaluation suite after the October model update.',
    ],
  },
];

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function contentFor(spec) {
  let s = `BT /F2 18 Tf 64 700 Td (${esc(spec.heading)}) Tj ET\n`;
  spec.lines.forEach((line, i) => {
    s += `BT /F1 11 Tf 64 ${660 - i * 22} Td (${esc(line)}) Tj ET\n`;
  });
  return s;
}

// 1 catalog, 2 pages, 3..5 pages, 6..8 contents, 9 F1, 10 F2, 11 info.
const objects = [];
objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objects[2] = `<< /Type /Pages /Kids [${[3, 4, 5].map((n) => `${n} 0 R`).join(' ')}] /Count 3 >>`;
pages.forEach((spec, i) => {
  objects[3 + i] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${6 + i} 0 R ` +
    '/Resources << /Font << /F1 9 0 R /F2 10 0 R >> >> >>';
  const body = contentFor(spec);
  objects[6 + i] = `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}endstream`;
});
objects[9] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
objects[10] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
objects[11] = '<< /Title (Q3 ADAPT Retention Review) >>';

let pdf = '%PDF-1.4\n';
const offsets = [];
for (let n = 1; n <= 11; n += 1) {
  offsets[n] = pdf.length;
  pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
}
const xrefStart = pdf.length;
pdf += 'xref\n0 12\n0000000000 65535 f \n';
for (let n = 1; n <= 11; n += 1) {
  pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size 12 /Root 1 0 R /Info 11 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

await writeFile(process.argv[2], Buffer.from(pdf, 'latin1'));
```

The other four were produced with [`pdf-lib`](https://github.com/Hopding/pdf-lib), which is
deliberately **not** a dependency of this app, install it in a scratch directory instead:

```bash
mkdir /tmp/pdf-fixtures && cd /tmp/pdf-fixtures && npm install pdf-lib
```

```js
// make-fixtures.mjs, run with `node make-fixtures.mjs`, then copy the output PDFs here.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';

await mkdir('fixtures', { recursive: true });

// multipage-report.pdf is NOT built here any more, see make-multipage.mjs above.
// The version that was built here carried the body copy this fixture was rewritten
// to remove, so keeping it would have put those lines back into a tracked file.

// 1. Single-page, simple text.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Hello ' + 'player ' + 'insights', { x: 64, y: 700, size: 14, font });
  await writeFile('fixtures/simple-text.pdf', await doc.save());
}

// 2. Image-only PDF: valid PDF, drawable content, zero text operators.
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 100, y: 400, width: 300, height: 200, color: rgb(0.2, 0.4, 0.8) });
  page.drawCircle({ x: 300, y: 250, size: 80, color: rgb(0.9, 0.3, 0.1) });
  await writeFile('fixtures/image-only.pdf', await doc.save());
}

// 3. Large PDF to exercise the output length cap.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const filler = 'Retention telemetry row with player cohort and session duration metrics for audit.';
  for (let p = 0; p < 40; p += 1) {
    const page = doc.addPage([612, 792]);
    for (let i = 0; i < 34; i += 1) {
      page.drawText(`p${p} L${i} ${filler}`, { x: 24, y: 760 - i * 22, size: 9, font });
    }
  }
  await writeFile('fixtures/large-text.pdf', await doc.save());
}

console.log('fixtures written');
```

`encrypted.pdf` is assembled by hand because `pdf-lib` cannot write encrypted documents. It
only needs syntactically valid `/Encrypt` metadata; PDF.js raises `PasswordException`
from the trailer before it ever tries to decrypt, so the hashes below are arbitrary.

```js
// make-encrypted.mjs: no dependencies, run with `node make-encrypted.mjs`.
import { writeFile } from 'node:fs/promises';

const objects = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>\nendobj\n',
  '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (secret) Tj ET\nendstream\nendobj\n',
  '5 0 obj\n<< /Filter /Standard /V 4 /R 4 /Length 128 /P -1340 ' +
    '/O <2A45B1C7E9034F5D6182A3B4C5D6E7F8192A3B4C5D6E7F8091A2B3C4D5E6F708> ' +
    '/U <9F8E7D6C5B4A39281706F5E4D3C2B1A0FFEEDDCCBBAA99887766554433221100> ' +
    '/CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> ' +
    '/StmF /StdCF /StrF /StdCF >>\nendobj\n',
];

let pdf = '%PDF-1.6\n';
const offsets = [];
for (const obj of objects) {
  offsets.push(pdf.length);
  pdf += obj;
}

const xrefStart = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (const off of offsets) {
  pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
}
pdf +=
  `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 5 0 R ` +
  `/ID [<0123456789ABCDEF0123456789ABCDEF> <FEDCBA9876543210FEDCBA9876543210>] >>\n`;
pdf += `startxref\n${xrefStart}\n%%EOF\n`;

await writeFile('fixtures/encrypted.pdf', Buffer.from(pdf, 'latin1'));
```
