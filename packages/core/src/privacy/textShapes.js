/**
 * Shapes that carry identity **without using a letter**.
 *
 * These were written for `tests/season2026CorpusVocabulary.test.js`, whose
 * allowlist can only see alphabetic words of two or more letters. An email
 * address, a phone number, a date of birth, a name in another script and a
 * club acronym spelled letter by letter with dots are all invisible to a
 * word-based rule, and the corpus README records three review rounds each
 * finding a class the round before could not see.
 *
 * Phase 8.4 needs the same rules on a second subject: a blackout's optional
 * free-text note is admin-writable, organisation-scoped and durable, which is
 * exactly where a family's name lands ("closed for the Hendricks memorial").
 * `CLAUDE.md` §2 makes that out of scope, so the note is validated against
 * these shapes before it is accepted.
 *
 * **One producer, deliberately.** The alternative was a second copy of the
 * table beside a test asserting the two agree — a reconciliation that drifts
 * the moment someone strengthens one side, which is the shape
 * `docs/BUILD_PLAN_STATUS.md` §4 records under "a single producer for any
 * derived status". So the table lives here and both callers import it.
 *
 * The module is pure: frozen regular expressions and two string functions. It
 * reads nothing, constructs no `Date`, and knows nothing about the corpus, the
 * database or React.
 *
 * **What these rules do not do.** They recognise identity that has a *shape*.
 * A plain given name and surname trips none of them, and neither does a club
 * name written in ordinary words — the corpus guard covers that class with an
 * allowlist, and `fieldAdmin/` covers it by keeping the structured half of a
 * reason in an enum rather than in prose. Read this as the shapes that are
 * known, not as the failures that exist.
 *
 * @module privacy/textShapes
 */

/**
 * The shapes, each with samples that prove it both reads and rejects.
 *
 * Every entry was measured against the season-2026 corpus before being added:
 * the corpus holds no `@`, no `://`, no host-shaped dotted token, no grouped
 * phone number, no run of five or more digits, no letter outside ASCII and no
 * dotted initialism. So any of these matching anything at all is new data
 * rather than an existing value the rule mis-reads.
 *
 * `samples` is load-bearing rather than documentation: both callers generate
 * their positive controls from it, so a shape cannot be declared without being
 * proved. A shape added here with no sample fails
 * `tests/season2026CorpusVocabulary.test.js`.
 *
 * @type {ReadonlyArray<{ name: string, pattern: RegExp, samples: ReadonlyArray<string> }>}
 */
export const IDENTITY_SHAPES = Object.freeze([
  Object.freeze({
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/,
    samples: Object.freeze(['zzq@zzqfictional.example']),
  }),
  Object.freeze({
    name: 'url-scheme',
    pattern: /[A-Za-z][A-Za-z0-9+.-]*:\/\//,
    samples: Object.freeze(['https://zzqfictional.example']),
  }),
  Object.freeze({
    name: 'url-host',
    pattern: /\b[A-Za-z0-9-]+\.(?:com|net|org|edu|gov|io|co|us|uk|info|biz)\b/i,
    samples: Object.freeze(['zzqfictional.com']),
  }),
  // A separator after the area code was once mandatory, which let the single
  // most common North-American spelling - `(925) 555-0134` - match neither this
  // shape nor `digit-run`, whose longest run in it is four. The parenthesised
  // area code, the optional country prefix and optional separators are all in
  // now; measured at 0 matches across the corpus and both READMEs.
  Object.freeze({
    name: 'phone',
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/,
    samples: Object.freeze([
      '(925) 555-0134',
      '(925)555-0134',
      '+1 (925) 555-0134',
      '925-555-0134',
    ]),
  }),
  Object.freeze({
    name: 'digit-run',
    pattern: /\d{5,}/,
    samples: Object.freeze(['1234567']),
  }),
  // The corpus is ASCII by construction - measured at 0 non-ASCII letters
  // across all 22 scanned files and both READMEs - so any letter outside ASCII
  // is new data. Letters only, deliberately: the corpus and its prose carry 45
  // non-ASCII *punctuation* marks (em dashes, arrows, the less-than-or-equal
  // sign) that are not names.
  Object.freeze({
    name: 'non-ascii-letter',
    pattern: /(?!\p{ASCII})\p{L}/u,
    samples: Object.freeze(['\u0414\u0438\u043d\u0430\u043c\u043e']),
  }),
  // A dotted initialism is the letter-by-letter spelling a word split throws
  // away. Case-insensitive and with no exception list, which the corpus
  // affords: it holds no dotted initialism at all, in data or in prose. Only
  // *single* letters count, so `St.` and `Ave.` are not initialisms and do not
  // match.
  Object.freeze({
    name: 'initialism',
    pattern: /(?:[A-Za-z]\.){2,}/,
    samples: Object.freeze(['S.R.F.C.']),
  }),
]);

/** Every shape name, in declaration order. */
export const IDENTITY_SHAPE_NAMES = Object.freeze(IDENTITY_SHAPES.map((shape) => shape.name));

/**
 * Collapse dotted initialisms so a letter-by-letter spelling survives a word
 * split.
 *
 * Applied to the shared feeder rather than to each rule: the corpus guard's
 * third review round found that a punctuated initialism was discarded and the
 * token vanished before any rule saw it - from the allowlist, and from the
 * organisation-designator rule that is the *only* content check on the exempt
 * person-name columns.
 *
 * A no-op on the corpus as it stands: 0 dotted initialisms in 22 scanned files.
 *
 * @param {string} text
 * @returns {string}
 */
export function collapseInitialisms(text) {
  return String(text ?? '').replace(/(?:[A-Za-z]\.){2,}/g, (run) => run.replace(/\./g, ''));
}

/**
 * Alphabetic words of two or more letters in a string, with dotted initialisms
 * collapsed first so `F.C.` reads as the word `FC` rather than as nothing.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return collapseInitialisms(text)
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length >= 2);
}

/**
 * Every identity shape a string matches, with what matched.
 *
 * Returns **all** hits rather than the first, so a caller reporting a rejected
 * value can say everything wrong with it in one pass instead of one shape per
 * round trip. An empty array is the only "clean" answer; there is no boolean,
 * because a boolean invites `if (!clean) throw` with nothing to tell the
 * operator about what tripped.
 *
 * @param {string} text
 * @returns {Array<{ shape: string, match: string }>}
 */
export function findIdentityShapes(text) {
  const value = String(text ?? '');
  /** @type {Array<{ shape: string, match: string }>} */
  const hits = [];
  for (const { name, pattern } of IDENTITY_SHAPES) {
    // A fresh RegExp per test: the declared patterns are shared, and a `g` flag
    // added to one later would otherwise make `lastIndex` leak between calls.
    const scanner = new RegExp(pattern.source, pattern.flags.replace('g', ''));
    const hit = value.match(scanner);
    if (hit) hits.push({ shape: name, match: hit[0] });
  }
  return hits;
}
