import { PDFDocument, rgb } from 'pdf-lib';
import { computePairs } from './pairing';
import fs from 'fs/promises';
import path from 'path';

export type ConvertOptions = {
  dryRun?: boolean;
  /** If true, generate separate odd-sheet and even-sheet PDFs for manual duplex printing. */
  split?: boolean;
  /** Page order: 'normal' (default) or 'reverse' (for printers that deposit face-up). */
  pageOrder?: 'normal' | 'reverse';
};

interface SheetDimensions {
  baseWidth: number;
  baseHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  halfAvailableWidth: number;
}

interface SheetSpec {
  leftIdx: number;
  rightIdx: number;
  sheetIndex: number;
}

/**
 * Build a single booklet sheet page (2-up) and append it to `outDoc`.
 * The layout alternates per original sheetIndex to support duplex printing:
 * even-indexed sheets place the higher-indexed page on the left,
 * odd-indexed sheets reverse the placement.
 */
async function buildSheetPage(
  srcDoc: PDFDocument,
  outDoc: PDFDocument,
  spec: SheetSpec,
  dim: SheetDimensions
): Promise<void> {
  const [embLeft, embRight] = await outDoc.embedPdf(srcDoc, [spec.leftIdx, spec.rightIdx]);

  const outPage = outDoc.addPage([dim.sheetWidth, dim.sheetHeight]);

  const scaleAndPosition = (emb: any, placeOnLeft: boolean) => {
    const pw = emb.width ?? dim.baseWidth;
    const ph = emb.height ?? dim.baseHeight;
    const scale = Math.min(dim.halfAvailableWidth / pw, dim.sheetHeight / ph);
    const drawWidth = pw * scale;
    const drawHeight = ph * scale;
    const y = (dim.sheetHeight - drawHeight) / 2;
    const x = placeOnLeft ? 0 : dim.sheetWidth - drawWidth;
    return { x, y, width: drawWidth, height: drawHeight };
  };

  // Alternate layout based on original sheet index for duplex printing
  if (spec.sheetIndex % 2 === 0) {
    // higher-indexed page on the left
    const leftParams = scaleAndPosition(embRight, true);
    outPage.drawPage(embRight, leftParams);
    const rightParams = scaleAndPosition(embLeft, false);
    outPage.drawPage(embLeft, rightParams);
  } else {
    // reversed: lower-indexed page on the left
    const leftParams = scaleAndPosition(embLeft, true);
    outPage.drawPage(embLeft, leftParams);
    const rightParams = scaleAndPosition(embRight, false);
    outPage.drawPage(embRight, rightParams);
  }

  // Draw center cut line
  const centerX = dim.sheetWidth / 2;
  try {
    outPage.drawRectangle({
      x: centerX - 0.5,
      y: 0,
      width: 1,
      height: dim.sheetHeight,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.5,
    });
  } catch (_e) {
    // ignore
  }
}

/**
 * Derive output file paths for split mode.
 *
 * Examples for outputPath "booklet.pdf":
 *   normal:  odd-booklet.pdf, even-booklet.pdf
 *   reverse: odd-booklet-reverse.pdf, even-booklet-reverse.pdf
 */
function splitOutputPaths(
  outputPath: string,
  reverse: boolean
): { oddPath: string; evenPath: string } {
  const dir = path.dirname(outputPath);
  const ext = path.extname(outputPath) || '.pdf';
  const base = path.basename(outputPath, ext);
  const suffix = reverse ? '-reverse' : '';
  return {
    oddPath: path.join(dir, `odd-${base}${suffix}${ext}`),
    evenPath: path.join(dir, `even-${base}${suffix}${ext}`),
  };
}

/**
 * convertPdfToBooklet
 * - loads the input PDF
 * - pads pages to an even count (required for booklet pairing)
 * - generates a 2-up booklet PDF (two original pages per sheet)
 * - writes output PDF (or two PDFs when split mode is enabled)
 */
export async function convertPdfToBooklet(
  inputPath: string,
  outputPath: string,
  opts: ConvertOptions = {}
) {
  const split = opts.split ?? false;
  const pageOrder = opts.pageOrder ?? 'normal';
  const reverse = pageOrder === 'reverse';

  const inputBytes = await fs.readFile(inputPath);
  const srcDoc = await PDFDocument.load(inputBytes);

  // Ensure an even number of pages so pages can be paired (1,last), (2,last-1), ...
  let pageCount = srcDoc.getPageCount();
  const pad = pageCount % 2 === 0 ? 0 : 1;
  if (pad === 1) {
    // add a blank page with same size as first page (or A4 fallback)
    let bw = 595.28;
    let bh = 841.89;
    if (pageCount > 0) {
      const p0 = srcDoc.getPage(0);
      try {
        bw = p0.getWidth();
        bh = p0.getHeight();
      } catch (_e) {
        // ignore
      }
    }
    const blankPage = srcDoc.addPage([bw, bh]);
    try {
      blankPage.drawRectangle({ x: 0, y: 0, width: 1, height: 1, color: rgb(1, 1, 1), opacity: 0 });
    } catch (_e) {
      // ignore
    }
    pageCount += 1;
  }

  // Determine base page size from first page (fallback to A4 if not available)
  let baseWidth = 595.28; // ~A4 width in points (portrait)
  let baseHeight = 841.89; // ~A4 height in points (portrait)
  if (pageCount > 0) {
    const p = srcDoc.getPage(0);
    try {
      baseWidth = p.getWidth();
      baseHeight = p.getHeight();
    } catch (_e) {
      // ignore and use defaults
    }
  }

  // Output page will place two original pages side-by-side on one sheet.
  const sheetWidth = baseWidth * 2;
  const sheetHeight = baseHeight;
  const gutter = 72; // points (~25.4mm) center spine gutter
  const halfAvailableWidth = (sheetWidth - gutter) / 2;

  const dim: SheetDimensions = {
    baseWidth,
    baseHeight,
    sheetWidth,
    sheetHeight,
    halfAvailableWidth,
  };

  // Compute page pairs: (0, pageCount-1), (1, pageCount-2), ...
  const pairsArr = computePairs(pageCount);

  // Collect all sheet specs with their original sheet index
  const allSheets: SheetSpec[] = pairsArr.map(([leftIdx, rightIdx], i) => ({
    leftIdx,
    rightIdx,
    sheetIndex: i,
  }));

  if (split) {
    // Split into odd-sheet and even-sheet groups based on original sheet index
    const oddSheets = allSheets.filter((s) => s.sheetIndex % 2 === 0);
    const evenSheets = allSheets.filter((s) => s.sheetIndex % 2 === 1);

    if (reverse) {
      oddSheets.reverse();
      evenSheets.reverse();
    }

    const oddDoc = await PDFDocument.create();
    for (const s of oddSheets) {
      await buildSheetPage(srcDoc, oddDoc, s, dim);
    }

    const evenDoc = await PDFDocument.create();
    for (const s of evenSheets) {
      await buildSheetPage(srcDoc, evenDoc, s, dim);
    }

    if (opts.dryRun) return;

    const { oddPath, evenPath } = splitOutputPaths(outputPath, reverse);
    await fs.writeFile(oddPath, await oddDoc.save());
    console.log(`Wrote odd sheets: ${oddPath} (${oddDoc.getPageCount()} sheets)`);

    const hasEvenSheets = evenSheets.length > 0;
    if (hasEvenSheets) {
      await fs.writeFile(evenPath, await evenDoc.save());
      console.log(`Wrote even sheets: ${evenPath} (${evenDoc.getPageCount()} sheets)`);
    }

    // Print user guidance
    console.log('');
    console.log('Duplex printing instructions:');
    console.log(`  1. Print ${oddPath} first (front sides).`);
    if (hasEvenSheets) {
      console.log(`  2. Flip the printed paper stack.`);
      console.log(`  3. Print ${evenPath} (back sides).`);
    } else {
      console.log('  (No back sides/even sheets to print for this document)');
    }
  } else {
    // Single document mode (existing behavior)
    const outDoc = await PDFDocument.create();

    const sheets = reverse ? [...allSheets].reverse() : allSheets;

    for (const s of sheets) {
      await buildSheetPage(srcDoc, outDoc, s, dim);
    }

    if (opts.dryRun) return;

    const outBytes = await outDoc.save();
    await fs.writeFile(outputPath, outBytes);
  }
}
