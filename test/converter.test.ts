import { describe, it, expect } from 'vitest';
import { convertPdfToBooklet } from '../src/lib/converter';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Create a simple test PDF with `pageCount` pages numbered 1..N.
 */
async function createTestPdf(pageCount: number, dir: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i + 1}`, {
      x: 200,
      y: 400,
      size: 48,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const filePath = path.join(dir, `test${pageCount}.pdf`);
  await fs.writeFile(filePath, await doc.save());
  return filePath;
}

async function getPageCount(filePath: string): Promise<number> {
  const doc = await PDFDocument.load(await fs.readFile(filePath));
  return doc.getPageCount();
}

describe('convertPdfToBooklet', () => {
  it('exports convertPdfToBooklet', () => {
    expect(typeof convertPdfToBooklet).toBe('function');
  });

  describe('normal (unsplit) mode', () => {
    it('produces correct sheet count (4 pages = 2 sheets)', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(4, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output);
        expect(await getPageCount(output)).toBe(2);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('pads odd page count to produce correct sheet count (3 pages = 2 sheets)', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(3, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output);
        expect(await getPageCount(output)).toBe(2); // padded 3→4 → 2 sheets
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('split mode', () => {
    it('generates odd and even output files with correct sheet counts (8 pages)', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(8, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output, { split: true });
        const oddPath = path.join(dir, 'odd-out.pdf');
        const evenPath = path.join(dir, 'even-out.pdf');
        expect(await getPageCount(oddPath)).toBe(2); // sheets 0, 2
        expect(await getPageCount(evenPath)).toBe(2); // sheets 1, 3
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('dry run does not write output files', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(4, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output, { split: true, dryRun: true });
        await expect(fs.access(path.join(dir, 'odd-out.pdf'))).rejects.toThrow();
        await expect(fs.access(path.join(dir, 'even-out.pdf'))).rejects.toThrow();
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('reverse page order', () => {
    it('produces correct sheet count in reverse mode (non-split)', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(8, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output, { pageOrder: 'reverse' });
        expect(await getPageCount(output)).toBe(4);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('generates split reverse files with correct counts', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(8, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output, { split: true, pageOrder: 'reverse' });
        const oddPath = path.join(dir, 'odd-out-reverse.pdf');
        const evenPath = path.join(dir, 'even-out-reverse.pdf');
        expect(await getPageCount(oddPath)).toBe(2);
        expect(await getPageCount(evenPath)).toBe(2);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('handles minimal case (2 pages) split + reverse without errors', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makebook-test-'));
      try {
        const input = await createTestPdf(2, dir);
        const output = path.join(dir, 'out.pdf');
        await convertPdfToBooklet(input, output, { split: true, pageOrder: 'reverse' });
        const oddPath = path.join(dir, 'odd-out-reverse.pdf');
        const evenPath = path.join(dir, 'even-out-reverse.pdf');
        // 2 pages → 1 sheet → only odd file has content, even file should not be created
        const oddCount = await getPageCount(oddPath);
        expect(oddCount).toBe(1);
        const evenExists = await fs.stat(evenPath).then(() => true, () => false);
        expect(evenExists).toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });
});
