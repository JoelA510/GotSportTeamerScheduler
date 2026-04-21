#!/usr/bin/env node
/**
 * Wave 6a Task 1: bundle-size CI gate.
 *
 * Walks `dist/assets/`, gzips each file in memory, compares against
 * `config/bundle-budget.json`. Exits non-zero on any rule violation.
 *
 * Usage:
 *   node scripts/check-bundle-size.js                  # run with default paths
 *   node scripts/check-bundle-size.js --dist=./other   # custom dist
 *   node scripts/check-bundle-size.js --budget=./b.json
 *
 * Output: machine-parseable summary (one rule per line) + per-violation detail.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function parseArgs(argv) {
  const out = { dist: 'dist', budget: 'config/bundle-budget.json' };
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, '').split('=');
    if (k && v) out[k] = v;
  }
  return out;
}

function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, base, acc);
    else acc.push({ path: relative(base, full).replace(/\\/g, '/'), full, size: stat.size });
  }
  return acc;
}

function gzipBytes(filePath) {
  return gzipSync(readFileSync(filePath)).length;
}

function fmt(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

function main() {
  const args = parseArgs(process.argv);
  const distRoot = join(REPO_ROOT, args.dist, 'assets');
  const budgetPath = join(REPO_ROOT, args.budget);

  let budget;
  try {
    budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
  } catch (err) {
    console.error(`[check-bundle-size] FAIL: cannot read budget at ${budgetPath}: ${err.message}`);
    process.exit(2);
  }

  let files;
  try {
    files = walk(distRoot);
  } catch (err) {
    console.error(
      `[check-bundle-size] FAIL: cannot read dist at ${distRoot}: ${err.message}\n` +
        `Run \`npm run frontend:build\` first.`
    );
    process.exit(2);
  }

  const violations = [];
  const passed = [];

  for (const rule of budget.rules || []) {
    const re = new RegExp(rule.match);
    const matches = files.filter((f) => re.test(`assets/${f.path}`));
    if (matches.length === 0) {
      passed.push(`${rule.label}: no files matched (rule ${rule.match})`);
      continue;
    }
    for (const f of matches) {
      const gz = gzipBytes(f.full);
      const raw = f.size;
      if (rule.maxGzipBytes && gz > rule.maxGzipBytes) {
        violations.push(
          `[GZIP] ${rule.label} (${f.path}): ${fmt(gz)} gzip exceeds budget ${fmt(rule.maxGzipBytes)}`
        );
      } else if (rule.maxRawBytes && raw > rule.maxRawBytes) {
        violations.push(
          `[RAW] ${rule.label} (${f.path}): ${fmt(raw)} raw exceeds budget ${fmt(rule.maxRawBytes)}`
        );
      } else {
        passed.push(
          `OK ${rule.label} (${f.path}): ${rule.maxGzipBytes ? `${fmt(gz)} gz` : `${fmt(raw)} raw`}`
        );
      }
    }
  }

  if (typeof budget.totalFirstPaintGzipBytes === 'number') {
    const fpRules = (budget.rules || []).filter(
      (r) =>
        r.label === 'main entry' ||
        r.label === 'react vendor' ||
        r.label === 'supabase vendor' ||
        r.label === 'main css'
    );
    let totalFp = 0;
    for (const rule of fpRules) {
      const re = new RegExp(rule.match);
      for (const f of files.filter((f) => re.test(`assets/${f.path}`))) {
        totalFp += gzipBytes(f.full);
      }
    }
    if (totalFp > budget.totalFirstPaintGzipBytes) {
      violations.push(
        `[GZIP] total first-paint: ${fmt(totalFp)} gzip exceeds budget ${fmt(budget.totalFirstPaintGzipBytes)}`
      );
    } else {
      passed.push(
        `OK total first-paint: ${fmt(totalFp)} gz (budget ${fmt(budget.totalFirstPaintGzipBytes)})`
      );
    }
  }

  for (const line of passed) console.log(line);

  if (violations.length > 0) {
    console.error('\n[check-bundle-size] FAIL — bundle-budget violations:');
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      '\nReview docs/operations/bundle-budget.md before bumping the budget; ' +
        'the default response is to FIX the cause, not loosen the cap.'
    );
    process.exit(1);
  }

  console.log('\n[check-bundle-size] PASS — all chunks within budget.');
}

main();
