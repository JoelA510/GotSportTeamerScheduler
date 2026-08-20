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
