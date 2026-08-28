#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { formatAdgReport, runActiveDocumentationGuard } from './lib/adg-core.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

try {
  const report = runActiveDocumentationGuard({ root });
  const output = formatAdgReport(report);

  if (report.ok) {
    console.log(output);
  } else {
    console.error(output);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('[ADG:FATAL]', error);
  process.exitCode = 1;
}
