#!/usr/bin/env node
import { Command } from 'commander';
import { convertPdfToBooklet } from './lib/converter';
import { version } from '../package.json';

const program = new Command();

program
  .name('makebook')
  .description('Convert a PDF into a booklet-printable PDF (2-up, fixed pairing)')
  .version(version)
  .argument('<input>', 'input PDF file')
  .option('-o, --output <file>', 'output PDF file', 'booklet.pdf')
  .option('--dry-run', 'do not write output file')
  .option(
    '--split',
    'generate separate odd-sheet and even-sheet PDFs for manual duplex printing'
  )
  .option(
    '--page-order <order>',
    'page order: "normal" (default) or "reverse" (for printers that deposit face-up)',
    'normal'
  )
  .action(
    async (
      input: string,
      options: { output: string; dryRun?: boolean; split?: boolean; pageOrder?: string }
    ) => {
      try {
        // Validate pageOrder
        if (options.pageOrder !== 'normal' && options.pageOrder !== 'reverse') {
          console.error(
            `Error: --page-order must be "normal" or "reverse", got "${options.pageOrder}"`
          );
          process.exit(1);
        }

        const pageOrder = options.pageOrder as 'normal' | 'reverse';

        console.log(`Converting: ${input} -> ${options.output}`);
        if (options.split) {
          const suffix = pageOrder === 'reverse' ? ' (reverse order)' : '';
          console.log(`Split mode: generating odd/even sheet PDFs${suffix}`);
        } else if (pageOrder === 'reverse') {
          console.log('Reverse page order enabled');
        }
        console.log(
          'Behavior: places pages as (1,last), (2,last-1), ... on sheets with 2 pages per A4 sheet. No config.'
        );
        if (options.dryRun) {
          console.log('Dry run: no file will be written.');
        }
        await convertPdfToBooklet(input, options.output, {
          dryRun: !!options.dryRun,
          split: !!options.split,
          pageOrder,
        });
        console.log('Done.');
      } catch (err) {
        console.error('Error:', err);
        process.exit(1);
      }
    }
  );

// pnpm and some wrappers may insert a standalone "--" into argv which
// marks the end of options for the wrapper and would prevent commander
// from seeing flags that come after it. Filter out any lone "--" so
// CLI flags like `-o` are parsed normally when using `pnpm run dev -- ...`.
const argv = process.argv.filter((a) => a !== '--');
program.parseAsync(argv);
