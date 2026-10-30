#!/usr/bin/env node
/**
 * Render the Round 1 submission PDFs from their HTML sources.
 *
 * Round 1 requires a technical abstract of at most 5 pages and a links sheet.
 * Both are authored as print-first HTML (A4 page box, print colours) so the
 * PDFs are reproducible from the repository instead of being hand-exported.
 *
 * Usage: node scripts/build_submission_pdfs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs', 'submission');

const JOBS = [
  { html: 'abstract.html', pdf: 'Technical_Abstract.pdf', maxPages: 5 },
  { html: 'links.html', pdf: 'Additional_Links_and_Prototypes.pdf', maxPages: 3 },
];

const browser = await chromium.launch();
let failed = false;
try {
  for (const job of JOBS) {
    const page = await browser.newPage();
    const source = path.join(DOCS, job.html);
    await page.goto(`file://${source}`, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    const target = path.join(DOCS, job.pdf);
    await page.pdf({ path: target, printBackground: true, preferCSSPageSize: true });
    const bytes = fs.readFileSync(target);
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    const ok = pages > 0 && pages <= job.maxPages;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${job.pdf}  ${pages} page(s) (limit ${job.maxPages})  ${(bytes.length / 1024).toFixed(0)} KB`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
