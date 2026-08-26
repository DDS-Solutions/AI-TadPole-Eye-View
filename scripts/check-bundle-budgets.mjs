#!/usr/bin/env node

/**
 * Automated Bundle Size & CI Performance Budget Validator (PLAN.md §10 Phase 2 & ADR-0025)
 * Analyzes production build assets in apps/web/dist, measures gzip sizes, and enforces budget thresholds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distAssetsDir = path.resolve(__dirname, '../apps/web/dist/assets');

// Performance budget thresholds (in KB)
const BUDGETS = {
  // Main application logic chunk
  mainEntryGzipKb: 150,
  // Svelte framework runtime chunk
  frameworkGzipKb: 50,
  // Visualization libraries (uPlot + TanStack Virtual)
  vizGzipKb: 70,
  // Cesium WebGL Engine vendor chunk
  cesiumGzipKb: 3200,
  // Primary CSS bundle
  cssGzipKb: 50,
  // Total overall JS gzip footprint
  totalJsGzipKb: 3600,
};

function formatKb(bytes) {
  return (bytes / 1024).toFixed(2);
}

function runBundleBudgetCheck() {
  console.log('\n📦 GEV v2 Web Bundle Size & Performance Budget Validator');
  console.log('─────────────────────────────────────────────────────────────────────────────');

  if (!fs.existsSync(distAssetsDir)) {
    console.error(
      `[ERROR] Assets directory not found at ${distAssetsDir}. Run "pnpm --filter @gev/web build" first.`
    );
    process.exit(1);
  }

  const files = fs.readdirSync(distAssetsDir);
  let totalRawBytes = 0;
  let totalGzipBytes = 0;
  let totalJsGzipBytes = 0;
  let totalCssGzipBytes = 0;
  let hasBreach = false;

  const results = [];

  for (const file of files) {
    const filePath = path.join(distAssetsDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const rawBytes = stat.size;
    const content = fs.readFileSync(filePath);
    const gzipBytes = zlib.gzipSync(content).length;

    totalRawBytes += rawBytes;
    totalGzipBytes += gzipBytes;

    const ext = path.extname(file);
    let budgetKb = null;
    let category = 'Asset';

    if (file.endsWith('.css')) {
      category = 'CSS Stylesheet';
      budgetKb = BUDGETS.cssGzipKb;
      totalCssGzipBytes += gzipBytes;
    } else if (file.startsWith('vendor-cesium') && file.endsWith('.js')) {
      category = 'Cesium Engine Vendor';
      budgetKb = BUDGETS.cesiumGzipKb;
      totalJsGzipBytes += gzipBytes;
    } else if (file.startsWith('vendor-framework') && file.endsWith('.js')) {
      category = 'Svelte Runtime Vendor';
      budgetKb = BUDGETS.frameworkGzipKb;
      totalJsGzipBytes += gzipBytes;
    } else if (file.startsWith('vendor-viz') && file.endsWith('.js')) {
      category = 'Viz Vendor (uPlot/Virtual)';
      budgetKb = BUDGETS.vizGzipKb;
      totalJsGzipBytes += gzipBytes;
    } else if (file.startsWith('index') && file.endsWith('.js')) {
      category = 'App Entry JS';
      budgetKb = BUDGETS.mainEntryGzipKb;
      totalJsGzipBytes += gzipBytes;
    } else if (file.endsWith('.js')) {
      category = 'App Chunk JS';
      budgetKb = 100;
      totalJsGzipBytes += gzipBytes;
    }

    const gzipKb = gzipBytes / 1024;
    const passed = budgetKb === null || gzipKb <= budgetKb;
    if (!passed) hasBreach = true;

    results.push({
      file,
      category,
      rawKb: formatKb(rawBytes),
      gzipKb: formatKb(gzipBytes),
      budgetKb: budgetKb ? `${budgetKb} KB` : 'N/A',
      status: passed ? '✔ PASS' : '✖ BREACH',
    });
  }

  // Print asset table
  console.log(
    ` ${'File'.padEnd(35)} | ${'Category'.padEnd(24)} | ${'Raw (KB)'.padStart(9)} | ${'Gzip (KB)'.padStart(10)} | ${'Budget'.padStart(8)} | ${'Status'}`
  );
  console.log('─────────────────────────────────────────────────────────────────────────────');

  for (const r of results) {
    console.log(
      ` ${r.file.padEnd(35)} | ${r.category.padEnd(24)} | ${r.rawKb.padStart(9)} | ${r.gzipKb.padStart(10)} | ${r.budgetKb.padStart(8)} | ${r.status}`
    );
  }

  console.log('─────────────────────────────────────────────────────────────────────────────');
  const totalJsGzipKb = totalJsGzipBytes / 1024;
  const totalPassed = totalJsGzipKb <= BUDGETS.totalJsGzipKb;
  if (!totalPassed) hasBreach = true;

  console.log(
    ` Total JS Gzip: ${formatKb(totalJsGzipBytes)} KB (Budget: <= ${BUDGETS.totalJsGzipKb} KB) -> ${totalPassed ? '✔ PASS' : '✖ BREACH'}`
  );
  console.log(` Total CSS Gzip: ${formatKb(totalCssGzipBytes)} KB`);
  console.log(` Total Bundle Footprint (Gzip): ${formatKb(totalGzipBytes)} KB`);
  console.log('─────────────────────────────────────────────────────────────────────────────\n');

  if (hasBreach) {
    console.error(
      '❌ CI Performance Budget Check FAILED: One or more chunks breached deterministic size limits.\n'
    );
    process.exit(1);
  } else {
    console.log(
      '✅ CI Performance Budget Check PASSED: All chunks within strict deterministic limits.\n'
    );
    process.exit(0);
  }
}

runBundleBudgetCheck();
