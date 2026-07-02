#!/usr/bin/env node
/**
 * verify_content.mjs — Content-level PDF verification for makebook smoke tests.
 *
 * Uses pdftotext (poppler-utils) to extract text from each sheet page and
 * compares it against the expected content computed from the booklet algorithm.
 *
 * Usage:
 *   node verify_content.mjs <output.pdf> <sourcePageCount> [--reverse] [--split=odd|even]
 *
 * Exit 0 on pass, non-zero on failure.
 */

import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg) {
  process.stderr.write(`verify_content: ${msg}\n`);
  process.exit(2);
}

function getPageCount(pdfPath) {
  try {
    const out = execSync(`pdfinfo "${pdfPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function getPageText(pdfPath, pageNum) {
  // -layout preserves spatial positioning so left/right text is separated
  const out = execSync(`pdftotext -f ${pageNum} -l ${pageNum} -layout "${pdfPath}" -`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out.trim();
}

// ---------------------------------------------------------------------------
// Booklet algorithm (mirrors src/lib/pairing.ts → computePairs)
// ---------------------------------------------------------------------------

/**
 * Returns page pairs: [(0, n-1), (1, n-2), ...].
 * Page count is rounded up to even (consumer pads with blank page).
 */
function computePairs(pageCount) {
  const effective = pageCount % 2 === 0 ? pageCount : pageCount + 1;
  /** @type {Array<[number, number]>} */
  const pairs = [];
  for (let i = 0; i < effective / 2; i++) {
    pairs.push([i, effective - 1 - i]);
  }
  return pairs;
}

/**
 * Given a pair [leftIdx, rightIdx] and its sheetIndex,
 * return the human-readable page numbers on the left and right halves.
 *
 * Layout alternates (mirrors buildSheetPage in converter.ts):
 *   even sheetIndex → higher-indexed page on LEFT
 *   odd  sheetIndex → lower-indexed  page on LEFT
 */
function expectedLayout(pair, sheetIndex) {
  const [leftIdx, rightIdx] = pair;
  if (sheetIndex % 2 === 0) {
    // higher-indexed on left
    return { left: rightIdx + 1, right: leftIdx + 1 };
  }
  // lower-indexed on left
  return { left: leftIdx + 1, right: rightIdx + 1 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    die('usage: verify_content.mjs <pdf> <pageCount> [--reverse] [--split=odd|even]');
  }

  const pdfPath = args[0];
  const sourcePageCount = Number(args[1]);
  const flags = args.slice(2);

  const reverse = flags.includes('--reverse');
  const splitFlag = flags.find((f) => f.startsWith('--split='));
  const splitPart = splitFlag ? splitFlag.split('=')[1] : null;

  // Compute expectation
  const pairs = computePairs(sourcePageCount);
  /** @type {{ left: number; right: number; sheetIndex: number; pair: [number, number] }[]} */
  let sheets = pairs.map((pair, i) => ({
    ...expectedLayout(pair, i),
    sheetIndex: i,
    pair,
  }));

  // Filter for split mode
  if (splitPart === 'odd') {
    sheets = sheets.filter((s) => s.sheetIndex % 2 === 0);
  } else if (splitPart === 'even') {
    sheets = sheets.filter((s) => s.sheetIndex % 2 === 1);
  }

  // Reverse sheet order
  if (reverse) {
    sheets.reverse();
  }

  const actualPageCount = getPageCount(pdfPath);
  if (actualPageCount !== sheets.length) {
    process.stderr.write(
      `Page count mismatch: expected ${sheets.length}, got ${actualPageCount}\n`
    );
    process.exit(1);
  }

  let allOk = true;
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const pageNum = i + 1;
    const text = getPageText(pdfPath, pageNum);

    // The source PDF pages contain text "Page N" at a consistent position.
    // In the output sheet, left text appears before right text (left-to-right reading).
    // pdftotext -layout separates them with whitespace.
    const leftLabel = `Page ${sheet.left}`;
    const rightLabel = `Page ${sheet.right}`;

    // Handle padded blank page (has no "Page N" text)
    // The padded page is always the last index (sourcePageCount, 0-indexed).
    // When the padded page appears in a pair, one side will have no text.
    const isPadded = sourcePageCount % 2 === 1;

    let ok = true;
    // Left check: skip if it's the padded blank page
    if (!(isPadded && sheet.pair[sheet.sheetIndex % 2 === 0 ? 1 : 0] >= sourcePageCount)) {
      if (!text.includes(leftLabel)) {
        process.stderr.write(`  Page ${pageNum}: missing "${leftLabel}" on left\n`);
        ok = false;
      }
    }
    // Right check: skip if it's the padded blank page
    if (!(isPadded && sheet.pair[sheet.sheetIndex % 2 === 0 ? 0 : 1] >= sourcePageCount)) {
      if (!text.includes(rightLabel)) {
        process.stderr.write(`  Page ${pageNum}: missing "${rightLabel}" on right\n`);
        ok = false;
      }
    }

    if (ok) {
      process.stderr.write(`  Page ${pageNum}: OK (Page ${sheet.left} + Page ${sheet.right})\n`);
    } else {
      allOk = false;
    }
  }

  if (!allOk) {
    process.exit(1);
  }
  process.exit(0);
}

main();
