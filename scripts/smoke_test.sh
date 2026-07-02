#!/usr/bin/env bash
#
# Smoke test for makebook CLI.
# Builds the project, generates test PDFs of various sizes, and runs
# the CLI in every supported mode to verify output page counts,
# file names, dry-run behavior, and input validation.
#
# Usage: ./scripts/smoke_test.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
SCRIPTS_DIR="$(pwd)/scripts"

TMPDIR=$(mktemp -d -t makebook-smoke-XXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0
FAIL_NAMES=()

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
green(){ printf '\033[32m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
echo "==> Building makebook …"
pnpm run build

# ---------------------------------------------------------------------------
# 2. Generate test PDFs (2, 3, 8 pages)
# ---------------------------------------------------------------------------
echo "==> Generating test PDFs …"
mkdir -p "$TMPDIR/pdf"
node --input-type=module -e "
  import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
  import fs from 'node:fs';
  import path from 'node:path';
  const sizes = [2, 3, 8];
  for (const n of sizes) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < n; i++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(\`Page \${i + 1}\`, { x: 200, y: 400, size: 48, font, color: rgb(0, 0, 0) });
    }
    const out = path.join('$TMPDIR/pdf', \`\${n}p.pdf\`);
    fs.writeFileSync(out, await doc.save());
  }
  process.exit(0);
"

MKB="node $(pwd)/dist/index.js"

# Helper: count pages of a PDF
pdf_pages() {
  node --input-type=module -e "
    import { PDFDocument } from 'pdf-lib';
    import fs from 'node:fs';
    const doc = await PDFDocument.load(fs.readFileSync('$1'));
    console.log(doc.getPageCount());
  "
}

# Helper: assert file exists
file_exists() { test -f "$1"; }

# ---------------------------------------------------------------------------
# 3. Validation subroutines – each receives $1=outdir $2=extra_args
# ---------------------------------------------------------------------------

v_normal_2p() {
  local d="$1"
  local sheets
  sheets=$(pdf_pages "$d/booklet.pdf")
  [ "$sheets" = "1" ] || { red "  ❌ 2p normal: expected 1 sheet, got $sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/booklet.pdf" 2 || return 1
}

v_normal_3p() {
  local d="$1"
  local sheets
  sheets=$(pdf_pages "$d/booklet.pdf")
  [ "$sheets" = "2" ] || { red "  ❌ 3p normal: expected 2 sheets (padded), got $sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/booklet.pdf" 3 || return 1
}

v_normal_8p() {
  local d="$1"
  local sheets
  sheets=$(pdf_pages "$d/booklet.pdf")
  [ "$sheets" = "4" ] || { red "  ❌ 8p normal: expected 4 sheets, got $sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/booklet.pdf" 8 || return 1
}

v_split_2p() {
  local d="$1"
  file_exists "$d/odd-booklet.pdf"  || { red "  ❌ 2p split: missing odd-booklet.pdf";  return 1; }
  ! file_exists "$d/even-booklet.pdf" || { red "  ❌ 2p split: even-booklet.pdf should NOT exist"; return 1; }
  local sheets
  sheets=$(pdf_pages "$d/odd-booklet.pdf")
  [ "$sheets" = "1" ] || { red "  ❌ 2p split: odd expected 1 sheet, got $sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/odd-booklet.pdf" 2 --split=odd || return 1
}

v_split_8p() {
  local d="$1"
  file_exists "$d/odd-booklet.pdf"  || { red "  ❌ 8p split: missing odd-booklet.pdf";  return 1; }
  file_exists "$d/even-booklet.pdf" || { red "  ❌ 8p split: missing even-booklet.pdf"; return 1; }
  local odd_sheets even_sheets
  odd_sheets=$(pdf_pages  "$d/odd-booklet.pdf")
  even_sheets=$(pdf_pages "$d/even-booklet.pdf")
  [ "$odd_sheets"  = "2" ] || { red "  ❌ 8p split: odd expected 2 sheets, got $odd_sheets";   return 1; }
  [ "$even_sheets" = "2" ] || { red "  ❌ 8p split: even expected 2 sheets, got $even_sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/odd-booklet.pdf"  8 --split=odd  || return 1
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/even-booklet.pdf" 8 --split=even || return 1
}

v_reverse_8p() {
  local d="$1"
  local sheets
  sheets=$(pdf_pages "$d/booklet.pdf")
  [ "$sheets" = "4" ] || { red "  ❌ 8p reverse: expected 4 sheets, got $sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/booklet.pdf" 8 --reverse || return 1
}

v_split_reverse_8p() {
  local d="$1"
  file_exists "$d/odd-booklet-reverse.pdf"  || { red "  ❌ 8p split+reverse: missing odd-booklet-reverse.pdf";  return 1; }
  file_exists "$d/even-booklet-reverse.pdf" || { red "  ❌ 8p split+reverse: missing even-booklet-reverse.pdf"; return 1; }
  local odd_sheets even_sheets
  odd_sheets=$(pdf_pages  "$d/odd-booklet-reverse.pdf")
  even_sheets=$(pdf_pages "$d/even-booklet-reverse.pdf")
  [ "$odd_sheets"  = "2" ] || { red "  ❌ 8p split+reverse: odd expected 2 sheets, got $odd_sheets";   return 1; }
  [ "$even_sheets" = "2" ] || { red "  ❌ 8p split+reverse: even expected 2 sheets, got $even_sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/odd-booklet-reverse.pdf"  8 --reverse --split=odd  || return 1
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/even-booklet-reverse.pdf" 8 --reverse --split=even || return 1
}

v_split_2p_reverse() {
  local d="$1"
  file_exists "$d/odd-booklet-reverse.pdf"  || { red "  ❌ 2p split+reverse: missing odd-booklet-reverse.pdf";  return 1; }
  ! file_exists "$d/even-booklet-reverse.pdf" || { red "  ❌ 2p split+reverse: even-booklet-reverse should NOT exist"; return 1; }
  local sheets
  sheets=$(pdf_pages "$d/odd-booklet-reverse.pdf")
  [ "$sheets" = "1" ] || { red "  ❌ 2p split+reverse: odd expected 1 sheet, got $sheets"; return 1; }
  node "$SCRIPTS_DIR/verify_content.mjs" "$d/odd-booklet-reverse.pdf" 2 --reverse --split=odd || return 1
}

v_dryrun() {
  local d="$1"
  ! file_exists "$d/booklet.pdf"       || { red "  ❌ dry-run: booklet.pdf should NOT exist";       return 1; }
  ! file_exists "$d/odd-booklet.pdf"   || { red "  ❌ dry-run: odd-booklet.pdf should NOT exist";   return 1; }
  ! file_exists "$d/even-booklet.pdf"  || { red "  ❌ dry-run: even-booklet.pdf should NOT exist";  return 1; }
}

v_illegal_pageorder() {
  return 0
}

# ---------------------------------------------------------------------------
# 4. Test helpers
# ---------------------------------------------------------------------------
check() {
  local desc="$1" input="$2" extra_args="$3" want_exit="$4" validate="$5"
  local input_path="$TMPDIR/pdf/$input"
  local outdir="$TMPDIR/out/$desc"

  mkdir -p "$outdir"

  set +e
  $MKB "$input_path" -o "$outdir/booklet.pdf" $extra_args > "$outdir/stdout.txt" 2>&1
  got_exit=$?
  set -e

  if [ "$got_exit" != "$want_exit" ]; then
    red "  ❌ FAIL [$desc]: expected exit $want_exit, got $got_exit"
    FAIL=$((FAIL + 1))
    FAIL_NAMES+=("$desc")
    return
  fi

  if [ "$want_exit" != "0" ]; then
    green "  ✅ PASS [$desc]"
    PASS=$((PASS + 1))
    return
  fi

  if "$validate" "$outdir" "$extra_args"; then
    green "  ✅ PASS [$desc]"
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_NAMES+=("$desc")
  fi
}

# ---------------------------------------------------------------------------
# 5. Test matrix – covers all modes: normal, split, reverse, split+reverse,
#    dry-run, illegal params. Mirrors manual testing performed during
#    development (2/3/8 page PDFs, all mode combinations).
# ---------------------------------------------------------------------------
echo ""
echo "==> Running smoke tests …"
echo ""

check "normal-2p"              "2p.pdf"  ""                                            0  v_normal_2p
check "normal-3p"              "3p.pdf"  ""                                            0  v_normal_3p
check "normal-8p"              "8p.pdf"  ""                                            0  v_normal_8p
check "split-2p"               "2p.pdf"  "--split"                                     0  v_split_2p
check "split-8p"               "8p.pdf"  "--split"                                     0  v_split_8p
check "reverse-8p"             "8p.pdf"  "--page-order reverse"                        0  v_reverse_8p
check "split-reverse-8p"       "8p.pdf"  "--split --page-order reverse"                0  v_split_reverse_8p
check "split-reverse-2p"       "2p.pdf"  "--split --page-order reverse"                0  v_split_2p_reverse
check "dry-run"                "8p.pdf"  "--dry-run"                                   0  v_dryrun
check "dry-run-split"          "8p.pdf"  "--dry-run --split"                           0  v_dryrun
check "illegal-page-order"     "8p.pdf"  "--page-order WRONG"                          1  v_illegal_pageorder

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  green "All $TOTAL smoke tests passed! ✅"
else
  red "$FAIL/$TOTAL smoke tests FAILED ❌"
  for name in "${FAIL_NAMES[@]}"; do
    red "   - $name"
  done
  exit 1
fi
