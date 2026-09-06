#!/usr/bin/env node
/**
 * **The mock-side twin of `prove.sh`, committed rather than described.**
 *
 * Round 3 claimed a mutation sweep proving the shared scenario table catches a
 * defect planted in the mock. The claim was true when I ran it and left no
 * artefact in the diff, so it was not evidence anyone else could check -- which
 * is the same objection as a smoke that passes because something else caught
 * the defect. This is the sweep, in the repository, behind an npm script.
 *
 * It plants one defect at a time into `frontend/src/lib/mockSupabaseClient.js`,
 * runs ONLY `tests/fieldLifecycleScenarios.test.js`, and requires it to go red.
 * Running only the scenario suite is the point: a plant caught by some other
 * test file would be exactly the borrowed evidence `prove.sh` was found guilty
 * of, where three plants aimed at the scenario table were being caught by a
 * smoke that ran earlier.
 *
 * Safety, mirroring prove.sh: it refuses to start on a stale `.orig`, restores
 * from an in-memory copy in a `finally`, verifies the restore byte for byte,
 * and asserts a GREEN baseline before planting anything -- without which every
 * plant reports CAUGHT and the run proves nothing.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MOCK = path.join(REPO, 'frontend/src/lib/mockSupabaseClient.js');
const SCENARIOS = 'tests/fieldLifecycleScenarios.test.js';

/**
 * Run ONE suite, and only that one.
 *
 * **A plant is caught only by the suite it is aimed at.** `prove.sh` was found
 * scoring plants CAUGHT because a smoke running earlier in the same harness had
 * caught them, while the check they targeted passed. Running the whole Vitest
 * suite here would be the identical mistake: a defect in the mock is caught by
 * plenty of files, and "some test went red" says nothing about whether the
 * shared scenario table can see it.
 *
 * The first run of this script proved the point immediately. The
 * direct-write trigger plant came back NOT CAUGHT by the scenario table -- and
 * correctly so, because the state it breaks is one no scenario can reach; it is
 * `tests/fieldLifecycleRpcs.test.js` that pins it. The plant was aimed wrongly,
 * not the table hollow, and only per-suite attribution could tell the two apart.
 *
 * @param {string} suite
 * @returns {{ ok: boolean, output: string }}
 */
const runSuite = (suite) => {
  const result = spawnSync('npx', ['vitest', 'run', suite], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { ok: result.status === 0, output };
};

/**
 * Each plant is a defect, and `suite` names the file that must catch it --
 * defaulting to the shared scenario table, which is what this script exists to
 * hold to account. `find` must appear exactly once, so a refactor that moves
 * the code makes the plant report ANCHOR-MISS -- meaningless, never a pass.
 */
const PLANTS = [
  {
    label: 'retire un-deactivates an inactive field',
    find: 'active: previous.active !== false && fieldIsLiveOn(p.p_effective_to),',
    replace: 'active: fieldIsLiveOn(p.p_effective_to),',
  },
  {
    label: 'retire deactivates a FUTURE retirement',
    find: 'active: previous.active !== false && fieldIsLiveOn(p.p_effective_to),',
    replace: 'active: false,',
  },
  {
    label: 'unretire reactivates what it never closed',
    find: `          operation: 'admin_unretire_field',
          phase: 'before',
          before: previous,
        });`,
    replace: `          operation: 'admin_unretire_field',
          phase: 'before',
          before: previous,
        });
        previous.active = true;`,
  },
  {
    label: 'unretire does not clear the retirement date',
    find: `        Object.assign(field, {
          effective_to: null,
          active: previous.active !== false,`,
    replace: `        Object.assign(field, {
          effective_to: field.effective_to,
          active: previous.active !== false,`,
  },
  {
    label: 'retire stops auditing before',
    find: `          operation: 'admin_retire_field',
          phase: 'before',`,
    replace: `          operation: 'admin_retire_field',
          phase: 'after',`,
  },
  {
    label: 'blackout scope check accepts both or neither',
    find: 'if (scopeCount !== 1) {',
    replace: 'if (scopeCount > 2) {',
  },
  {
    label: 'blackout refusals lose their SQLSTATE',
    find: "            error: { code: '23514', message: 'blackout times must be within 0..1440 and ordered' },",
    replace: "            error: { message: 'blackout times must be within 0..1440 and ordered' },",
  },
  // -------------------------------------------------------------------------
  // LIVE-1: the delete guard, in the arm that had none at all
  // -------------------------------------------------------------------------
  {
    label: 'delete loses its booking guard entirely',
    find: `        if (affected.length > 0 && !p.p_confirm) {
          audit('field', field.id, 'deleted', {
            operation: 'admin_delete_field',`,
    replace: `        if (false && affected.length > 0 && !p.p_confirm) {
          audit('field', field.id, 'deleted', {
            operation: 'admin_delete_field',`,
  },
  {
    label: 'refusal is audited as a delete that began',
    find: `          phase: 'refused',
            reason: 'bookings_exist',`,
    replace: `          phase: 'before',
            reason: 'bookings_exist',`,
  },
  {
    // **The per-row disposition flattened back to one word per table.** That
    // was the first version of this arm, and it told the operator every
    // assignment survives -- false for every row the scheduler writes, because
    // the slot cascade destroys it before the field_id SET NULL can fire.
    label: 'delete reports one disposition per table again',
    find: "            return { ...rest, disposition: cascades ? 'deleted' : 'unassigned' };",
    replace: "            return { ...rest, disposition: 'unassigned' };",
  },
  {
    // Aimed at fieldDeleteGuard, not the scenario table: every scenario seeds
    // assignments that ALSO carry a field_id, so the via-slot route is never
    // the only one there. The row that has a slot and no field_id at all --
    // the shape an earlier delete's SET NULL leaves behind -- lives in that
    // suite, and pointing this plant at the table would have reported NOT
    // CAUGHT and said nothing about whether anything covers it.
    label: 'delete stops seeing assignments reached through their slot',
    suite: 'tests/fieldDeleteGuard.test.js',
    find: '          (String(row.field_id) === String(fieldId) || (viaSlots && viaSlot(row)));',
    replace: '          String(row.field_id) === String(fieldId);',
  },
  {
    // `games` carries no field_id; only the cascade closure reaches it.
    label: 'delete stops enumerating the fixtures it destroys',
    find: '        const affected = fieldBookings(p.p_field_id, null, {\n          includeGames: true,',
    replace:
      '        const affected = fieldBookings(p.p_field_id, null, {\n          includeGames: false,',
  },
  {
    // **The shared enumerator's `after: null` contract.** `null` means no date
    // applies -- a deletion takes everything -- which is a different answer
    // from comparing against the string "null". Get that wrong and every
    // booking reads as past, the count is zero, and the guard is silently off.
    label: 'the enumerator treats "no date at all" as a date',
    find: '        const past = (value) => after !== null && !undatedValue(value) && String(value) <= after;',
    replace: '        const past = (value) => value !== null && String(value) <= String(after);',
  },
  {
    // The other half of the same predicate: `''` is what the field-import
    // apply path writes for an open-ended practice slot, and reading it as a
    // date earlier than everything drops a slot that runs forever out of the
    // refusal -- while the same row still reports `unbounded: true`.
    label: 'an empty valid_until reads as a date before every date',
    suite: 'tests/fieldLifecycleRpcs.test.js',
    find: `        const undatedValue = (value) =>
          value === null || value === undefined || String(value) === '';`,
    replace: '        const undatedValue = (value) => value === null || value === undefined;',
  },
  {
    // Not scenario-table plants: the table states the RPC's OUTCOME and
    // deliberately leaves the row-level consequences to
    // `fieldDeleteGuard.test.js`, so that is the suite these are aimed at.
    // Pointing them at the table instead would report NOT CAUGHT and say
    // nothing about whether anything covers them.
    label: 'a confirmed delete stops unassigning what survives it',
    suite: 'tests/fieldDeleteGuard.test.js',
    find: `          for (const row of db[table] || []) {
            if (String(row.field_id) === String(p.p_field_id)) row.field_id = null;
          }`,
    replace: '          // survivors left pointing at the deleted field',
  },
  {
    label: 'a confirmed delete stops cascading game slots',
    suite: 'tests/fieldDeleteGuard.test.js',
    find: "        destroy('game_slots', onField('game_slots'));",
    replace: "        // destroy('game_slots', onField('game_slots'));",
  },
  {
    // The report and the effect are held together by reading the doomed ids
    // out of `affected`. Recomputing them independently is how the two come
    // to disagree.
    label: 'a confirmed delete stops destroying the fixtures it reported',
    suite: 'tests/fieldDeleteGuard.test.js',
    find: "        destroy('games', reported('games'));",
    replace: "        // destroy('games', reported('games'));",
  },
  {
    // The tombstone is what makes a delete of a SEEDED row durable across
    // `getDB()`'s re-merge. Without it the RPC reports `deleted: true` and the
    // row is back on the next read -- the defect this file's own test found.
    label: 'the deleted field is not tombstoned and resurrects',
    suite: 'tests/fieldDeleteGuard.test.js',
    find: "        markMockDeleted(db, 'fields', [field.id]);",
    replace: "        // markMockDeleted(db, 'fields', [field.id]);",
  },
  {
    // Not a scenario-table plant: a scenario's `before` state is written
    // through `.insert()`, so the very state this breaks is one the table
    // cannot express. `fieldLifecycleRpcs.test.js` asserts it on the write
    // path instead, and that is the suite this plant is aimed at.
    label: 'the retirement trigger stops firing on direct writes',
    suite: 'tests/fieldLifecycleRpcs.test.js',
    find: '  if (row && row.effective_to && String(row.effective_to) < today) row.active = false;',
    replace: '  if (false && row && row.effective_to) row.active = false;',
  },
];

const original = readFileSync(MOCK, 'utf8');

if (existsSync(`${MOCK}.orig`)) {
  console.error(`REFUSING TO START: stale backup ${MOCK}.orig`);
  console.error('  A previous run died between backing up and restoring. Compare it with');
  console.error('  the live file, keep whichever is correct, and delete the .orig.');
  process.exit(2);
}

console.log('=== baseline: the scenario suite must pass before any plant ===');
const baseline = runSuite(SCENARIOS);
if (!baseline.ok) {
  console.error('BASELINE RED -- refusing to plant. Every plant would report CAUGHT.');
  console.error(baseline.output.split('\n').slice(-25).join('\n'));
  process.exit(3);
}
console.log('BASELINE GREEN');

let attempted = 0;
let missed = 0;
let caught = 0;
let uncaught = 0;

for (const plant of PLANTS) {
  attempted += 1;
  const occurrences = original.split(plant.find).length - 1;
  if (occurrences !== 1) {
    console.log(`${plant.label.padEnd(52)} ANCHOR-MISS (${occurrences} matches, meaningless)`);
    missed += 1;
    continue;
  }
  let red = false;
  let output = '';
  try {
    writeFileSync(MOCK, original.replace(plant.find, plant.replace));
    const result = runSuite(plant.suite ?? SCENARIOS);
    red = !result.ok;
    output = result.output;
  } finally {
    // Restore from the in-memory copy, never from a file on disk: a harness
    // that restored by reading a backup destroyed 11 KB of source once, because
    // Python truncates the target before evaluating the read.
    writeFileSync(MOCK, original);
  }
  if (readFileSync(MOCK, 'utf8') !== original) {
    console.error('RESTORE FAILED -- the mock client does not match what was read at start');
    process.exit(4);
  }
  if (red) {
    console.log(`${plant.label.padEnd(52)} CAUGHT (by ${plant.suite ?? SCENARIOS})`);
    caught += 1;
  } else {
    console.log(
      `${plant.label.padEnd(52)} NOT CAUGHT  <-- ${plant.suite ?? SCENARIOS} did not see it`
    );
    uncaught += 1;
    console.log(
      output
        .split('\n')
        .filter((line) => /Tests\s|Test Files\s/.test(line))
        .map((line) => `    ${line.trim()}`)
        .join('\n')
    );
  }
}

console.log();
console.log(
  `attempted ${attempted}, anchor-miss ${missed} (meaningless), caught ${caught}, not caught ${uncaught}`
);
process.exit(missed + uncaught === 0 ? 0 : 1);
