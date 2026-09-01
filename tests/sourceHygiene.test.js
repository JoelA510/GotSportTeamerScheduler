/**
 * Repo-level source hygiene for `packages/core/src`.
 *
 * The one rule here has a history. A raw `U+0000` used as a map-key separator
 * makes the whole file **binary** to every tool that reads bytes: `file` reports
 * `data`, ripgrep skips it silently, and git records it as
 * `Bin 0 -> 57224 bytes` with zero insertions — which is how a 1,460-line rule
 * file once merged as an opaque blob that no diff review could read. It was
 * caught and fixed during Prompt 1.1 and it came back in Prompt 2.3, so it gets
 * a standing guard rather than a third fix.
 *
 * The separator itself is fine and stays; only the *raw byte* is refused. The
 * `\u0000` escape sequence compiles to the same character and keeps the file
 * text, which is exactly what `facility/facilityGraph.js` and
 * `facility/occupancy.js` already do.
 *
 * The second rule has a history too, and it is the other half of the class
 * `tests/unknownSurfaceDiscipline.test.js` guards. `effectiveSeverityTable()`
 * returns a **severity table and a report about how the registry was read** —
 * which records it could not judge here, which it retyped, where two of equal
 * specificity disagreed. Twice now a caller has bound the whole thing and read
 * only the table, so a constraint the lookup could not decide about was
 * silently not applied and nothing anywhere said so: round 1 in
 * `externalImport`'s `planFindings()`, round 2 in `resolve/legality.js`
 * `checkPlacement()`, which had the game in its hand and did not pass the
 * teams. Dropping the report is sometimes right — a caller that holds no teams
 * and no people learns nothing from being told it could not judge a team scope
 * — so the rule is not "never drop it" but **"say so"**: a call site that does
 * not read `.findings` must be named below with a reason.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const CORE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'core',
  'src'
);

/**
 * Every `.js` file under one directory, recursively.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function sourceFilesUnder(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFilesUnder(full));
    else if (entry.endsWith('.js')) files.push(full);
  }
  return files;
}

describe('source hygiene :: no source file under packages/core/src is binary', () => {
  const files = sourceFilesUnder(CORE_SRC);

  it('scans a plausible number of files', () => {
    // The meta-assertion the rest of this file rests on: a walk that found
    // nothing would pass the NUL check for the worst possible reason.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.endsWith(path.join('ruleEngine', 'rules.js')))).toBe(true);
  });

  it('detects a raw NUL byte when there is one', () => {
    // The positive control: the check below is only worth reading if it can
    // fail, so the same predicate is run against a buffer that does contain one.
    expect(Buffer.from([0x61, 0x00, 0x62]).includes(0)).toBe(true);
    // …and the escape sequence this file asks for is plain ASCII on disk.
    expect(Buffer.from(String.raw`a\u0000b`, 'utf8').includes(0)).toBe(false);
  });

  it('holds no raw NUL byte in any of them', () => {
    /** @type {string[]} */
    const offenders = [];
    for (const file of files) {
      if (readFileSync(file).includes(0)) offenders.push(path.relative(CORE_SRC, file));
    }
    expect(
      offenders,
      `these files contain a raw U+0000 and are binary to git, ripgrep and every diff review; write the separator as the \\u0000 escape instead: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The registry seam returns two halves, and dropping one is a stated act       */
/* -------------------------------------------------------------------------- */

/**
 * Call sites that read `effectiveSeverityTable()`'s table and not its report,
 * each with the reason it is right to.
 *
 * Keyed by the file's path under `packages/core/src`. A new call site that drops
 * the report and is not named here fails the check below; a name here that no
 * longer drops it fails too, so the list cannot rot into a permanent excuse.
 *
 * @type {Record<string, string>}
 */
const DROPS_THE_SEAM_REPORT = Object.freeze({
  'attribution/explain.js':
    'the two boundary questions are asked of a *place* — a surface, a venue and a date — and `where` carries no sides at all, so an unjudged team or person scope from here says only "the question named no team", which is true of every call. The game-shaped answers reach `checkPlacement()`, which does report it.',
  'feasibility/verdict.js':
    'the same reason, one module along: `probeKickoff()` asks about a slot rather than a fixture, so there is no team in hand to judge a team scope against. A feasibility answer still sees the team-scoped verdict, through `attribution/explain.js` and `checkPlacement()`.',
  'constraints/whatIf.js':
    'a projection asks the registry twice over one unchanged context and publishes the *difference*; the seam would report the same thing on both sides, so its report carries no delta and the module merges both `meta` blocks instead, which is the half that does differ.',
  'placement/replaceGames.js':
    'a bounded single-venue harness whose stated purpose is to show that the registry is the only thing differing between two runs. It throws on every malformed input rather than reporting, and it reads the table for exactly one comparison.',
});

describe('source hygiene :: dropping the registry seam report is a stated act', () => {
  const files = sourceFilesUnder(CORE_SRC);

  /**
   * Every file that binds `effectiveSeverityTable()`'s result, and whether it
   * ever reads that binding's `.findings`.
   *
   * @returns {{ reads: string[], drops: string[] }}
   */
  function callSites() {
    /** @type {Set<string>} */
    const reads = new Set();
    /** @type {Set<string>} */
    const drops = new Set();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const key = path.relative(CORE_SRC, file).split(path.sep).join('/');
      for (const match of source.matchAll(/const\s+(\w+)\s*=\s*effectiveSeverityTable\(/g)) {
        const binder = match[1];
        if (new RegExp(`\\b${binder}\\.findings\\b`).test(source)) reads.add(key);
        else drops.add(key);
      }
    }
    return { reads: [...reads].sort(), drops: [...drops].sort() };
  }

  const sites = callSites();

  it('finds the seam being called at all', () => {
    // The meta-assertion. A regex that matched nothing would make the check
    // below pass for the worst possible reason, and a list of readers that was
    // empty would mean nothing has ever been shown to read the report.
    expect(sites.reads.length + sites.drops.length).toBeGreaterThan(3);
    expect(sites.reads).toContain('resolve/legality.js');
    // `ruleEngine/engine.js` is the precedent the fix in `resolve/legality.js`
    // followed: it aggregates every cached table's findings into the run,
    // because "discarding them threw away the provenance of every severity this
    // run reports". Asserted here so the two cannot drift apart again.
    expect(sites.reads).toContain('ruleEngine/engine.js');
  });

  it('names every call site that drops it', () => {
    const unstated = sites.drops.filter((file) => !(file in DROPS_THE_SEAM_REPORT));
    expect(
      unstated,
      `these call sites bind effectiveSeverityTable() and never read its .findings; either read them or add the file to DROPS_THE_SEAM_REPORT with the reason it is right to drop them: ${unstated.join(', ')}`
    ).toEqual([]);
    const stale = Object.keys(DROPS_THE_SEAM_REPORT).filter((file) => !sites.drops.includes(file));
    expect(
      stale,
      `these files are excused from reading the seam report and no longer drop it: ${stale.join(', ')}`
    ).toEqual([]);
    // A one-word reason is not a reason.
    for (const [file, reason] of Object.entries(DROPS_THE_SEAM_REPORT)) {
      expect(reason.length, file).toBeGreaterThan(80);
    }
  });

  it('detects a call site that drops it', () => {
    // The positive control: the same predicate, run over source that does drop
    // the report and over source that reads it.
    const drops =
      'const table = effectiveSeverityTable(registry, context);\nreturn table.severityByCode;';
    const reads =
      'const table = effectiveSeverityTable(registry, context);\nfindings.push(...table.findings);';
    const dropsIt = (source) => {
      const match = /const\s+(\w+)\s*=\s*effectiveSeverityTable\(/.exec(source);
      return match !== null && !new RegExp(`\\b${match[1]}\\.findings\\b`).test(source);
    };
    expect(dropsIt(drops)).toBe(true);
    expect(dropsIt(reads)).toBe(false);
  });
});
