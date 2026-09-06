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
  // `\p{M}` beside `\p{L}`, because a decomposed name is letters plus
  // combining marks and a stray mark composes with nothing. Measured: the NFD
  // form of a name with a diaeresis carried no `\p{L}` outside ASCII at all, so
  // the guard read it as clean. Inputs are normalised to NFC before scanning
  // (see `findIdentityShapes`); this is the second line of defence for a mark
  // that has no precomposed form to normalise into.
  Object.freeze({
    name: 'non-ascii-letter',
    pattern: /(?!\p{ASCII})[\p{L}\p{M}]/u,
    samples: Object.freeze(['\u0414\u0438\u043d\u0430\u043c\u043e', 'e\u0308']),
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
 * Ordinary English abbreviations that the `initialism` shape cannot tell from a
 * club acronym.
 *
 * `/(?:[A-Za-z]\.){2,}/` matches `p.m.` exactly as it matches `S.R.F.C.`, and
 * that is correct for the corpus - which contains neither - but wrong for prose
 * a person types into a form. "closed after 6 p.m." is the most ordinary
 * sentence an operator could write about a blackout, and refusing it with a
 * message about personal data is a false accusation that teaches people to work
 * around the guard.
 *
 * **This list narrows nothing for the corpus scanner.**
 * `tests/season2026CorpusVocabulary.test.js` reads {@link IDENTITY_SHAPES}
 * directly and never calls {@link findIdentityShapes}, so the corpus keeps the
 * strictest reading. Only a caller that asks for it - the blackout note - gets
 * the narrower one, and it asks explicitly.
 *
 * Deliberately short and specific. Every entry is a fixed lowercase token with
 * no letters beyond the ones shown, so it cannot swallow a real acronym: `U.S.`
 * is here, `U.S.C.` is not and still trips the shape.
 */
export const COMMON_ABBREVIATIONS = Object.freeze([
  'a.m.',
  'p.m.',
  'e.g.',
  'i.e.',
  'etc.',
  'u.s.',
  'no.',
]);

/**
 * Is this character part of a word, for the purpose of token boundaries?
 *
 * ASCII letters and the dot. No regular expression, because the whole point of
 * the scan below is that this module builds no pattern from a value.
 *
 * @param {string|undefined} character
 * @returns {boolean}
 */
function isLetterOrDot(character) {
  if (character === undefined) return false;
  if (character === '.') return true;
  return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z');
}

/**
 * The abbreviations, longest first, lowercased once.
 *
 * Longest first so a shorter entry cannot shadow a longer one that it prefixes.
 */
const ABBREVIATIONS_BY_LENGTH = Object.freeze(
  [...COMMON_ABBREVIATIONS].sort((a, b) => b.length - a.length).map((entry) => entry.toLowerCase())
);

/**
 * Remove the abbreviations above, so what is left can be tested for shapes.
 *
 * **A scan, not a pattern.** The first version built a `RegExp` per abbreviation
 * with `abbreviation.replace(/\./g, '\\.')`, which escapes the dot and nothing
 * else - not the backslash, not `(`, `+`, `?` or `[`. CodeQL flagged it high and
 * was right to, but the reason to fix it properly is not the exploit:
 *
 * - This runs **only** on the `allowCommonAbbreviations` path, which is the
 *   blackout-note PII guard. A mis-built pattern strips text *before*
 *   {@link findIdentityShapes} scans it, so the guard would return "clean"
 *   having examined less than it claims - the hollow-guarantee shape in the one
 *   module where it costs the most, and nothing would announce the narrowing.
 * - {@link COMMON_ABBREVIATIONS} is exported and meant to grow. The realistic
 *   route to the defect is not an attacker but someone adding `no.(rev.)` and
 *   getting a pattern that matches the wrong thing or throws at module load.
 *
 * The abbreviations are a fixed list of literals, so finding them needs no
 * pattern at all. Scanning by index removes the class rather than guarding
 * against it, which is the move `blankCellMessage()` made in 8.3: build from
 * the input, so the failure mode stops existing.
 *
 * **Whole-token only**: an abbreviation is removed when neither the character
 * before it nor the character after it is a letter or a dot, so the `p.m.`
 * inside `Xp.m.` and the one inside `S.p.m.C.` are both left exactly where an
 * identity shape can still see them.
 *
 * @param {string} text
 * @param {ReadonlyArray<string>} [abbreviations] - defaults to the frozen list;
 *   a parameter so a test can prove the scan against entries the exported
 *   constant must never carry
 * @returns {string}
 */
export function withoutCommonAbbreviations(text, abbreviations = ABBREVIATIONS_BY_LENGTH) {
  const source = String(text ?? '');
  const ordered =
    abbreviations === ABBREVIATIONS_BY_LENGTH
      ? abbreviations
      : [...abbreviations].sort((a, b) => b.length - a.length).map((entry) => entry.toLowerCase());

  let kept = '';
  let index = 0;
  while (index < source.length) {
    const startsToken = !isLetterOrDot(source[index - 1]);
    // **The candidate slice is lowercased, never the whole string.**
    //
    // The first version of this scan pre-computed `source.toLowerCase()` and
    // indexed into it with offsets taken from `source`. `String.toLowerCase()`
    // can change length - `\u0130` (Latin capital I with dot above) lowercases
    // to two code units - so a single such character anywhere earlier in the
    // note slid every subsequent offset, and the scan then compared the wrong
    // positions. Measured: `"\u0130\u0130\u0130 p.m."` kept its `p.m.`
    // entirely. That instance failed safe, but the general shape does not - a
    // misaligned match strips characters that are not the abbreviation, and
    // this runs *before* the identity scan, so it could break an address or a
    // phone number apart until no shape matched it.
    //
    // Comparing a slice of `source` keeps the indices exact by construction. A
    // slice whose lowercase form changes length simply fails the comparison,
    // which is the safe direction.
    const matched = startsToken
      ? ordered.find(
          (abbreviation) =>
            abbreviation.length > 0 &&
            source.slice(index, index + abbreviation.length).toLowerCase() === abbreviation &&
            !isLetterOrDot(source[index + abbreviation.length])
        )
      : undefined;
    if (matched !== undefined) {
      index += matched.length;
      continue;
    }
    kept += source[index];
    index += 1;
  }
  return kept;
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
 * @param {{ allowCommonAbbreviations?: boolean }} [options] - set by the
 *   blackout-note path only; the corpus scanner never passes it
 * @returns {Array<{ shape: string, match: string }>}
 */
export function findIdentityShapes(text, options = {}) {
  // **Normalised before anything looks at it.** A name written in NFD is
  // letters plus combining marks, and `\p{L}` matches neither the base letter
  // as non-ASCII nor the mark - measured: the NFC form of a name carrying a
  // diaeresis was refused and the NFD form of the *same string* was accepted.
  // One normal form, chosen at the door, so a caller cannot pick the spelling
  // that gets through. NFC and not NFKC: NFC composes marks, which is the
  // hole; NFKC also folds compatibility forms, which would change values the
  // guard is not there to change.
  const raw = String(text ?? '').normalize('NFC');

  // **Only the initialism verdict may be narrowed, and every other shape is
  // judged on the untouched text.**
  //
  // The narrowed path used to scan the *stripped* string for everything, so
  // removing an abbreviation could remove a shape with it. Measured:
  // `u.s.@mail.internal` tripped `email` on the strict path and nothing on the
  // narrowed one, because stripping `u.s.` left `@mail.internal`, which is not
  // an address. Tuning the boundary rule would have closed that instance and
  // left the class; scanning the raw text for every shape but the initialism
  // makes "the narrowing never hides a shape" true **by construction**, which
  // is what `tests/fieldAdminChangeSet.test.js` asserts exhaustively over
  // adjacency.
  const hits = scanIdentityShapes(raw);
  if (!options.allowCommonAbbreviations) return hits;
  const strippedHasInitialism = scanIdentityShapes(withoutCommonAbbreviations(raw)).some(
    (hit) => hit.shape === 'initialism'
  );
  return strippedHasInitialism ? hits : hits.filter((hit) => hit.shape !== 'initialism');
}

/**
 * Every shape a string matches, with no narrowing of any kind.
 *
 * @param {string} value - already normalised by the caller
 * @returns {Array<{ shape: string, match: string }>}
 */
function scanIdentityShapes(value) {
  /** @type {Array<{ shape: string, match: string }>} */
  const hits = [];
  for (const { name, pattern } of IDENTITY_SHAPES) {
    // **The declared pattern, used directly.** This used to rebuild a scanner
    // as `new RegExp(pattern.source, pattern.flags.replace('g', ''))` to strip
    // a `g` flag that would leak `lastIndex` between calls. That was a second
    // pattern built from a value in a module whose whole job is to be
    // trustworthy, so the flag is forbidden at the source instead - see the
    // module-load check below - and there is now nothing to rebuild. This
    // module constructs no `RegExp` from any value at all.
    const hit = value.match(pattern);
    if (hit) hits.push({ shape: name, match: hit[0] });
  }
  return hits;
}

/**
 * **No declared shape may be global**, checked at module load.
 *
 * `String.prototype.match` with a `g` pattern returns every match rather than a
 * match object, and a `g` pattern shared across calls carries `lastIndex`
 * between them - so a global entry here would make {@link findIdentityShapes}
 * report the wrong text, or intermittently report nothing at all. Throwing on
 * load makes that impossible to add quietly; the alternative was rebuilding
 * every pattern on every call, which is the construction this module has just
 * removed.
 */
for (const { name, pattern } of IDENTITY_SHAPES) {
  if (pattern.global) {
    throw new Error(
      `privacy/textShapes: the "${name}" shape carries the g flag; identity shapes are matched one at a time and must not be global`
    );
  }
}
