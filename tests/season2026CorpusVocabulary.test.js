/**
 * Closed-vocabulary guard for the `fixtures/season-2026/` corpus.
 *
 * The corpus is pseudonymous by construction: every venue, field, team and
 * person in it is invented, and `fixtures/season-2026/practice/README.md`
 * carries the standard. Two leak audits ran at authoring time, one of them
 * described as scanning the written files for organisation names, and both
 * reported zero. They were wrong: the Phase 8.0 loader review found opposing
 * club labels and one town name still in a change-log column, and a survey for
 * this fix found one more in a second file's free-text column. Both audits were
 * *denylists* — they could only recognise a name someone had already thought to
 * list — so an organisation nobody enumerated passed straight through.
 *
 * This check is the other shape. It is an **allowlist**: every alphabetic word
 * the corpus is allowed to contain outside its person-name columns is written
 * down below, and any word that is not on the list fails the run. A leak does
 * not have to be recognised to be caught — it only has to be new. That covers
 * the tokens this fix scrubbed (they are gone from the list, so reintroducing
 * one fails), and it covers the organisation name nobody has thought of yet.
 *
 * The costs are stated plainly, because they are the whole reason it works:
 *
 * - **Adding a legitimate word to the corpus fails this test.** That is the
 *   feature. A new proper noun in a fixture is exactly the moment a human
 *   should confirm it is a pseudonym before it is committed; the fix is to add
 *   it to `ALLOWED_WORDS` in the same commit that adds the data.
 * - **Person-name columns are exempt from the allowlist** — 1,400-odd invented
 *   given names and surnames would swamp it. They get the check that suits
 *   them instead: no organisation designator (`FC`, `Academy`, `League`, …) may
 *   appear in a name column, which is the shape almost every club name takes.
 *   Column *headers* are never exempt, person column or not.
 * - **The allowlist may not be padded.** Every entry must be used by the corpus
 *   on disk, so a stale or speculative entry fails just as loudly as an unknown
 *   word does.
 * - **Prose is out of scope.** The corpus's two `README.md` files are reviewed
 *   English, not data, and putting their vocabulary on this list would drown
 *   it. They are excluded by their **exact relative path**, not by shape: any
 *   other file under the corpus root is scanned, and one this guard does not
 *   know how to read fails rather than being skipped — a third `README.md`
 *   included.
 *
 * The subject set is a **recursive** walk of the corpus root, never a list in
 * this file, so a CSV added to a subdirectory that does not exist yet is still
 * scanned. The traversal proves it read whole files rather than the columns a
 * header-keyed parse happened to return: the header line is read from the raw
 * bytes and vocabulary-checked on its own, and the columns the parse returns
 * must be exactly the columns that header line declares. That is the hole the
 * 8.0 review found — a header-only extra column is in no parsed row, so a
 * per-row check never sees it.
 */

import {
  readdirSync,
  readFileSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';

import { parseCsv } from '@squadlogic/core/fixtures/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_ROOT = path.join(REPO_ROOT, 'fixtures', 'season-2026');

/**
 * The corpus held this many scannable files when the guard was written. The
 * count may only grow; a smaller one means files moved and the scan is looking
 * at less than it thinks, which must fail rather than pass vacuously.
 */
const MIN_CORPUS_FILES = 22;

/** Floors on what a healthy scan touches, for the same reason. */
const MIN_CELLS_SCANNED = 30000;
const MIN_PERSON_CELLS_SCANNED = 3000;

/**
 * Reviewed prose, not data. Excluded by **exact relative path** rather than by
 * extension or basename: an exclusion keyed on shape would skip any future
 * `README.md` anywhere under the corpus root, including one holding the names
 * this guard exists to catch. Anything else the guard cannot read is a loud
 * failure, README-shaped or not. The skip is asserted by name.
 */
const EXCLUDED_FILES = Object.freeze(['README.md', 'practice/README.md']);

/**
 * Columns holding invented people, keyed by the file's path **relative to the
 * corpus root** with `/` separators — not by basename, so an exemption cannot
 * leak onto a same-named file added in another directory. A file not named here
 * has no person column, so every one of its columns is vocabulary-checked. A
 * new file with a person column must be added here; until it is, its names fail
 * the allowlist, which is the safe direction to fail in.
 */
const PERSON_COLUMNS = Object.freeze({
  'coach_roster.csv': ['Coach First', 'Coach Last', 'Person Key'],
  'coach_roster_v1.csv': ['Coach First', 'Coach Last', 'Person Key'],
  'practice/coach_registration.csv': [
    'coach_name',
    'person_key',
    'player_1_key',
    'preferred_co_coach_1_key',
    'player_2_key',
    'preferred_co_coach_2_key',
  ],
  'practice/select_coaches.csv': ['coach_name', 'person_key'],
  'practice/player_registration.csv': ['player_name', 'player_key'],
});

/**
 * Tokens that mark a club, school or governing body. A person column carrying
 * one of these is an organisation wearing a name column's clothes. Matched
 * case-insensitively as whole words.
 */
const ORG_DESIGNATORS = Object.freeze([
  'FC',
  'SC',
  'CF',
  'AFC',
  'AC',
  'United',
  'City',
  'Athletic',
  'Academy',
  'Club',
  'League',
  'Association',
  'Sporting',
  'Rangers',
  'Rovers',
  'Wanderers',
  'Soccer',
  'Football',
  'Youth',
  'Elite',
  'Premier',
  'Alliance',
]);

/**
 * Every alphabetic word of two or more letters the corpus may contain: all
 * headers, all JSON, and every cell outside a person-name column. Extended by
 * hand from a failing run — the failure names the word, its file, its column
 * and its line, so a reviewer decides whether it is a pseudonym before it is
 * added here.
 */
const ALLOWED_WORDS = Object.freeze([
  'AM',
  'AUG',
  'Adaptive',
  'Adjacent',
  'Alder',
  'All',
  'Allowed',
  'Alpha',
  'Assigned',
  'Aug',
  'Availability',
  'Away',
  'BB',
  'BJunior',
  'BMicro',
  'BS',
  'BSelect',
  'BSuperRec',
  'Back',
  'Baycliff',
  'Beacon',
  'Blast',
  'Block',
  'Bravo',
  'Brookside',
  'COPPERGATE',
  'CYSL',
  'Cedarbrook',
  'Close',
  'Closure',
  'Club',
  'Coach',
  'Code',
  'Combi',
  'Combined',
  'Comets',
  'Container',
  'Coppergate',
  'Crest',
  'Custodian',
  'DAY',
  'DST',
  'Date',
  'Day',
  'Delta',
  'Division',
  'Draper',
  'EMBER',
  'East',
  'Echo',
  'Ember',
  'Event',
  'FC',
  'Field',
  'Fields',
  'First',
  'Fivepines',
  'Flag',
  'Football',
  'Format',
  'Foxglove',
  'Fri',
  'Friday',
  'Front',
  'Fury',
  'GH',
  'GJunior',
  'GMicro',
  'GS',
  'GSelect',
  'Game',
  'Games',
  'Gardening',
  'Goals',
  'Green',
  'HARD',
  'HS',
  'Half',
  'Halftime',
  'Halves',
  'Harbour',
  'Havenbrook',
  'Hawthorn',
  'Home',
  'Indefinite',
  'Independence',
  'Junior',
  'Kept',
  'Key',
  'Kickoff',
  'Kilo',
  'LABOR',
  'Lancers',
  'Lantern',
  'Larkfield',
  'Last',
  'League',
  'Legion',
  'Lights',
  'Lit',
  'Lower',
  'MAKEUPS',
  'MS',
  'Maplewood',
  'Marlbrook',
  'Meridian',
  'Mesa',
  'Micro',
  'Minis',
  'MinisA',
  'MinisB',
  'MinisC',
  'MinisD',
  'Mon',
  'Monday',
  'NO',
  'NOV',
  'New',
  'North',
  'Note',
  'Notes',
  'Nov',
  'Nova',
  'OF',
  'OLD',
  'Occupancy',
  'Oct',
  'Offline',
  'Open',
  'Orbit',
  'Orchard',
  'Org',
  'Outlaws',
  'Overlap',
  'PERMIT',
  'PM',
  'POSSIBLE',
  'PUGG',
  'Park',
  'Parking',
  'Person',
  'Pitch',
  'Practice',
  'Practices',
  'Program',
  'Pylon',
  'Quarry',
  'Quarrywood',
  'Quartz',
  'Regional',
  'Reseeding',
  'Restroom',
  'Ridge',
  'Ridgeline',
  'Riverbend',
  'Rookerie',
  'Rookery',
  'SAT',
  'SEPT',
  'SUN',
  'Sat',
  'Saturday',
  'Schedule',
  'School',
  'Scope',
  'Scrimmage',
  'Select',
  'Sep',
  'Shock',
  'Side',
  'Slot',
  'Soccer',
  'South',
  'Spacing',
  'Sports',
  'Springs',
  'Stadium',
  'Status',
  'Storage',
  'Strikers',
  'Summit',
  'Sun',
  'Sunday',
  'Sunset',
  'Surge',
  'TBD',
  'Tango',
  'Team',
  'Th',
  'Thistledown',
  'Thu',
  'Thursday',
  'Time',
  'Tue',
  'Tuesday',
  'Turf',
  'Turnover',
  'UNKNOWN',
  'Upper',
  'Use',
  'Vale',
  'Venue',
  'Vipers',
  'Visiting',
  'WEEK',
  'Wed',
  'Wednesday',
  'Willowmead',
  'XX',
  'YES',
  'Youth',
  'Zenith',
  'actual',
  'age',
  'am',
  'and',
  'applies',
  'as',
  'attendance',
  'available',
  'away',
  'based',
  'bathroom',
  'between',
  'birth',
  'block',
  'blue',
  'calendar',
  'children',
  'class',
  'closed',
  'co',
  'coach',
  'code',
  'comp',
  'competitive',
  'concurrent',
  'confirmed',
  'conflict',
  'conflicts',
  'constrained',
  'constraint',
  'correspondence',
  'corruption',
  'daily',
  'date',
  'day',
  'declined',
  'dedicated',
  'default',
  'display',
  'division',
  'doubt',
  'duration',
  'early',
  'edits',
  'end',
  'ends',
  'equipment',
  'event',
  'excel',
  'exceptions',
  'external',
  'facility',
  'false',
  'female',
  'field',
  'fields',
  'fixture',
  'for',
  'game',
  'games',
  'gaps',
  'gender',
  'goals',
  'group',
  'groups',
  'halves',
  'here',
  'hosts',
  'id',
  'in',
  'interpretation',
  'interpreted',
  'intro',
  'is',
  'issued',
  'item',
  'key',
  'kind',
  'label',
  'lined',
  'lit',
  'lower',
  'male',
  'matchup',
  'max',
  'min',
  'minutes',
  'name',
  'named',
  'naming',
  'narrative',
  'no',
  'none',
  'noon',
  'not',
  'note',
  'notes',
  'now',
  'number',
  'of',
  'on',
  'only',
  'open',
  'operator',
  'order',
  'overlap',
  'pages',
  'pairs',
  'parent',
  'parking',
  'permit',
  'person',
  'player',
  'playing',
  'pm',
  'potty',
  'practice',
  'practices',
  'preferred',
  'previously',
  'program',
  'programme',
  'prose',
  'public',
  'quality',
  'raw',
  'reason',
  'ref',
  'remainder',
  'respacing',
  'schedule',
  'scheduled',
  'scoped',
  'season',
  'seeding',
  'services',
  'sessions',
  'sets',
  'sheet',
  'site',
  'sizes',
  'slot',
  'soccer',
  'source',
  'spaced',
  'start',
  'status',
  'subunit',
  'team',
  'teams',
  'test',
  'the',
  'this',
  'time',
  'to',
  'too',
  'traffic',
  'true',
  'turnover',
  'unavailable',
  'uncertain',
  'unresolved',
  'until',
  'up',
  'upper',
  'uppper',
  'used',
  'value',
  'venue',
  'venues',
  'vs',
  'was',
  'week',
  'weekend',
  'window',
  'with',
  'year',
  'yellow',
  'yes',
]);

const ALLOWED = new Set(ALLOWED_WORDS);

/**
 * Alphabetic words of two or more letters in a string.
 *
 * @param {string} text
 * @returns {string[]}
 */
function words(text) {
  return String(text ?? '')
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length >= 2);
}

/**
 * Every file under one directory, recursively, as `/`-separated relative paths.
 *
 * @param {string} root
 * @returns {string[]}
 */
function filesUnder(root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return found;
}

/**
 * Scan a corpus root and report what it found.
 *
 * @param {string} root
 * @returns {{
 *   files: string[],
 *   proseFiles: string[],
 *   unreadableFiles: string[],
 *   cellsScanned: number,
 *   personCellsScanned: number,
 *   columnsClassified: number,
 *   unknown: Array<{file:string, column:string, line:number, word:string}>,
 *   orgInPersonColumn: Array<{file:string, column:string, line:number, word:string}>,
 *   columnsNotReturned: Array<{file:string, column:string}>,
 *   columnsNotDeclared: Array<{file:string, column:string}>,
 *   usedAllowed: Set<string>,
 *   exemptedColumnsMissing: Array<{file:string, column:string}>,
 * }}
 */
function scanCorpus(root) {
  const designators = new Set(ORG_DESIGNATORS.map((token) => token.toLowerCase()));
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const proseFiles = [];
  /** @type {string[]} */
  const unreadableFiles = [];
  const unknown = [];
  const orgInPersonColumn = [];
  const columnsNotReturned = [];
  const columnsNotDeclared = [];
  const exemptedColumnsMissing = [];
  const usedAllowed = new Set();
  let cellsScanned = 0;
  let personCellsScanned = 0;
  let columnsClassified = 0;

  /**
   * @param {string} file
   * @param {string} column
   * @param {number} line
   * @param {string} value
   */
  const checkVocabulary = (file, column, line, value) => {
    for (const word of words(value)) {
      if (ALLOWED.has(word)) usedAllowed.add(word);
      else unknown.push({ file, column, line, word });
    }
  };

  for (const rel of filesUnder(root)) {
    if (EXCLUDED_FILES.includes(rel)) {
      proseFiles.push(rel);
      continue;
    }
    const extension = path.extname(rel);
    if (extension !== '.csv' && extension !== '.json') {
      unreadableFiles.push(rel);
      continue;
    }
    files.push(rel);
    const text = readFileSync(path.join(root, rel), 'utf8');

    if (extension === '.json') {
      // No columns: the whole document is vocabulary-checked, keys included.
      cellsScanned += 1;
      checkVocabulary(rel, '(json)', 1, text);
      continue;
    }

    const headerLine = text.split('\n')[0] ?? '';
    // Header cells in this corpus are unquoted; a quoted one would make the
    // naive split wrong, so it is refused rather than mis-read.
    expect(headerLine).not.toContain('"');
    const headers = headerLine.split(',').map((cell) => cell.trim());
    for (const header of headers) {
      // Headers are checked whatever the column holds — a person-name exemption
      // covers the names in the cells, never the name of the column.
      checkVocabulary(rel, '(header)', 1, header);
    }

    const exempt = PERSON_COLUMNS[rel] ?? [];
    for (const column of exempt) {
      if (!headers.includes(column)) exemptedColumnsMissing.push({ file: rel, column });
    }
    const personColumns = new Set(exempt);

    const rows = parseCsv(text, rel);
    const columns = new Set();
    rows.forEach((row, index) => {
      for (const [column, value] of Object.entries(row)) {
        columns.add(column);
        const line = index + 2;
        if (personColumns.has(column)) {
          personCellsScanned += 1;
          for (const word of words(value)) {
            if (designators.has(word.toLowerCase())) {
              orgInPersonColumn.push({ file: rel, column, line, word });
            }
          }
        } else {
          cellsScanned += 1;
          checkVocabulary(rel, column, line, value);
        }
      }
    });
    columnsClassified += columns.size;

    // Every column the header declares must have been handed back by the
    // parse, and the parse must invent none. A header-only extra column is
    // absent from every row, so only this comparison can see it; a column the
    // parse invents (`__parsed_extra`) means a row is wider than its header.
    for (const header of headers) {
      if (!columns.has(header)) columnsNotReturned.push({ file: rel, column: header });
    }
    for (const column of columns) {
      if (!headers.includes(column)) columnsNotDeclared.push({ file: rel, column });
    }
  }

  return {
    files,
    proseFiles,
    unreadableFiles,
    cellsScanned,
    personCellsScanned,
    columnsClassified,
    unknown,
    orgInPersonColumn,
    columnsNotReturned,
    columnsNotDeclared,
    usedAllowed,
    exemptedColumnsMissing,
  };
}

const scan = scanCorpus(CORPUS_ROOT);

/** Words the guard reports, rendered without the surrounding row. */
const render = (hits) =>
  hits.map((hit) => `${hit.file}:${hit.line} [${hit.column}] ${hit.word}`).sort();

describe('season-2026 corpus vocabulary', () => {
  describe('the scan examined the corpus', () => {
    it('walks the corpus root recursively rather than a list in this file', () => {
      expect(scan.files.length).toBeGreaterThanOrEqual(MIN_CORPUS_FILES);
      // Files must have been found both in the root and below it, or the walk
      // is not recursing and every assertion below reads a partial corpus.
      expect(scan.files.some((file) => !file.includes('/'))).toBe(true);
      expect(scan.files.some((file) => file.includes('/'))).toBe(true);
    });

    it('reads every file it does not deliberately skip', () => {
      // An extension this guard cannot read is a hole, so it fails here rather
      // than being dropped on the floor by the `.csv`/`.json` filter.
      expect(scan.unreadableFiles).toEqual([]);
      // Excluded by identity, not by shape: exactly these two paths, so a
      // third `README.md` anywhere under the corpus root is not skipped.
      expect([...scan.proseFiles].sort()).toEqual([...EXCLUDED_FILES].sort());
    });

    it('read both the vocabulary-checked and the person-name cells', () => {
      expect(scan.cellsScanned).toBeGreaterThanOrEqual(MIN_CELLS_SCANNED);
      expect(scan.personCellsScanned).toBeGreaterThanOrEqual(MIN_PERSON_CELLS_SCANNED);
      expect(scan.columnsClassified).toBeGreaterThan(0);
    });

    it('scanned exactly the columns each header line declares', () => {
      // A column the header-keyed parse never returns would take its cells out
      // of the scan silently, and a column it invents means a row is wider
      // than its header.
      expect(scan.columnsNotReturned).toEqual([]);
      expect(scan.columnsNotDeclared).toEqual([]);
    });

    it('exempts only columns that are still in the corpus', () => {
      // An exemption naming a file or a column that no longer exists is an
      // exemption nothing revokes; it must be removed with the data.
      const scanned = new Set(scan.files);
      for (const file of Object.keys(PERSON_COLUMNS)) expect(scanned.has(file)).toBe(true);
      expect(scan.exemptedColumnsMissing).toEqual([]);
    });
  });

  describe('the vocabulary is closed', () => {
    it('contains no word outside the allowlist', () => {
      expect(render(scan.unknown)).toEqual([]);
    });

    it('uses every entry of the allowlist', () => {
      const unused = ALLOWED_WORDS.filter((word) => !scan.usedAllowed.has(word));
      expect(unused).toEqual([]);
    });

    it('has an allowlist with no duplicate entries', () => {
      expect(ALLOWED_WORDS.length).toBe(ALLOWED.size);
    });
  });

  describe('person columns hold people', () => {
    it('carries no organisation designator in a name column', () => {
      expect(render(scan.orgInPersonColumn)).toEqual([]);
    });
  });

  describe('the guard can fail', () => {
    /** @type {string[]} Scratch roots, removed after each control. */
    const scratchRoots = [];

    afterEach(() => {
      while (scratchRoots.length > 0) {
        rmSync(/** @type {string} */ (scratchRoots.pop()), { recursive: true, force: true });
      }
    });

    /**
     * Copy the corpus into a scratch directory so a control can corrupt it.
     *
     * @returns {string} the scratch root.
     */
    function scratchCorpus() {
      const root = mkdtempSync(path.join(tmpdir(), 'sl-corpus-'));
      scratchRoots.push(root);
      for (const rel of filesUnder(CORPUS_ROOT)) {
        const target = path.join(root, rel);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(CORPUS_ROOT, rel), target);
      }
      return root;
    }

    it('reports an unknown word introduced into an existing cell', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'game_change_log.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      // Stand-in for a scrubbed token: a word that is not on the allowlist and
      // names nothing real. The real ones are not written down anywhere here.
      text[1] = text[1].replace('Scrimmage', 'Zzqfictional');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.unknown.map((hit) => hit.word)).toContain('Zzqfictional');
      expect(control.files.length).toBe(scan.files.length);
    });

    it('reports an unknown word in a column header', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'field_code_names.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[0] = text[0].replace('code_name', 'code_name Zzqfictional');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.unknown.map((hit) => hit.word)).toContain('Zzqfictional');
    });

    it('reports an unknown word in the header of a person-name file', () => {
      // The person-column exemption covers the names in the cells; it must not
      // cover the column's own name.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'player_registration.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[0] = text[0].replace('player_name', 'Zzqfictional_name');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.unknown.map((hit) => hit.word)).toContain('Zzqfictional');
    });

    it('reports an unknown word in a subdirectory that did not exist before', () => {
      const root = scratchCorpus();
      mkdirSync(path.join(root, 'zz_new_drop'));
      writeFileSync(
        path.join(root, 'zz_new_drop', 'sheet.csv'),
        'venue,note\nAlder Park,Zzqfictional\n'
      );

      const control = scanCorpus(root);
      expect(control.files.length).toBe(scan.files.length + 1);
      expect(control.unknown.map((hit) => hit.word)).toContain('Zzqfictional');
    });

    it('reports a file whose extension it cannot read', () => {
      const root = scratchCorpus();
      writeFileSync(path.join(root, 'dropped.txt'), 'Zzqfictional\n');

      const control = scanCorpus(root);
      expect(control.unreadableFiles).toContain('dropped.txt');
    });

    it('reports an unknown word in the geometry JSON', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'facility_geometry.json');
      writeFileSync(target, readFileSync(target, 'utf8').replace('Alder', 'Zzqfictional'));

      const control = scanCorpus(root);
      expect(control.unknown.map((hit) => hit.word)).toContain('Zzqfictional');
    });

    it('reports an organisation designator dropped into a person column', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'select_coaches.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[3] = 'Zzqfictional FC';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.orgInPersonColumn.map((hit) => hit.word)).toContain('FC');
    });

    it('reports a header-only column the parse never returned', () => {
      // The shape the 8.0 review found: an extra name on the header line and
      // no cell under it. Every row is well formed, so no per-row rule fires.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'game_change_log.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[0] = `${text[0]},Custodian`;
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.columnsNotReturned).toContainEqual({
        file: 'practice/game_change_log.csv',
        column: 'Custodian',
      });
      expect(control.unknown).toEqual([]);
    });

    it('reports a row wider than its header', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'field_equipment.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[1] = `${text[1]},Zzqfictional`;
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.columnsNotDeclared).toContainEqual({
        file: 'practice/field_equipment.csv',
        column: '__parsed_extra',
      });
      expect(control.unknown.map((hit) => hit.word)).toContain('Zzqfictional');
    });

    it('reports an exemption for a column the file no longer has', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'select_coaches.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[0] = text[0].replace('person_key', 'coach_person_id');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.exemptedColumnsMissing).toContainEqual({
        file: 'practice/select_coaches.csv',
        column: 'person_key',
      });
    });

    it('reports a README dropped into a subdirectory rather than skipping it', () => {
      // Excluding by shape would swallow this file whole. Excluding by exact
      // relative path leaves it to the reader, which cannot read Markdown, so
      // it surfaces as unreadable instead of vanishing.
      const root = scratchCorpus();
      mkdirSync(path.join(root, 'practice', 'archive'), { recursive: true });
      writeFileSync(
        path.join(root, 'practice', 'archive', 'README.md'),
        'Zzqfictional FC notes.\n'
      );

      const control = scanCorpus(root);
      expect(control.unreadableFiles).toContain('practice/archive/README.md');
      expect([...control.proseFiles].sort()).toEqual([...EXCLUDED_FILES].sort());
    });

    it('reports an allowlist entry the corpus stopped using', () => {
      // Scanning a corpus with the practice drop removed leaves every
      // practice-only word unused. The rule must produce a non-empty result
      // here, or it could never produce one at all.
      const root = scratchCorpus();
      rmSync(path.join(root, 'practice'), { recursive: true, force: true });

      const partial = scanCorpus(root);
      const unused = ALLOWED_WORDS.filter((word) => !partial.usedAllowed.has(word));
      expect(unused.length).toBeGreaterThan(0);
      expect(partial.files.length).toBeLessThan(scan.files.length);
    });
  });
});
