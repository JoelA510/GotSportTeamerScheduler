/**
 * Machine-readable vocabulary for external fixture import — Prompt 7.3.
 *
 * The same two rules as the thirteen modules before it:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * ## The four enums this file declares, and why none of them is a boolean
 *
 * - {@link EXTERNAL_NAME_RESOLUTION} — did a mapping turn one foreign label into
 *   one of our ids? Three values. `unresolved` and `ambiguous` are different
 *   facts about the registry and an operator fixes them differently: the first
 *   needs a record written, the second needs one deleted.
 * - {@link EXTERNAL_ROW_CLASS} — what did one imported row turn out to be
 *   against the schedule we hold? **Four** values, because
 *   matched/differing/unmatched cannot express *"this row could not be judged at
 *   all"*, and the place that answer goes when the enum has no room for it is
 *   `matched`.
 * - {@link EXTERNAL_IMPACT_VERDICT} — would accepting a stated set of rows break
 *   something? Three values. `undetermined` exists because
 *   `bookingsOverlapInTime()` returns `null` for an unknown footprint and
 *   **`null` is not `false`** — the failure this repository has now reproduced
 *   four times (`docs/BUILD_PLAN_STATUS.md` §4).
 * - {@link EXTERNAL_IMPORT_REASON} / {@link deriveExternalImportStatus} — the
 *   answer's own integrity, in the `allowed` / `compromised` / `rejected`
 *   vocabulary every other module uses. `status` is about *the report*; the
 *   verdict is about *the acceptance set*. They are different questions and this
 *   module never lets one stand in for the other.
 *
 * ## Why the mapping refuses rather than guesses
 *
 * `Alder Park (Back Pitch 2)` is the external league's name for what the club
 * files as `Alder Park` / `Pitch 2`, and a matcher that treats `Back` as
 * decoration gets that right. The same matcher is **wrong at Maplewood**, where
 * `Maplewood Back` and `Maplewood Front` are two separate venues in
 * `facility_geometry.json` that each carry a `Field 1`, and are one complex only
 * for travel (`facility/adapters/season2026Geometry.js`
 * `SEASON_2026_VENUE_COMPLEXES`, which is spelled out for exactly this reason).
 * So there is no normalisation in this module that removes a *word*: a label
 * either has a record or it is reported as {@link EXTERNAL_MAPPING_LABEL_UNRESOLVED},
 * at blocking, naming the label and the venue scope it was looked up in.
 *
 * @module externalImport/reasonCodes
 */

import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  deriveConstraintStatus,
} from '../constraints/reasonCodes.js';

/**
 * How badly a finding counts against a report. Borrowed rather than restated,
 * exactly as `fairness/reasonCodes.js` borrows it.
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_IMPORT_SEVERITY = CONSTRAINT_SEVERITY;

/**
 * The three-state outcome of a **report**.
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_IMPORT_STATUS = CONSTRAINT_STATUS;

/**
 * **Did the mapping turn one foreign label into one of our ids?**
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_NAME_RESOLUTION = Object.freeze({
  /** Exactly one record claims this label, and its target exists. */
  RESOLVED: 'resolved',
  /** No record claims it. Reported, never guessed at. */
  UNRESOLVED: 'unresolved',
  /** More than one record claims it, and they disagree about the target. */
  AMBIGUOUS: 'ambiguous',
});

/**
 * **What one imported row turned out to be, against the schedule we hold.**
 *
 * Four values. The fourth is the whole point: a row whose venue label has no
 * record, or whose match key names two of our fixtures, has not been found to be
 * *unchanged* and has not been found to be *missing* — it has not been judged,
 * and {@link UNDECIDABLE} is where that goes. Folding it into
 * {@link MATCHED_IDENTICAL} is how an import that nobody could read comes back
 * reading "8 rows, all fine".
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_ROW_CLASS = Object.freeze({
  /** One of our fixtures on the key, and every compared field agrees. */
  MATCHED_IDENTICAL: 'matched-identical',
  /** One of our fixtures on the key, and at least one compared field differs. */
  MATCHED_DIFFERING: 'matched-differing',
  /** Nothing of ours on the key. Surfaced with a reason — incident 10. */
  UNMATCHED: 'unmatched',
  /** Could not be judged. Always carries the reason code that decided. */
  UNDECIDABLE: 'undecidable',
});

/**
 * Order for rendering and for reconciling counts. Frozen so a test can assert a
 * partition covers the enum rather than covering the four names it remembered.
 *
 * @type {ReadonlyArray<string>}
 */
export const EXTERNAL_ROW_CLASS_ORDER = Object.freeze([
  EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL,
  EXTERNAL_ROW_CLASS.MATCHED_DIFFERING,
  EXTERNAL_ROW_CLASS.UNMATCHED,
  EXTERNAL_ROW_CLASS.UNDECIDABLE,
]);

/**
 * **Would accepting this set of rows break something?**
 *
 * `undetermined` is not a hedge. The corpus's four `Scrimmage` rows have no
 * `game_formats.csv` timing row (GAP-14), so their occupancy end is `null` and
 * `bookingsOverlapInTime()` answers `null` about every pair one of them is in.
 * An analysis with two verdicts has to put that somewhere, and the somewhere is
 * always `safe`.
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_IMPACT_VERDICT = Object.freeze({
  /** Nothing blocking was introduced, and every pair was decidable. */
  SAFE: 'safe',
  /** Something blocking was introduced. Always carries what, and by how much. */
  UNSAFE: 'unsafe',
  /** At least one pair could not be decided. Never `safe` by omission. */
  UNDETERMINED: 'undetermined',
});

/**
 * Where an avoid window came from. Provenance the recipient needs: a window on
 * `Back Pitch 2` that exists because *Pitch 1A* is in use is a window they
 * cannot explain from anything they can see.
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_AVOID_ORIGIN = Object.freeze({
  /** A booking on the very surface the window is published for. */
  OWN_SURFACE: 'own-surface',
  /** A booking on ground that overlaps it — incident 3's whole mechanism. */
  OVERLAPPING_SURFACE: 'overlapping-surface',
});

/**
 * Every reason code this module can emit.
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_IMPORT_REASON = Object.freeze({
  /* -- the mapping registry ---------------------------------------------- */

  /** No record claims this external label. Never guessed at, never dropped. */
  EXTERNAL_MAPPING_LABEL_UNRESOLVED: 'EXTERNAL_MAPPING_LABEL_UNRESOLVED',
  /** Two records claim one label and disagree about the target. */
  EXTERNAL_MAPPING_LABEL_AMBIGUOUS: 'EXTERNAL_MAPPING_LABEL_AMBIGUOUS',
  /** A record names a surface the facility graph does not have. */
  EXTERNAL_MAPPING_TARGET_UNKNOWN: 'EXTERNAL_MAPPING_TARGET_UNKNOWN',
  /** Two distinct labels normalise onto one key with different targets. */
  EXTERNAL_MAPPING_KEY_COLLISION: 'EXTERNAL_MAPPING_KEY_COLLISION',
  /** A declared record never fired in this run. Stale-table provenance. */
  EXTERNAL_MAPPING_RECORD_UNEXERCISED: 'EXTERNAL_MAPPING_RECORD_UNEXERCISED',
  /** Not one record fired. Incident 4: a lookup that matched nothing. */
  EXTERNAL_MAPPING_REGISTRY_UNEXERCISED: 'EXTERNAL_MAPPING_REGISTRY_UNEXERCISED',
  /** The registry declares no records at all. */
  EXTERNAL_MAPPING_REGISTRY_EMPTY: 'EXTERNAL_MAPPING_REGISTRY_EMPTY',
  /** Stated on every registry: this lives in memory, the store is a seam. */
  EXTERNAL_MAPPING_NOT_PERSISTED: 'EXTERNAL_MAPPING_NOT_PERSISTED',

  /* -- classifying the imported rows -------------------------------------- */

  /** Provenance, with a count: rows that matched with nothing differing. */
  EXTERNAL_ROW_MATCHED: 'EXTERNAL_ROW_MATCHED',
  /** Rows that matched and differ. The magnitude is on each row's evidence. */
  EXTERNAL_ROW_DIFFERS: 'EXTERNAL_ROW_DIFFERS',
  /** One row resolved to no fixture of ours. Per row — incident 10. */
  EXTERNAL_ROW_UNMATCHED: 'EXTERNAL_ROW_UNMATCHED',
  /** One row could not be judged at all. Per row, with what stopped it. */
  EXTERNAL_ROW_UNDECIDABLE: 'EXTERNAL_ROW_UNDECIDABLE',
  /** One row's match key names more than one of our fixtures. */
  EXTERNAL_ROW_KEY_AMBIGUOUS: 'EXTERNAL_ROW_KEY_AMBIGUOUS',
  /** A field one side does not carry. Not compared, and not called equal. */
  EXTERNAL_FIELD_UNCOMPARED: 'EXTERNAL_FIELD_UNCOMPARED',
  /** Zero rows were handed to the classifier. */
  EXTERNAL_IMPORT_NO_ROWS_READ: 'EXTERNAL_IMPORT_NO_ROWS_READ',
  /** Rows arrived and not one reached a decidable class. */
  EXTERNAL_IMPORT_NOTHING_CLASSIFIED: 'EXTERNAL_IMPORT_NOTHING_CLASSIFIED',

  /* -- impact of accepting a stated set ----------------------------------- */

  /** The projection introduces a facility clash that the standing plan has not. */
  EXTERNAL_IMPACT_CLASH_INTRODUCED: 'EXTERNAL_IMPACT_CLASH_INTRODUCED',
  /** The projection removes one. Worth saying; never counted as a licence. */
  EXTERNAL_IMPACT_CLASH_RESOLVED: 'EXTERNAL_IMPACT_CLASH_RESOLVED',
  /** A clash both plans carry. Not this import's doing, and not hidden either. */
  EXTERNAL_IMPACT_CLASH_PREEXISTING: 'EXTERNAL_IMPACT_CLASH_PREEXISTING',
  /** Two bookings on one surface closer than the format's turnover floor. */
  EXTERNAL_IMPACT_TURNOVER_SHORTFALL: 'EXTERNAL_IMPACT_TURNOVER_SHORTFALL',
  /** Two kickoffs on one surface closer than the format's declared block. */
  EXTERNAL_IMPACT_CADENCE_BREACH: 'EXTERNAL_IMPACT_CADENCE_BREACH',
  /** A pair whose overlap could not be decided. `null`, carried as `null`. */
  EXTERNAL_IMPACT_UNDETERMINED: 'EXTERNAL_IMPACT_UNDETERMINED',
  /** Stated on every analysis: which layers were consulted, and which were not. */
  EXTERNAL_IMPACT_SCOPE_STATED: 'EXTERNAL_IMPACT_SCOPE_STATED',
  /** The acceptance set moved no row. Said, rather than read as "all clear". */
  EXTERNAL_IMPACT_NOTHING_PROJECTED: 'EXTERNAL_IMPACT_NOTHING_PROJECTED',
  /** The projection compared no pair of bookings. Incident 4 in one code. */
  EXTERNAL_IMPACT_NOTHING_EXAMINED: 'EXTERNAL_IMPACT_NOTHING_EXAMINED',
  /** A row was accepted that resolved to nothing acceptable. */
  EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE: 'EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE',
  /** A subset of this set is unsafe. A whole-import verdict does not transfer. */
  EXTERNAL_ACCEPTANCE_SUBSET_UNSAFE: 'EXTERNAL_ACCEPTANCE_SUBSET_UNSAFE',
  /** The sweep did not examine all 2^n sets. Says how many, and why. */
  EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE: 'EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE',

  /* -- the avoid-windows export and its round trip ------------------------ */

  /** A surface in the export scope has no external label. Not exported as ours. */
  EXTERNAL_AVOID_LABEL_UNMAPPED: 'EXTERNAL_AVOID_LABEL_UNMAPPED',
  /** Two external labels claim one surface; the reverse direction is ambiguous. */
  EXTERNAL_AVOID_LABEL_AMBIGUOUS: 'EXTERNAL_AVOID_LABEL_AMBIGUOUS',
  /** A window with no known end. Carried open, never closed by a guess. */
  EXTERNAL_AVOID_END_UNKNOWN: 'EXTERNAL_AVOID_END_UNKNOWN',
  /** Provenance: this window exists because overlapping ground is in use. */
  EXTERNAL_AVOID_WINDOW_FROM_OVERLAP: 'EXTERNAL_AVOID_WINDOW_FROM_OVERLAP',
  /** The export covered no date or no surface. */
  EXTERNAL_AVOID_SCOPE_EMPTY: 'EXTERNAL_AVOID_SCOPE_EMPTY',
  /** A non-empty scope produced no window at all. */
  EXTERNAL_AVOID_NONE_EXPORTED: 'EXTERNAL_AVOID_NONE_EXPORTED',
  /** Reading the document back did not reproduce the windows it was built from. */
  EXTERNAL_AVOID_ROUNDTRIP_DIVERGED: 'EXTERNAL_AVOID_ROUNDTRIP_DIVERGED',
});

/**
 * Severity of every reason code. One row per member of
 * {@link EXTERNAL_IMPORT_REASON}, checked by a test that walks the enum.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const EXTERNAL_IMPORT_REASON_SEVERITY = Object.freeze({
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_AMBIGUOUS]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_TARGET_UNKNOWN]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_KEY_COLLISION]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_RECORD_UNEXERCISED]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_REGISTRY_UNEXERCISED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_REGISTRY_EMPTY]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_NOT_PERSISTED]: EXTERNAL_IMPORT_SEVERITY.INFO,

  [EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_MATCHED]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_DIFFERS]: EXTERNAL_IMPORT_SEVERITY.COMPROMISE,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNMATCHED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNDECIDABLE]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_KEY_AMBIGUOUS]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED]: EXTERNAL_IMPORT_SEVERITY.COMPROMISE,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPORT_NO_ROWS_READ]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPORT_NOTHING_CLASSIFIED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,

  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_INTRODUCED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_RESOLVED]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_PREEXISTING]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_TURNOVER_SHORTFALL]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CADENCE_BREACH]: EXTERNAL_IMPORT_SEVERITY.COMPROMISE,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_UNDETERMINED]: EXTERNAL_IMPORT_SEVERITY.COMPROMISE,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SCOPE_STATED]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_EXAMINED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE]:
    EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SUBSET_UNSAFE]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE]: EXTERNAL_IMPORT_SEVERITY.INFO,

  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_UNMAPPED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_AMBIGUOUS]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_END_UNKNOWN]: EXTERNAL_IMPORT_SEVERITY.COMPROMISE,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_WINDOW_FROM_OVERLAP]: EXTERNAL_IMPORT_SEVERITY.INFO,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_SCOPE_EMPTY]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_NONE_EXPORTED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
  [EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_ROUNDTRIP_DIVERGED]: EXTERNAL_IMPORT_SEVERITY.BLOCKING,
});

/**
 * **The reason code a {@link EXTERNAL_NAME_RESOLUTION} state raises.** One row
 * per member of the enum, and {@link nameResolutionFinding} is its only reader.
 *
 * The table exists for the reason `fairness/reasonCodes.js`'s
 * `FAIRNESS_DISPERSION_REASON` and `feasibility/reasonCodes.js`'s
 * `FEASIBILITY_SEVERITY_EFFECT` exist: the alternative is a chain of `if`s that
 * has to be extended, correctly, at every call site, every time the enum grows.
 * `resolved` maps to `null` because a lookup that worked announces nothing.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
export const EXTERNAL_NAME_RESOLUTION_REASON = Object.freeze({
  [EXTERNAL_NAME_RESOLUTION.RESOLVED]: null,
  [EXTERNAL_NAME_RESOLUTION.UNRESOLVED]: EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED,
  [EXTERNAL_NAME_RESOLUTION.AMBIGUOUS]: EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_AMBIGUOUS,
});

/**
 * Severity of an external-import reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason the thirteen modules before it do: a code with no severity is a code
 * somebody forgot to register, and a default would make it silently harmless.
 *
 * @param {string} code
 * @returns {string} an {@link EXTERNAL_IMPORT_SEVERITY} value
 */
export function externalImportSeverityOf(code) {
  const severity = EXTERNAL_IMPORT_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`externalImport: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * Build a finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - an {@link EXTERNAL_IMPORT_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives, ids and counts
 * @returns {import('./types.js').ExternalImportFinding}
 */
export function makeExternalImportFinding(code, message, details = {}) {
  return { code, severity: externalImportSeverityOf(code), message, details };
}

/**
 * **Every finding this module emits, checked against the table that owns it.**
 *
 * Run over the composed list of every sealed result, so the property is "this
 * module cannot emit an unregistered finding" rather than "these codes happen to
 * be registered". Adopted from `fairness/reasonCodes.js#assertFairnessFindings`
 * and `feasibility/reasonCodes.js#assertFeasibilityFindings`, which exist
 * because a foreign finding forwarded in from another module once left a package
 * pretending to be one of its own — and this module reads findings out of
 * `facility/` on every impact analysis, so it is the shape most exposed to it.
 *
 * @param {ReadonlyArray<import('./types.js').ExternalImportFinding>} findings
 * @param {string} [subject] - named in the failure, so it says which result
 * @returns {ReadonlyArray<import('./types.js').ExternalImportFinding>} the same list
 */
export function assertExternalImportFindings(findings, subject = 'a result') {
  for (const finding of findings) {
    const severity = externalImportSeverityOf(finding.code);
    if (finding.severity !== severity) {
      throw new Error(
        `externalImport: ${subject} carries "${finding.code}" at severity ${JSON.stringify(finding.severity)}, but the frozen table registers it as "${severity}"`
      );
    }
  }
  return findings;
}

/**
 * Derive the status of a **result** mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').ExternalImportFinding>} findings
 * @returns {string} an {@link EXTERNAL_IMPORT_STATUS} value
 */
export function deriveExternalImportStatus(findings) {
  return deriveConstraintStatus(
    /** @type {ReadonlyArray<import('../constraints/types.js').ConstraintFinding>} */ (findings)
  );
}

/**
 * **The only producer of an {@link EXTERNAL_IMPACT_VERDICT}.**
 *
 * Mechanical, from two facts the analysis publishes and nothing else:
 *
 * - any pair the overlap test could not decide -> `undetermined`;
 * - otherwise any *introduced* blocking finding -> `unsafe`;
 * - otherwise `safe`.
 *
 * The precedence is deliberate and is the opposite of convenient. A projection
 * that both introduces a clash *and* leaves a pair undecided is `undetermined`,
 * not `unsafe`: `unsafe` would read as a complete account of what is wrong, and
 * it would not be one. `deriveExternalImportStatus()` still carries the blocking
 * findings, so nothing is lost — the two answers are about different questions,
 * which is why this module has both.
 *
 * `preexisting` findings never move a verdict. A clash both plans carry is not
 * this import's doing, and an import that inherits one must not be blocked by
 * it — the minimal-diff discipline `CLAUDE.md` §3 states. It is reported at
 * `info` so it is visible rather than suppressed.
 *
 * @param {Object} input
 * @param {number} input.undecidablePairs - pairs `bookingsOverlapInTime()` answered `null` about
 * @param {ReadonlyArray<import('./types.js').ExternalImportFinding>} input.introduced
 * @returns {string} an {@link EXTERNAL_IMPACT_VERDICT} value
 */
export function deriveExternalImpactVerdict({ undecidablePairs, introduced }) {
  if (!Number.isInteger(undecidablePairs) || undecidablePairs < 0) {
    throw new TypeError(
      `externalImport: undecidablePairs must be a non-negative integer, got ${JSON.stringify(undecidablePairs)}`
    );
  }
  if (undecidablePairs > 0) return EXTERNAL_IMPACT_VERDICT.UNDETERMINED;
  const blocking = introduced.some(
    (finding) => externalImportSeverityOf(finding.code) === EXTERNAL_IMPORT_SEVERITY.BLOCKING
  );
  return blocking ? EXTERNAL_IMPACT_VERDICT.UNSAFE : EXTERNAL_IMPACT_VERDICT.SAFE;
}

/**
 * The finding a name resolution raises, or `null` when it resolved.
 *
 * @param {import('./types.js').ExternalNameResolution} resolution
 * @returns {import('./types.js').ExternalImportFinding|null}
 */
export function nameResolutionFinding(resolution) {
  const code = EXTERNAL_NAME_RESOLUTION_REASON[resolution.state];
  if (code === undefined) {
    throw new Error(
      `externalImport: resolution state ${JSON.stringify(resolution.state)} has no row in EXTERNAL_NAME_RESOLUTION_REASON`
    );
  }
  if (code === null) return null;
  const messages = {
    [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED]: `no mapping record claims the ${resolution.kind} label ${JSON.stringify(resolution.label)}; it is reported rather than guessed at, because a matcher loose enough to resolve it would also merge "Maplewood Back" with "Maplewood Front"`,
    [EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_AMBIGUOUS]: `${resolution.candidateRecordIds.length} mapping records claim the ${resolution.kind} label ${JSON.stringify(resolution.label)} and name different targets (${resolution.candidateTargets.join(', ')}); one of them has to go`,
  };
  return makeExternalImportFinding(code, messages[code], {
    kind: resolution.kind,
    label: resolution.label,
    normalisedKey: resolution.normalisedKey,
    recordIds: resolution.candidateRecordIds,
    targets: resolution.candidateTargets,
  });
}

/**
 * Fresh zeroed counters.
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator whose join
 * matched zero records and reported a perfect score. Every one of these is
 * additive, so a per-set result folds into a per-report one without any of them
 * meaning something different at the two scales, and the `assert*Exercised()`
 * guards turn the zeroes into **blocking** findings rather than into silence.
 *
 * @returns {import('./types.js').ExternalImportMeta}
 */
export function createExternalImportMeta() {
  return {
    /** Mapping records declared in the registry handed to this run. */
    mappingRecordsDeclared: 0,
    /** Distinct records that resolved at least one label in this run. */
    mappingRecordsExercised: 0,
    /** Label lookups performed, of every outcome. */
    labelLookups: 0,
    /** Lookups that produced one target. */
    labelsResolved: 0,
    /**
     * Lookups no record claimed **where a record was required** — every venue
     * label an import brings. A row carrying one of these is `undecidable`.
     */
    labelsUnresolved: 0,
    /**
     * Lookups no record claimed where one was **optional** — a participant
     * label, which falls back to the label itself.
     *
     * Counted apart from {@link labelsUnresolved} on purpose. Folding the two
     * together made the season corpus report 16 unresolved labels for a run in
     * which every required lookup resolved, because both sides of all eight rows
     * are spelled identically in the two artifacts and no participant record is
     * needed. A counter that cannot tell "the mapping failed" from "the mapping
     * was not needed" is a counter an operator has to ignore.
     */
    labelsUnclaimedOptional: 0,
    /** Lookups more than one record claimed, disagreeing. */
    labelsAmbiguous: 0,

    /** External rows handed to the classifier. */
    rowsRead: 0,
    /** Rows that reached a class — every row does, by construction. */
    rowsClassified: 0,
    /** Rows in each of the four classes. */
    rowsMatchedIdentical: 0,
    rowsMatchedDiffering: 0,
    rowsUnmatched: 0,
    rowsUndecidable: 0,
    /** Field comparisons actually performed (both sides carried the field). */
    fieldComparisons: 0,
    /** Field/row pairs skipped because one side does not carry the field. */
    fieldsUncompared: 0,

    /** Acceptance sets evaluated. */
    acceptanceSetsExamined: 0,
    /** Rows whose acceptance changed a projected fixture. */
    fixturesProjected: 0,
    /** Booking pairs the overlap test was asked about. */
    bookingPairsCompared: 0,
    /** Pairs it answered `null` about. Never folded into "no clash". */
    bookingPairsUndecidable: 0,
    /** Blocking findings present after and not before. */
    clashesIntroduced: 0,
    /** Present before and not after. */
    clashesResolved: 0,
    /** Present in both. */
    clashesPreexisting: 0,

    /** (date, external label) pairs the export was asked for. */
    avoidScopeCells: 0,
    /** Windows emitted. */
    avoidWindowsExported: 0,
    /** Windows that exist only because overlapping ground is in use. */
    avoidWindowsFromOverlap: 0,
    /** Windows carried with no known end. */
    avoidWindowsOpenEnded: 0,
    /** Windows read back out of a document. */
    avoidWindowsReadBack: 0,
  };
}

/**
 * Fold one set of counters into another, in place.
 *
 * @param {import('./types.js').ExternalImportMeta} target
 * @param {import('./types.js').ExternalImportMeta} source
 * @returns {import('./types.js').ExternalImportMeta} `target`
 */
export function mergeExternalImportMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
