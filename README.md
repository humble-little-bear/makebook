# makebook

A CLI tool to convert a regular PDF into a booklet-printable PDF. Rearranges pages into 2-up layout with proper pairing for booklet printing, then folding and stapling into signatures.

## Features

- 2-up booklet imposition: pairs pages as (1,last), (2,last-1), ... on landscape sheets
- Automatic padding: odd-page-count PDFs get a blank page appended
- Split mode: generate separate odd-sheet and even-sheet PDFs for manual duplex (double-sided) printing
- Reverse page order: output in reverse order for printers that deposit face-up
- Dry-run mode: validate without writing output files

## Quick start

1. Install dependencies (pnpm is recommended):

```bash
pnpm install
```

2. Build:

```bash
pnpm run build
```

3. Run (dev mode):

```bash
pnpm run dev -- input.pdf -o output.pdf
```

## Usage

```
makebook [options] <input>
```

### Options

| Option                 | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `-o, --output <file>`  | Output PDF file (default: `booklet.pdf`)                                        |
| `--dry-run`            | Validate without writing output files                                           |
| `--split`              | Generate separate odd-sheet and even-sheet PDFs for manual duplex printing      |
| `--page-order <order>` | Page order: `normal` (default) or `reverse` (for printers that deposit face-up) |

### Examples

Basic booklet conversion:

```bash
makebook input.pdf -o booklet.pdf
```

Split mode (for manual duplex printing):

```bash
makebook input.pdf --split -o booklet.pdf
# Output: odd-booklet.pdf (front sides), even-booklet.pdf (back sides)
```

Split + reverse (for face-up printers):

```bash
makebook input.pdf --split --page-order reverse -o booklet.pdf
# Output: odd-booklet-reverse.pdf, even-booklet-reverse.pdf
```

Reverse only (single file in reverse order):

```bash
makebook input.pdf --page-order reverse -o booklet.pdf
```

Dry run (no files written):

```bash
makebook input.pdf --split --dry-run
```
