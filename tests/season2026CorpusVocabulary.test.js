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
 *   included. The exclusion is from the **allowlist only**. Every list-free
 *   rule — every shape above — still runs on them, because the stated reason
 *   (their vocabulary would drown the list) is a reason about the list and
 *   about nothing else. There are two contracts here, `allowlist-exempt` and
 *   `shape-checked`; prose gets the first, and no file gets a third.
 *
 * The subject set is a **recursive** walk of the corpus root, never a list in
 * this file, so a CSV added to a subdirectory that does not exist yet is still
 * scanned. The traversal proves it read whole files rather than the columns a
 * header-keyed parse happened to return: the header line is read from the raw
 * bytes and vocabulary-checked on its own, and the columns the parse returns
 * must be exactly the columns that header line declares. That is the hole the
 * 8.0 review found — a header-only extra column is in no parsed row, so a
 * per-row check never sees it.
 *
 * Both a **file's path** and its **contents** are checked: every segment of
 * every scanned file's relative path goes through the same allowlist, with `_`
 * and `-` read as word separators. And because a name need not spell itself in
 * ASCII letters to be a name, every cell — person-name columns included — is
 * additionally matched against a set of shapes the corpus does not contain: an
 * email address, a URL scheme or host, a phone number, a run of five or more
 * digits, any full date whose year is not on `ALLOWED_YEARS`, **a letter
 * outside ASCII**, and **a dotted initialism**. The last two close the class
 * `words()` cannot see: it splits on `[^A-Za-z]+` and drops one-character
 * tokens, so a name written in another script produces no words at all, and
 * `S.R.F.C.` produces none either — every letter in it is a token of one.
 *
 * ## The failure shape this guard was rebuilt around
 *
 * The first version of this file was strong in exactly the dimension it was
 * aimed at and silent immediately beside it. Four holes, one pattern:
 *
 * - it read file **contents** and never the **path** those contents sat at;
 * - it excluded prose by **shape** (`.md`) rather than by **identity**, so a
 *   new `README.md` full of real names was skipped for being README-shaped;
 * - it saw **letters** and nothing else, so a phone number, an email address
 *   and a date of birth were all invisible;
 * - it compared a **trimmed** header against an **untrimmed** parse key, so
 *   one half of a single comparison disagreed with the other.
 *
 * That is the same failure as the denylist audits this file replaces: an
 * instrument that is airtight along its own axis and blind one step off it,
 * reporting zero because it cannot see rather than because there is nothing
 * there. It is worth naming, because the fix for each hole was easy and
 * noticing it was not. When adding a rule here, ask what dimension it does not
 * cover before asking whether it works.
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
import { IDENTITY_SHAPES, collapseInitialisms, words } from '@squadlogic/core/privacy/index.js';

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
 * A floor on the dates the year gate actually read. `ALLOWED_YEARS` is only a
 * rule if something is measured against it; a run that year-checks nothing
 * would pass the gate by never reaching it. The corpus carries 2,081 dates
 * across its two written shapes.
 */
const MIN_DATES_CHECKED = 2000;

/**
 * A floor on the dates read out of the two prose files, which is what proves
 * the list-free rules reached their *contents* rather than only their paths.
 * The corpus prose quotes 6 dates.
 */
const MIN_PROSE_DATES = 6;

/**
 * Reviewed prose, not data. Excluded by **exact relative path** rather than by
 * extension or basename: an exclusion keyed on shape would skip any future
 * `README.md` anywhere under the corpus root, including one holding the names
 * this guard exists to catch. Anything else the guard cannot read is a loud
 * failure, README-shaped or not. The skip is asserted by name.
 */
const EXCLUDED_FILES = Object.freeze(['README.md', 'practice/README.md']);

/**
 * Years a full date in the corpus may carry. The corpus is one season, so any
 * other year in a date shape is either a leaked date of birth or a date from
 * somewhere this corpus does not describe. A bare four-digit number is *not* a
 * date — birth **year** is a kept column — so only the full shapes below are
 * gated.
 */
const ALLOWED_YEARS = Object.freeze(['2026']);

/**
 * Shapes that carry identity without using a letter, which is why `words()`
 * cannot see them and why these run over **every** cell, person-name columns
 * included.
 *
 * **Lifted, not copied.** The table now lives in
 * `packages/core/src/privacy/textShapes.js`, because Phase 8.4 validates an
 * operator-written blackout note against exactly these shapes and a test cannot
 * be imported by production code. A second copy beside a reconciliation test
 * would drift the moment one side was strengthened, which is the failure mode
 * this whole file exists to catch. `matches the shape table this file carried
 * before the lift` below pins every pattern's source and flags against the
 * literals this file used to hold, so the lift is proved behaviour-preserving
 * rather than asserted to be.
 */
const FORBIDDEN_PATTERNS = IDENTITY_SHAPES;

/**
 * Every pattern this file held before the lift, as `source` and `flags`.
 *
 * This is the proof that moving the table changed nothing: a regex edited in
 * `privacy/textShapes.js` fails here, naming the shape. Recorded as strings
 * rather than as `RegExp` literals on purpose - two `RegExp` objects are never
 * `===`, and rebuilding them from the module would compare it against itself.
 */
const SHAPES_BEFORE_THE_LIFT = Object.freeze([
  Object.freeze({
    name: 'email',
    source: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+',
    flags: '',
    samples: ['zzq@zzqfictional.example'],
  }),
  Object.freeze({
    name: 'url-scheme',
    source: '[A-Za-z][A-Za-z0-9+.-]*:\\/\\/',
    flags: '',
    samples: ['https://zzqfictional.example'],
  }),
  Object.freeze({
    name: 'url-host',
    source: '\\b[A-Za-z0-9-]+\\.(?:com|net|org|edu|gov|io|co|us|uk|info|biz)\\b',
    flags: 'i',
    samples: ['zzqfictional.com'],
  }),
  Object.freeze({
    name: 'phone',
    source: '(?:\\+\\d{1,3}[\\s.-]?)?(?:\\(\\d{3}\\)|\\b\\d{3})[\\s.-]?\\d{3}[\\s.-]?\\d{4}\\b',
    flags: '',
    samples: ['(925) 555-0134', '(925)555-0134', '+1 (925) 555-0134', '925-555-0134'],
  }),
  Object.freeze({
    name: 'digit-run',
    source: '\\d{5,}',
    flags: '',
    samples: ['1234567'],
  }),
  Object.freeze({
    // Widened in the 8.4 review to `[\\p{L}\\p{M}]`: a decomposed name is
    // letters plus combining marks, and `\\p{L}` alone matched neither. The
    // corpus is ASCII, so this reads exactly as much of it as before - the
    // pinned source is updated deliberately rather than the assertion relaxed.
    name: 'non-ascii-letter',
    source: '(?!\\p{ASCII})[\\p{L}\\p{M}]',
    flags: 'u',
    samples: ['\u0414\u0438\u043d\u0430\u043c\u043e', 'e\u0308'],
  }),
  Object.freeze({
    name: 'initialism',
    source: '(?:[A-Za-z]\\.){2,}',
    flags: '',
    samples: ['S.R.F.C.'],
  }),
]);

/**
 * Date shapes the corpus does not currently write. Declared rather than left to
 * be inferred from a count: a shape that reads nothing contributes nothing to
 * the year gate, and an aggregate floor cannot tell a dead shape from a live
 * one. The declaration is enforced in both directions — a shape named here that
 * starts matching fails, and a shape not named here that matches nothing fails
 * — so this list is the one place the fact is recorded, and it cannot go stale.
 */
const DATE_SHAPES_ABSENT_FROM_CORPUS = Object.freeze(['dot-date']);

/**
 * Full date shapes, with the capture group holding the year. Matched globally
 * so every date in a cell is year-checked, not just the first. Each carries a
 * sample with a year the corpus does not cover, so every shape has a control
 * proving it both reads and rejects — including the one the corpus never
 * exercises.
 */
const DATE_SHAPES = Object.freeze([
  { name: 'iso-date', pattern: /(\d{4})-\d{1,2}-\d{1,2}/g, yearGroup: 1, samples: ['2011-03-14'] },
  // The month and day are bounded so that a triple of plain numbers is not
  // read as a date: the corpus prose describes a field as `60/50/40`, which the
  // unbounded shape reported as a date in year 40. Bounding costs nothing —
  // all 1,267 slash dates in the corpus still match, and still only in 2026.
  {
    name: 'slash-date',
    pattern: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(\d{2,4})\b/g,
    yearGroup: 1,
    samples: ['03/14/2011'],
  },
  {
    name: 'dot-date',
    pattern: /\d{1,2}\.\d{1,2}\.(\d{2,4})/g,
    yearGroup: 1,
    samples: ['14.03.2011'],
  },
]);

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
  'aliases',
  'am',
  'and',
  'applies',
  'as',
  'attendance',
  'availability',
  'available',
  'away',
  'based',
  'bathroom',
  'between',
  'birth',
  'block',
  'blue',
  'calendar',
  'change',
  'children',
  'class',
  'closed',
  'co',
  'coach',
  'coaches',
  'code',
  'combined',
  'comp',
  'competitive',
  'concurrent',
  'confirmed',
  'conflict',
  'conflicts',
  'constrained',
  'constraint',
  'constraints',
  'correspondence',
  'corruption',
  'csv',
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
  'fixtures',
  'for',
  'formats',
  'game',
  'games',
  'gaps',
  'gender',
  'geometry',
  'goals',
  'grid',
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
  'inventory',
  'is',
  'issued',
  'item',
  'json',
  'key',
  'kind',
  'label',
  'lined',
  'lit',
  'log',
  'lower',
  'male',
  'matchup',
  'max',
  'min',
  'minutes',
  'name',
  'named',
  'names',
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
  'permits',
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
  'published',
  'quality',
  'raw',
  'reason',
  'rec',
  'ref',
  'registration',
  'remainder',
  'reservations',
  'respacing',
  'roster',
  'schedule',
  'scheduled',
  'scoped',
  'season',
  'seeding',
  'select',
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
  'sunsets',
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
  'weekly',
  'window',
  'with',
  'year',
  'yellow',
  'yes',
]);

const ALLOWED = new Set(ALLOWED_WORDS);

/**
 * One spelling of a column name, used for the declared headers, the person-name
 * exemption list and the keys the CSV parse returns alike. Trimming only one
 * side of that comparison is how a header written `player_name , player_key`
 * un-exempted a person column while still matching the exemption by name.
 *
 * @param {string} column
 * @returns {string}
 */
function normaliseColumn(column) {
  return String(column ?? '').trim();
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
 *   pathsChecked: number,
 *   pathSegmentsChecked: number,
 *   pathWords: Set<string>,
 *   proseChecked: string[],
 *   proseDatesChecked: number,
 *   patternCellsScanned: number,
 *   datesChecked: number,
 *   datesByShape: Record<string, number>,
 *   proseFiles: string[],
 *   unreadableFiles: string[],
 *   cellsScanned: number,
 *   personCellsScanned: number,
 *   columnsClassified: number,
 *   unknown: Array<{file:string, column:string, line:number, word:string}>,
 *   orgInPersonColumn: Array<{file:string, column:string, line:number, word:string}>,
 *   columnsNotReturned: Array<{file:string, column:string}>,
 *   columnsNotDeclared: Array<{file:string, column:string}>,
 *   forbidden: Array<{file:string, column:string, line:number, word:string}>,
 *   usedAllowed: Set<string>,
 *   usedYears: Set<string>,
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
  const proseChecked = [];
  let proseDatesChecked = 0;
  /** @type {string[]} */
  const unreadableFiles = [];
  const unknown = [];
  const forbidden = [];
  const orgInPersonColumn = [];
  const columnsNotReturned = [];
  const columnsNotDeclared = [];
  const exemptedColumnsMissing = [];
  const usedAllowed = new Set();
  const usedYears = new Set();
  let pathsChecked = 0;
  let pathSegmentsChecked = 0;
  /** @type {Set<string>} Words the *path* check contributed, and only it. */
  const pathWords = new Set();
  let patternCellsScanned = 0;
  let datesChecked = 0;
  /** @type {Record<string, number>} */
  const datesByShape = Object.fromEntries(DATE_SHAPES.map((shape) => [shape.name, 0]));
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

  /**
   * Shape checks, run over every cell including the person-name columns the
   * allowlist cannot cover. A leak with no letters in it is still a leak.
   *
   * @param {string} file
   * @param {string} column
   * @param {number} line
   * @param {string} value
   */
  const checkPatterns = (file, column, line, value) => {
    const text = String(value ?? '');
    patternCellsScanned += 1;
    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      const hit = text.match(pattern);
      if (hit) forbidden.push({ file, column, line, word: `${name}: ${hit[0]}` });
    }
    for (const { name, pattern, yearGroup } of DATE_SHAPES) {
      // A fresh regex per use: the shapes are global, and a shared `lastIndex`
      // would make a match depend on the cell scanned before it.
      const scanner = new RegExp(pattern.source, pattern.flags);
      let match = scanner.exec(text);
      while (match !== null) {
        datesChecked += 1;
        datesByShape[name] += 1;
        const year = match[yearGroup];
        if (ALLOWED_YEARS.includes(year)) usedYears.add(year);
        else forbidden.push({ file, column, line, word: `${name}: ${match[0]}` });
        match = scanner.exec(text);
      }
    }
  };

  for (const rel of filesUnder(root)) {
    if (EXCLUDED_FILES.includes(rel)) {
      proseFiles.push(rel);
      // Allowlist-exempt, not check-exempt. Reviewed prose is the reason these
      // two are off the *list*; it is no reason at all to skip the rules that
      // need no list, and these are the two files most likely to describe the
      // real season in sentences.
      const before = datesChecked;
      for (const segment of rel.split('/')) checkPatterns(rel, '(path)', 0, segment);
      checkPatterns(rel, '(prose)', 1, readFileSync(path.join(root, rel), 'utf8'));
      proseDatesChecked += datesChecked - before;
      proseChecked.push(rel);
      continue;
    }
    const extension = path.extname(rel);
    if (extension !== '.csv' && extension !== '.json') {
      unreadableFiles.push(rel);
      continue;
    }
    files.push(rel);

    // The path is data too. A directory or file named for a real club leaks it
    // just as loudly as a cell does, and `rel` was previously only ever a
    // label on someone else's finding.
    pathsChecked += 1;
    for (const segment of rel.split('/')) {
      pathSegmentsChecked += 1;
      const spelled = segment.split(/[_-]+/).join(' ');
      for (const word of words(spelled)) pathWords.add(word);
      checkVocabulary(rel, '(path)', 0, spelled);
      checkPatterns(rel, '(path)', 0, segment);
    }

    const text = readFileSync(path.join(root, rel), 'utf8');

    if (extension === '.json') {
      // No columns: the whole document is vocabulary-checked, keys included.
      cellsScanned += 1;
      checkVocabulary(rel, '(json)', 1, text);
      checkPatterns(rel, '(json)', 1, text);
      continue;
    }

    const headerLine = text.split('\n')[0] ?? '';
    // Header cells in this corpus are unquoted; a quoted one would make the
    // naive split wrong, so it is refused rather than mis-read.
    expect(headerLine).not.toContain('"');
    const headers = headerLine.split(',').map(normaliseColumn);
    for (const header of headers) {
      // Headers are checked whatever the column holds — a person-name exemption
      // covers the names in the cells, never the name of the column.
      checkVocabulary(rel, '(header)', 1, header);
      checkPatterns(rel, '(header)', 1, header);
    }

    const exempt = (PERSON_COLUMNS[rel] ?? []).map(normaliseColumn);
    for (const column of exempt) {
      if (!headers.includes(column)) exemptedColumnsMissing.push({ file: rel, column });
    }
    const personColumns = new Set(exempt);

    const rows = parseCsv(text, rel);
    const columns = new Set();
    rows.forEach((row, index) => {
      for (const [rawColumn, value] of Object.entries(row)) {
        // One spelling of the column name for the exemption lookup and for the
        // structural comparison below, or the two disagree on whitespace and
        // the exemption silently lapses.
        const column = normaliseColumn(rawColumn);
        columns.add(column);
        const line = index + 2;
        // Shapes run over every cell; only the allowlist has an exemption.
        checkPatterns(rel, column, line, value);
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
    pathsChecked,
    pathSegmentsChecked,
    pathWords,
    proseChecked,
    proseDatesChecked,
    patternCellsScanned,
    datesChecked,
    datesByShape,
    proseFiles,
    unreadableFiles,
    cellsScanned,
    personCellsScanned,
    columnsClassified,
    unknown,
    forbidden,
    orgInPersonColumn,
    columnsNotReturned,
    columnsNotDeclared,
    usedAllowed,
    usedYears,
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

    it('runs every list-free rule on the prose it keeps off the allowlist', () => {
      // Compared against the constant, not against the scan's own file list,
      // so dropping the prose checks leaves this empty rather than agreeing
      // with itself.
      expect([...scan.proseChecked].sort()).toEqual([...EXCLUDED_FILES].sort());
      // And it read their contents, not merely their paths: the corpus prose
      // quotes dates, and those dates went through the year gate.
      expect(scan.proseDatesChecked).toBeGreaterThanOrEqual(MIN_PROSE_DATES);
    });

    it('checked every segment of every path, directories included', () => {
      // `pathsChecked` on its own could not fail: it was incremented next to
      // the push it was compared against, so deleting the whole path loop kept
      // it true. And a companion asserting `csv` was reached said nothing —
      // `csv` is the file extension, so narrowing the loop to the last segment
      // and dropping every directory name kept that true as well.
      //
      // The expectation is derived from the file list, which is built before
      // the path loop runs and so survives a break in it.
      const expectedSegments = scan.files.reduce(
        (total, file) => total + file.split('/').length,
        0
      );
      expect(scan.pathSegmentsChecked).toBe(expectedSegments);
      // And the corpus really does nest, so the comparison above is not two
      // ways of counting the same flat list.
      expect(expectedSegments).toBeGreaterThan(scan.files.length);

      // The words the path check contributed, against the same independently
      // derived subject set: empty if the loop is gone.
      const expectedPathWords = new Set(
        scan.files.flatMap((file) =>
          file.split('/').flatMap((segment) => words(segment.split(/[_-]+/).join(' ')))
        )
      );
      expect([...scan.pathWords].sort()).toEqual([...expectedPathWords].sort());
      expect(scan.pathWords.size).toBeGreaterThan(0);
    });

    it('read both the vocabulary-checked and the person-name cells', () => {
      expect(scan.cellsScanned).toBeGreaterThanOrEqual(MIN_CELLS_SCANNED);
      expect(scan.personCellsScanned).toBeGreaterThanOrEqual(MIN_PERSON_CELLS_SCANNED);
      // `> 0` could not fail either. The count is compared against the columns
      // the header lines on disk declare, read here rather than taken from the
      // scan, so classifying fewer files or fewer columns per file is visible.
      const declaredColumns = scan.files
        .filter((file) => file.endsWith('.csv'))
        .reduce(
          (total, file) =>
            total +
            readFileSync(path.join(CORPUS_ROOT, file), 'utf8').split('\n')[0].split(',').length,
          0
        );
      expect(scan.columnsClassified).toBe(declaredColumns);
      expect(declaredColumns).toBeGreaterThan(0);
    });

    it('ran the shape checks over every cell, person columns included', () => {
      // Strictly more cells than the allowlist saw, because the shape checks
      // also cover the person columns the allowlist is exempt from.
      expect(scan.patternCellsScanned).toBeGreaterThan(scan.cellsScanned + scan.personCellsScanned);
      expect(scan.datesChecked).toBeGreaterThanOrEqual(MIN_DATES_CHECKED);
    });

    it('has no date shape that quietly reads nothing', () => {
      // An aggregate floor cannot distinguish a dead shape from a live one, so
      // each shape is counted on its own and measured against the declaration.
      const absent = DATE_SHAPES.filter((shape) => scan.datesByShape[shape.name] === 0);
      expect(absent.map((shape) => shape.name).sort()).toEqual(
        [...DATE_SHAPES_ABSENT_FROM_CORPUS].sort()
      );
    });

    it('declares no absent date shape that the corpus has started using', () => {
      // The other direction, so the declaration cannot go stale: naming a shape
      // absent is a claim about the corpus, and it is checked.
      for (const name of DATE_SHAPES_ABSENT_FROM_CORPUS) {
        expect(scan.datesByShape).toHaveProperty(name);
        expect(scan.datesByShape[name]).toBe(0);
      }
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

  describe('the lifted shape table is the table this file used to carry', () => {
    it('matches the shape table this file carried before the lift', () => {
      // The behaviour-preservation proof for moving FORBIDDEN_PATTERNS into
      // `packages/core/src/privacy/textShapes.js`. Source and flags are
      // compared as strings against literals recorded here, so the comparison
      // cannot be satisfied by the module agreeing with itself: editing a
      // pattern in the module fails this and names the shape.
      const lifted = FORBIDDEN_PATTERNS.map(({ name, pattern, samples }) => ({
        name,
        source: pattern.source,
        flags: pattern.flags,
        samples: [...samples],
      }));
      const before = SHAPES_BEFORE_THE_LIFT.map(({ name, source, flags, samples }) => ({
        name,
        source,
        flags,
        samples: [...samples],
      }));
      expect(lifted).toEqual(before);
    });

    it('can fail, on a pattern that differs only in one character', () => {
      // The control for the assertion above. `digit-run` widened from five
      // digits to four is the smallest edit that weakens a rule, and the kind
      // a reviewer skims past; the comparison must reject it.
      const weakened = FORBIDDEN_PATTERNS.map(({ name, pattern }) =>
        name === 'digit-run'
          ? { name, source: /\d{4,}/.source, flags: pattern.flags }
          : { name, source: pattern.source, flags: pattern.flags }
      );
      const before = SHAPES_BEFORE_THE_LIFT.map(({ name, source, flags }) => ({
        name,
        source,
        flags,
      }));
      expect(weakened).not.toEqual(before);
    });

    it('feeds the collapse helper the module exports, not a local copy', () => {
      // `words()` and `collapseInitialisms()` moved with the table. If a local
      // shadow were reintroduced, the dotted initialism would stop reaching the
      // allowlist as a word and the designator rule would go quiet on person
      // columns again - the exact regression the corpus README records.
      expect(collapseInitialisms('S.R.F.C.')).toBe('SRFC');
      expect(words('S.R.F.C. United')).toEqual(['SRFC', 'United']);
    });
  });

  describe('every declared shape is an enforced shape', () => {
    it('gives every forbidden shape at least one sample to be proved with', () => {
      // Declared is not enforced. A shape with no sample has no control, and a
      // rule nothing exercises is indistinguishable from a rule that is broken.
      const unsampled = FORBIDDEN_PATTERNS.filter((shape) => (shape.samples ?? []).length === 0);
      expect(unsampled.map((shape) => shape.name)).toEqual([]);
    });

    it('gives every date shape at least one sample to be proved with', () => {
      const unsampled = DATE_SHAPES.filter((shape) => (shape.samples ?? []).length === 0);
      expect(unsampled.map((shape) => shape.name)).toEqual([]);
    });

    it('has a sample that its own shape actually matches', () => {
      // A sample that does not match would make its control pass on someone
      // else's hit, which is the shape of a control that proves nothing.
      for (const { name, pattern, samples } of [...FORBIDDEN_PATTERNS, ...DATE_SHAPES]) {
        for (const sample of samples) {
          const scanner = new RegExp(pattern.source, pattern.flags.replace('g', ''));
          expect({ name, sample, matched: scanner.test(sample) }).toEqual({
            name,
            sample,
            matched: true,
          });
        }
      }
    });
  });

  describe('the shapes letters cannot show are absent too', () => {
    it('carries no email, URL, phone number, long digit run or foreign-year date', () => {
      expect(render(scan.forbidden)).toEqual([]);
    });

    it('uses every entry of the allowed-year list', () => {
      // Same no-padding rule as the allowlist: a year nothing measures against
      // is a rule that never runs.
      const unused = ALLOWED_YEARS.filter((year) => !scan.usedYears.has(year));
      expect(unused).toEqual([]);
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

    it('reports a name written in a script other than Latin', () => {
      // `words()` splits on `[^A-Za-z]+`, so a Cyrillic club and city produce
      // no words at all and the allowlist never sees them. Only a rule that
      // does not go through `words()` can report this.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'game_change_log.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[4] = '\u0414\u0438\u043d\u0430\u043c\u043e \u041a\u0438\u0435\u0432 fixture';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden.map((hit) => hit.word)).toContainEqual(
        expect.stringContaining('non-ascii-letter')
      );
    });

    it('reports a name spelled letter by letter with dots', () => {
      // Every identity-bearing letter here is a one-character token, so the
      // pre-fix `words()` filtered the whole name out and left only `vs` and
      // `fixture` — both allowlisted — behind.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'game_change_log.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[4] = 'S.R.F.C. vs P.R. fixture';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden.map((hit) => hit.word)).toContainEqual(
        expect.stringContaining('initialism')
      );
      // And the collapsed spelling reaches the allowlist as a real word, so
      // the shape check is a backstop rather than the only reader.
      expect(control.unknown.map((hit) => hit.word)).toContain('SRFC');
    });

    it('reports a punctuated organisation designator in a person column', () => {
      // The designator rule is the only content check on the ~4,846 exempt
      // person-name cells, and it is fed by `words()`, so the punctuated form
      // of five of its fifteen entries was invisible to it.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'coach_registration.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[0] = 'Zzqfictional F.C.';
      cells[1] = 'zzqfictional f.c.';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      // Caught at the root, by the rule that was always meant to see it...
      expect(control.orgInPersonColumn.map((hit) => hit.word)).toContain('FC');
      // ...and independently by the list-free shape, in both letter cases.
      const initialisms = control.forbidden.filter((hit) => hit.word.includes('initialism'));
      expect(initialisms.map((hit) => hit.column).sort()).toEqual(['coach_name', 'person_key']);
    });

    it('reports an email address in a person-name column', () => {
      // No organisation designator, no unknown word, no letters the allowlist
      // would object to — the exemption covers all of that. Only a shape check
      // that ignores the exemption can see this.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'coach_registration.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[0] = 'zzq@zzqfictional.example';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden.map((hit) => hit.word)).toContainEqual(
        expect.stringContaining('email')
      );
    });

    it('reports a date of birth in a person-name column', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'player_registration.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[0] = '2011-03-14';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden.map((hit) => hit.word)).toContainEqual(
        expect.stringContaining('iso-date')
      );
    });

    // One control per shape per sample, generated from the shape table itself,
    // so a shape added without a control cannot exist: the sample is required
    // above, and every sample is planted here. This is what `url-host`,
    // `slash-date` and `dot-date` had none of, and what the phone shape had
    // only for the one format it could already see.
    it.each(
      [...FORBIDDEN_PATTERNS, ...DATE_SHAPES].flatMap(({ name, samples }) =>
        samples.map((sample) => [name, sample])
      )
    )('reports %s written as %s', (name, sample) => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'field_inventory.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[1] = `${text[1]} ${sample}`;
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden.map((hit) => hit.word)).toContainEqual(
        expect.stringContaining(`${name}: `)
      );
    });

    it('reports a phone number in a person-name column, which the allowlist cannot see', () => {
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'coach_registration.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      const cells = text[1].split(',');
      cells[0] = 'Toby Hart (925) 555-0134';
      text[1] = cells.join(',');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden.map((hit) => hit.word)).toContainEqual(
        expect.stringContaining('phone')
      );
    });

    it('reads a date on the allowed-year list without reporting it', () => {
      // The other half of the year gate: it must discriminate, not merely
      // fire. The date is read — `datesChecked` rises — and passes.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'field_inventory.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[1] = `${text[1]}2026-08-22`;
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(control.forbidden).toEqual([]);
      expect(control.usedYears.has('2026')).toBe(true);
      expect(control.datesChecked).toBeGreaterThan(scan.datesChecked);
    });

    it('reports an allowed year the corpus never uses', () => {
      // The no-padding rule on ALLOWED_YEARS, shown able to fail: a corpus
      // with no dates in it leaves every allowed year unused.
      const root = mkdtempSync(path.join(tmpdir(), 'sl-corpus-'));
      scratchRoots.push(root);
      writeFileSync(path.join(root, 'sheet.csv'), 'venue,note\nAlder Park,practice\n');

      const control = scanCorpus(root);
      expect(control.datesChecked).toBe(0);
      const unused = ALLOWED_YEARS.filter((year) => !control.usedYears.has(year));
      expect(unused).toEqual([...ALLOWED_YEARS]);
    });

    it('reports an unknown word in a directory name', () => {
      const root = scratchCorpus();
      mkdirSync(path.join(root, 'zzqfictional_exports'));
      writeFileSync(
        path.join(root, 'zzqfictional_exports', 'sheet.csv'),
        'venue,note\nAlder Park,practice\n'
      );

      const control = scanCorpus(root);
      const hits = control.unknown.filter((hit) => hit.word === 'zzqfictional');
      expect(hits.length).toBeGreaterThan(0);
      // Every hit came from the path check, not from a cell: the contents are
      // fully allowlisted, so only the directory's own name can have failed.
      expect(hits.every((hit) => hit.column === '(path)')).toBe(true);
    });

    it('reports an unknown word in a file name', () => {
      const root = scratchCorpus();
      writeFileSync(
        path.join(root, 'practice', 'zzqfictional_fc_roster.csv'),
        'venue,note\nAlder Park,practice\n'
      );

      const control = scanCorpus(root);
      const hits = control.unknown.filter((hit) => hit.word === 'zzqfictional');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((hit) => hit.column === '(path)')).toBe(true);
    });

    it.each([['README.md'], ['practice/README.md']])(
      'reports a leak written into the prose of %s',
      (proseFile) => {
        // The excluded files are the two most likely to describe the real
        // season in sentences, and the exclusion once covered every rule
        // rather than only the allowlist.
        const root = scratchCorpus();
        const target = path.join(root, proseFile);
        writeFileSync(
          target,
          `${readFileSync(target, 'utf8')}\nContact zzq@zzqfictional.example or (925) 555-0134.\n`
        );

        const control = scanCorpus(root);
        const words = control.forbidden
          .filter((hit) => hit.file === proseFile)
          .map((hit) => hit.word);
        expect(words).toContainEqual(expect.stringContaining('email'));
        expect(words).toContainEqual(expect.stringContaining('phone'));
      }
    );

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

    it('keeps a person exemption when the header carries stray whitespace', () => {
      // Trimming the declared headers but not the parse keys made this header
      // un-exempt a person column: 4,598 spurious unknown words and 460 fewer
      // person cells scanned, with the real diagnosis buried under them.
      const root = scratchCorpus();
      const target = path.join(root, 'practice', 'player_registration.csv');
      const text = readFileSync(target, 'utf8').split('\n');
      text[0] = text[0].replace('player_name,player_key', 'player_name , player_key');
      writeFileSync(target, text.join('\n'));

      const control = scanCorpus(root);
      expect(render(control.unknown)).toEqual([]);
      expect(control.columnsNotReturned).toEqual([]);
      expect(control.columnsNotDeclared).toEqual([]);
      expect(control.exemptedColumnsMissing).toEqual([]);
      expect(control.personCellsScanned).toBe(scan.personCellsScanned);
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
