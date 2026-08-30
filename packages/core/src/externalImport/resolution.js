/**
 * Resolution classification: what one foreign publication turns out to be,
 * against the schedule we hold.
 *
 * ## Four classes, not three
 *
 * `matched-identical` / `matched-differing` / `unmatched` is the partition
 * `publication/parity.js` uses, and it is the right one *there*, because both
 * sides of a parity check are written in our own vocabulary and every row can be
 * read. An import cannot assume that. A row whose venue label no record claims,
 * or whose key names two of our fixtures, has not been found to be unchanged and
 * has not been found to be missing — **it has not been judged**, and
 * {@link import('./reasonCodes.js').EXTERNAL_ROW_CLASS.UNDECIDABLE} is where
 * that goes. Every other arrangement puts it in `matched-identical`, and an
 * import nobody could read then reports "8 rows, all fine".
 *
 * ## Why an unresolved venue makes the whole row undecidable
 *
 * The identity key is (date, home, away) — what a family knows a fixture by, and
 * the package default `publication/rows.js` already uses. It does **not** carry
 * the ground. So "the same two teams on the same date" is not by itself the same
 * fixture: it is the same fixture *if the ground agrees*, and when the venue
 * label does not resolve we cannot tell. Reporting "kickoff differs by 30
 * minutes" about a row that might be describing a different pitch is a partial
 * judgement wearing a whole one's clothes.
 *
 * A row that states **no** venue is the same fact arriving one step earlier, and
 * it is `EXTERNAL_ROW_VENUE_UNSTATED` rather than a fourth spelling of the same
 * thing. `schemas.js` says why the two are told apart at the boundary at all:
 * `venueLabel` absent means the caller forgot, `venueLabel: null` means the
 * publication states no venue — and the second is a row that has not been
 * judged, not a row that agrees.
 *
 * The evidence is still published. An undecidable row carries every difference
 * that *could* be computed, in `differences`, with the fields that could not in
 * `uncomparedFields` — and of those, the ones exactly one side stated in
 * `oneSidedFields` and the ones the publication stated in words we could not
 * read in `untranslatedFields`, because *"neither of us records it"*, *"they
 * publish something we do not hold"* and *"they name a ground our records do not
 * claim"* are three different facts with three different repairs. All four lists
 * are derived from one per-row record, `fieldPresence`, so no two of them can
 * disagree about the same row. See {@link EXTERNAL_FIELD_PRESENCE}. The reader
 * sees what would have been said and why it was not said.
 *
 * ## Never silently drop a row
 *
 * Incident 10. Every input row appears in the output exactly once, in exactly
 * one class, and `unmatched` and `undecidable` get **one finding each, per row**
 * rather than a bucket count — because those are the two an operator has to act
 * on individually, and a line reading "2 unmatched" does not tell them which.
 * `matched` and `differing` are reported at bucket level with counts, because
 * their per-row evidence is on the row.
 *
 * @module externalImport/resolution
 */

import {
  EXTERNAL_IMPORT_REASON,
  EXTERNAL_NAME_RESOLUTION,
  EXTERNAL_ROW_CLASS,
  EXTERNAL_ROW_CLASS_ORDER,
  assertExternalImportFindings,
  createExternalImportMeta,
  deriveExternalImportStatus,
  makeExternalImportFinding,
  nameResolutionFinding,
} from './reasonCodes.js';
import {
  EXTERNAL_LOOKUP_SIDE,
  EXTERNAL_MAPPING_KIND,
  createMappingUsage,
  mappingUsageFindings,
  normaliseExternalLabel,
  recordMappingUse,
  resolveExternalName,
} from './mapping.js';
import { ExternalImportQuerySchema } from './schemas.js';

/**
 * The fields an import can be keyed on, and where each side reads it from.
 *
 * A frozen table with one row per supported field, for the reason
 * `FEASIBILITY_SEVERITY_EFFECT` and `FAIRNESS_DISPERSION_REASON` are tables: the
 * alternative is a `switch` that has to be extended, correctly, in the key
 * builder *and* the comparator, every time a field is added.
 *
 * @type {Readonly<Record<string, { ours: string, theirs: string, participant: boolean }>>}
 */
export const EXTERNAL_KEY_FIELD = Object.freeze({
  date: Object.freeze({ ours: 'date', theirs: 'date', participant: false }),
  home: Object.freeze({ ours: 'homeLabel', theirs: 'homeLabel', participant: true }),
  away: Object.freeze({ ours: 'awayLabel', theirs: 'awayLabel', participant: true }),
});

/**
 * The fields an import can be compared on, and whether a difference has a
 * magnitude in minutes.
 *
 * @type {Readonly<Record<string, { ours: string, minutes: boolean, fromVenue: boolean }>>}
 */
export const EXTERNAL_COMPARED_FIELD = Object.freeze({
  kickoffMinutes: Object.freeze({ ours: 'kickoffMinutes', minutes: true, fromVenue: false }),
  venueId: Object.freeze({ ours: 'venueId', minutes: false, fromVenue: true }),
  surfaceId: Object.freeze({ ours: 'surfaceId', minutes: false, fromVenue: true }),
  format: Object.freeze({ ours: 'format', minutes: false, fromVenue: false }),
  division: Object.freeze({ ours: 'division', minutes: false, fromVenue: false }),
});

/**
 * **Which side of a comparison carried the field**, and what each situation is
 * called in the report.
 *
 * ## One class, or four? Four.
 *
 * An early round collapsed every non-comparing situation into one word.
 * "Uncompared" was emitted whenever either side held `null`, and its message
 * asserted that *"the imported artifact carries no value for it there"* — which
 * is a statement about their side made from a branch that fires for ours just as
 * readily. On the corpus's own `format`/`division` query every one of the
 * sixteen skips is **ours**, and the sentence was wrong about all sixteen.
 *
 * They are separate classes because they license different conclusions and name
 * different repairs:
 *
 * - {@link NEITHER} — no artifact asserts anything about the field. Nothing can
 *   be hidden by not comparing it, so a row that is otherwise equal really is
 *   equal as far as this field can speak. It is worth reporting only because the
 *   caller *asked* for a comparison that could not be made.
 * - {@link OURS_ONLY} / {@link THEIRS_ONLY} — one artifact states a value and
 *   the other does not. That is not a difference with a magnitude, and it is
 *   emphatically not agreement: "we hold no value" and "we agree" are different
 *   facts, and a row carrying a division we do not hold must not be summarised
 *   as one that *"already agrees with what we hold"*.
 * - {@link THEIRS_UNTRANSLATED} — they state it and we could not read what they
 *   stated. Nothing is missing from the publication; a record is missing from
 *   our registry.
 *
 * The two one-sided members are kept apart rather than folded into a single
 * `ONE_SIDED`, for the same reason again: the repair differs. Their value
 * missing is a gap in the publication; ours missing is a gap in our own record.
 * `THEIRS_UNTRANSLATED` is kept out of both for the same reason a third time,
 * and because it is the one of the four that is not a fact about the field's
 * *value* at all — it is a fact about our vocabulary, which is why the value
 * that reaches {@link presenceOf} can never be allowed to speak for it.
 *
 * @readonly
 * @enum {string}
 */
export const EXTERNAL_FIELD_PRESENCE = Object.freeze({
  /** Both sides carried it, so it was compared. */
  BOTH: 'both-sides',
  /** Neither side carried it. */
  NEITHER: 'neither-side',
  /** Only the fixture we hold carried it. */
  OURS_ONLY: 'the-fixtures-we-hold-only',
  /** Only the imported publication carried it. */
  THEIRS_ONLY: 'the-imported-publication-only',
  /**
   * The imported publication carried it, in a vocabulary our mapping records
   * could not translate.
   *
   * Kept apart from {@link THEIRS_ONLY} and emphatically from
   * {@link OURS_ONLY}, because the previous round's version had no such member
   * and a *failed venue lookup* therefore arrived at {@link presenceOf} as
   * `theirs = null` — indistinguishable from a publication that stated no
   * ground at all. Every row naming a pitch our registry does not claim was
   * then reported `OURS_ONLY`, under a sentence saying *"the imported
   * publication does not"* carry a value for it. It does. What is missing is
   * our record of what the label means, and that is where the repair goes.
   */
  THEIRS_UNTRANSLATED: 'the-imported-publication-in-words-we-cannot-translate',
});

/**
 * How each non-comparing presence is reported: its code, the clause that says
 * what actually happened, and the counter it increments.
 *
 * A table rather than a run of `if`s in the message builder, for the reason
 * {@link EXTERNAL_KEY_FIELD} and `EXTERNAL_NAME_RESOLUTION_REASON` are tables:
 * a sentence written next to the branch that produces it is a sentence that
 * describes the branch, and this whole class of defect is a message asserting
 * a cause that came from where it sat rather than from what happened.
 *
 * `counter` is here rather than in a chain beside the observation for the same
 * reason one step further on. A presence added to the enum with no row in this
 * table now fails loudly at the moment it is observed — see the throw in
 * {@link classifyExternalImport} — instead of falling down an `else` and being
 * counted as whichever neighbour the chain ended on.
 *
 * @type {Readonly<Record<string, { code: string, clause: string, counter: string }>>}
 */
const FIELD_PRESENCE_REPORT = Object.freeze({
  [EXTERNAL_FIELD_PRESENCE.NEITHER]: Object.freeze({
    code: EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED,
    clause:
      'neither the imported publication nor the fixture we hold carries a value for it, so there was nothing to compare',
    counter: 'fieldsUncompared',
  }),
  [EXTERNAL_FIELD_PRESENCE.OURS_ONLY]: Object.freeze({
    code: EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED,
    clause:
      'the fixture we hold carries a value for it and the imported publication does not, so the row is not shown to agree on it and is not shown to differ either',
    counter: 'fieldsOneSided',
  }),
  [EXTERNAL_FIELD_PRESENCE.THEIRS_ONLY]: Object.freeze({
    code: EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_ONE_SIDED,
    clause:
      'the imported publication carries a value for it and we hold none, so the row is not shown to agree on it — "we have no value" is not "we agree"',
    counter: 'fieldsOneSided',
  }),
  [EXTERNAL_FIELD_PRESENCE.THEIRS_UNTRANSLATED]: Object.freeze({
    code: EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNTRANSLATED,
    clause:
      'the imported publication states a ground for it and no mapping record says what that label names, so the value is missing from our reading of the publication rather than from the publication; the repair is to write a mapping record on our side',
    counter: 'fieldsUntranslated',
  }),
});

/**
 * **What the imported publication said about one field**, as two facts that are
 * carried separately rather than collapsed into one nullable value.
 *
 * `stated` is a fact about *their* artifact: did the row assert anything here?
 * `translated` is a fact about *ours*: could our mapping records read what it
 * asserted? A venue-derived field takes its value from a lookup, and a lookup
 * that fails yields no value for a reason that has nothing to do with the
 * publication. Returning a bare `null` for both cases is what let a failed
 * lookup be classified as an absent value; the two facts are therefore kept in
 * separate fields all the way to {@link presenceOf}, where no arrangement of
 * arguments can turn one into the other.
 *
 * @typedef {Object} TheirFieldValue
 * @property {boolean} stated - the publication asserts something here
 * @property {boolean} translated - and we could read what it asserts
 * @property {unknown} value - the translated value; meaningless unless both
 */

/**
 * Read one field off the imported row, through the venue lookup where the field
 * is derived from it.
 *
 * @param {Record<string, unknown>} row
 * @param {import('./types.js').ExternalNameResolution|null} venue
 * @param {string} field
 * @param {{ fromVenue: boolean }} spec
 * @returns {TheirFieldValue}
 */
function theirValueOf(row, venue, field, spec) {
  if (!spec.fromVenue) {
    const value = row[field];
    return { stated: value !== null && value !== undefined, translated: true, value };
  }
  if (venue === null) {
    // The publication states no venue at all. Nothing failed; there is nothing
    // there. `schemas.js` tells this apart from an absent `venueLabel` at the
    // boundary precisely so this branch means one thing.
    return { stated: false, translated: true, value: null };
  }
  if (venue.state !== EXTERNAL_NAME_RESOLUTION.RESOLVED) {
    // A ground **is** stated. We cannot say which of ours it is.
    return { stated: true, translated: false, value: null };
  }
  const value = venue[field === 'venueId' ? 'venueId' : 'surfaceId'];
  return { stated: value !== null && value !== undefined, translated: true, value };
}

/**
 * Which side carried the field, from what was observed of each and nothing else.
 *
 * @param {unknown} ours
 * @param {TheirFieldValue} theirs
 * @returns {string} an {@link EXTERNAL_FIELD_PRESENCE} value
 */
function presenceOf(ours, theirs) {
  const haveOurs = ours !== null && ours !== undefined;
  if (!theirs.translated) return EXTERNAL_FIELD_PRESENCE.THEIRS_UNTRANSLATED;
  if (haveOurs && theirs.stated) return EXTERNAL_FIELD_PRESENCE.BOTH;
  if (haveOurs) return EXTERNAL_FIELD_PRESENCE.OURS_ONLY;
  if (theirs.stated) return EXTERNAL_FIELD_PRESENCE.THEIRS_ONLY;
  return EXTERNAL_FIELD_PRESENCE.NEITHER;
}

/**
 * The fields of a per-row presence record whose presence satisfies `predicate`,
 * in the order the comparison asked for them.
 *
 * Every published list of fields is derived through this, from the row's own
 * record, so no two of them can disagree and none of them is computed by
 * subtracting one union from another.
 *
 * @param {Record<string, string>} fieldPresence
 * @param {(presence: string) => boolean} predicate
 * @returns {string[]}
 */
function fieldsWherePresence(fieldPresence, predicate) {
  return Object.entries(fieldPresence)
    .filter(([, presence]) => predicate(presence))
    .map(([field]) => field);
}

/** Presences in which exactly one artifact carried the field. */
function isOneSided(presence) {
  return (
    presence === EXTERNAL_FIELD_PRESENCE.OURS_ONLY ||
    presence === EXTERNAL_FIELD_PRESENCE.THEIRS_ONLY
  );
}

/**
 * Render a key component. `null` is rendered as a distinct token rather than as
 * the empty string, so a row missing a component cannot collide with one whose
 * component is empty.
 *
 * @param {unknown} value
 * @returns {string}
 */
function keyComponent(value) {
  if (value === null || value === undefined) return '<absent>';
  return normaliseExternalLabel(String(value));
}

/**
 * The identity of one fixture, from either side.
 *
 * @param {ReadonlyArray<string>} keyFields
 * @param {ReadonlyArray<string|null>} components
 * @returns {string}
 */
function joinKey(keyFields, components) {
  return keyFields.map((field, index) => `${field}=${keyComponent(components[index])}`).join('|');
}

/**
 * **One participant key component, and the only place either side computes one.**
 *
 * A participant label goes through the registry when a record claims it, so a
 * league that renames a team is handled by writing a record rather than by
 * loosening the comparison; where no record claims it the label itself is the
 * identity, which is what the season corpus needs because both artifacts spell
 * every side the same way.
 *
 * The two sides **must** run the same function. They did not: the imported row
 * was canonicalised to a record's `subjectId` while our fixture kept its raw
 * `homeLabel`, so writing the very record this comment recommends turned a
 * `matched-identical` row into `unmatched` — a mapping kind that corrupts
 * matching when used as documented. Whatever this function does, it now does to
 * both sides, so a record that renames one renames the other.
 *
 * `side` is the one asymmetry and it is about the **ledger**, never about the
 * value: the same lookup returns the same component whichever side asked for it.
 * `usage` counts what the *imported publication* asked of the registry; our own
 * fixtures are the thing being compared against, not part of that artifact.
 *
 * The previous round removed our side's `labelsUnclaimedOptional` noise by not
 * recording our lookups at all *unless they resolved* — which is the half that
 * broke it. A resolved lookup of ours landed in `usedRecordIds`, so a registry
 * whose records only our own fixtures touch reported as exercised and
 * `EXTERNAL_MAPPING_REGISTRY_UNEXERCISED` — blocking, incident 4's shape — went
 * quiet. Both sides are recorded now, each under its own
 * {@link import('./mapping.js').EXTERNAL_LOOKUP_SIDE}: the noise stays out of
 * the import's counters because an `ours` lookup touches none of them, and the
 * blocking finding comes back because `usedRecordIds` again means only what the
 * publication asked for.
 *
 * @param {import('./types.js').ExternalMappingRegistry} registry
 * @param {ReturnType<typeof createMappingUsage>} usage
 * @param {unknown} raw
 * @param {{ side: string }} options - an `EXTERNAL_LOOKUP_SIDE` value
 * @returns {unknown}
 */
function participantComponent(registry, usage, raw, { side }) {
  if (raw === null || raw === undefined) return raw;
  const resolved = recordMappingUse(
    usage,
    resolveExternalName(registry, EXTERNAL_MAPPING_KIND.PARTICIPANT, /** @type {string} */ (raw)),
    { side, optional: true }
  );
  if (resolved.state === EXTERNAL_NAME_RESOLUTION.RESOLVED) return resolved.subjectId;
  return raw;
}

/**
 * **Classify one publication against the fixtures we hold.**
 *
 * @param {Object} rawQuery - see `ExternalImportQuerySchema`
 * @param {import('./types.js').ExternalMappingRegistry} registry
 * @returns {import('./types.js').ExternalImportResolution}
 */
export function classifyExternalImport(rawQuery, registry) {
  const query = /** @type {any} */ (ExternalImportQuerySchema.parse(rawQuery));
  const meta = createExternalImportMeta();
  meta.mappingRecordsDeclared = registry.records.length;
  const usage = createMappingUsage();

  /** @type {string[]} */
  const keyFields = query.keyFields;
  /** @type {string[]} */
  const comparedFields = query.comparedFields;

  for (const field of keyFields) {
    if (!(field in EXTERNAL_KEY_FIELD)) {
      throw new Error(
        `externalImport: ${JSON.stringify(field)} is not a key field; EXTERNAL_KEY_FIELD declares ${Object.keys(EXTERNAL_KEY_FIELD).join(', ')}`
      );
    }
  }
  for (const field of comparedFields) {
    if (!(field in EXTERNAL_COMPARED_FIELD)) {
      throw new Error(
        `externalImport: ${JSON.stringify(field)} is not a compared field; EXTERNAL_COMPARED_FIELD declares ${Object.keys(EXTERNAL_COMPARED_FIELD).join(', ')}`
      );
    }
  }

  /** @type {Map<string, any[]>} */
  const standingByKey = new Map();
  for (const fixture of query.standing) {
    const key = joinKey(
      keyFields,
      keyFields.map((field) => {
        const spec = EXTERNAL_KEY_FIELD[field];
        const raw = fixture[spec.ours];
        if (!spec.participant) return raw;
        return participantComponent(registry, usage, raw, { side: EXTERNAL_LOOKUP_SIDE.OURS });
      })
    );
    if (!standingByKey.has(key)) standingByKey.set(key, []);
    /** @type {any[]} */ (standingByKey.get(key)).push(fixture);
  }

  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];
  /** @type {import('./types.js').ExternalRowResolution[]} */
  const rows = [];
  /**
   * Row ids per `${field}|${presence}` — the group a finding is emitted for.
   *
   * Keyed on the presence as well as the field so the message is chosen by what
   * was observed rather than by which loop wrote it, and so two rows that
   * skipped one field for opposite reasons cannot share a sentence.
   *
   * @type {Map<string, string[]>}
   */
  const skippedByFieldAndPresence = new Map();

  meta.rowsRead = query.rows.length;

  for (const row of query.rows) {
    /** @type {import('./types.js').ExternalNameResolution|null} */
    let venue = null;
    if (row.venueLabel !== null) {
      venue = recordMappingUse(
        usage,
        resolveExternalName(registry, EXTERNAL_MAPPING_KIND.VENUE, row.venueLabel)
      );
    }

    // Their key components, through `participantComponent()` — the same function
    // the standing index above is built with, which is the whole of the fix for
    // a key that used to be computed two different ways.
    const theirComponents = keyFields.map((field) => {
      const spec = EXTERNAL_KEY_FIELD[field];
      const raw = row[spec.theirs];
      if (!spec.participant) return raw;
      return participantComponent(registry, usage, raw, {
        side: EXTERNAL_LOOKUP_SIDE.IMPORTED,
      });
    });

    const matchKey = joinKey(keyFields, theirComponents);
    const candidates = standingByKey.get(matchKey) ?? [];
    const candidateFixtureIds = candidates.map((fixture) => fixture.fixtureId).sort();
    const matchedOn = keyFields.map((field, index) => ({
      field,
      value: theirComponents[index],
    }));

    const keyIncomplete = theirComponents.some((value) => value === null || value === undefined);
    const fixture = candidates.length === 1 ? candidates[0] : null;

    /** @type {import('./types.js').ExternalFieldDifference[]} */
    const differences = [];
    /**
     * What was observed about each requested field **on this row**.
     *
     * The single fact, recorded once, from which every published list of fields
     * is derived. The lists used to be accumulated independently and then
     * reconciled by set arithmetic at bucket level, which is how a field that
     * was one-sided on one row and neither-sided on another disappeared from
     * both accounts: subtracting a union from a union cannot represent a field
     * that is two different things on two different rows.
     *
     * @type {Record<string, string>}
     */
    const fieldPresence = {};

    if (fixture !== null) {
      for (const field of comparedFields) {
        const spec = EXTERNAL_COMPARED_FIELD[field];
        const ours = fixture[spec.ours];
        // Their side arrives as two separate facts — did they state it, and
        // could we translate what they stated — so a venue lookup that failed
        // cannot present itself as a publication that said nothing. See
        // {@link theirValueOf}.
        const theirs = theirValueOf(row, venue, field, spec);
        // Comparability is a fact about the **pair**, not about their side of
        // it. Testing only `theirs` meant a null of ours was compared against a
        // real value and reported as a difference (`ours: null`), which put a
        // row nothing can honestly accept into the acceptance domain and made
        // the sweep answer a bigger question than the corpus poses.
        //
        // Which side was missing is carried rather than discarded: it decides
        // the code and the sentence, and it is what stops a row that carries a
        // value we do not hold being summarised as one that already agrees.
        const presence = presenceOf(ours, theirs);
        fieldPresence[field] = presence;
        if (presence !== EXTERNAL_FIELD_PRESENCE.BOTH) {
          const report = FIELD_PRESENCE_REPORT[presence];
          // An observed presence with no row in the table has no code, no
          // sentence and no counter. Guessing one is the defect; saying so is
          // the fix, and it fires here rather than at the message builder so
          // the run stops at the observation that cannot be reported.
          if (report === undefined) {
            throw new Error(
              `externalImport: ${JSON.stringify(presence)} was observed for ${JSON.stringify(field)} and FIELD_PRESENCE_REPORT has no row for it; every non-comparing presence must declare its code, clause and counter`
            );
          }
          meta[report.counter] += 1;
          const groupKey = `${field}|${presence}`;
          if (!skippedByFieldAndPresence.has(groupKey)) skippedByFieldAndPresence.set(groupKey, []);
          /** @type {string[]} */ (skippedByFieldAndPresence.get(groupKey)).push(row.rowId);
          continue;
        }
        meta.fieldComparisons += 1;
        if (ours === theirs.value) continue;
        differences.push({
          field,
          ours,
          theirs: theirs.value,
          deltaMinutes:
            spec.minutes && typeof ours === 'number' && typeof theirs.value === 'number'
              ? theirs.value - ours
              : null,
        });
      }
    }

    // Derived, never accumulated in parallel: three lists built by three pushes
    // are three chances to disagree, and the reader of any one of them is owed
    // the same fact the other two were built from.
    const compared = fieldsWherePresence(
      fieldPresence,
      (presence) => presence === EXTERNAL_FIELD_PRESENCE.BOTH
    );
    const uncompared = fieldsWherePresence(
      fieldPresence,
      (presence) => presence !== EXTERNAL_FIELD_PRESENCE.BOTH
    );
    const oneSided = fieldsWherePresence(fieldPresence, isOneSided);
    const untranslated = fieldsWherePresence(
      fieldPresence,
      (presence) => presence === EXTERNAL_FIELD_PRESENCE.THEIRS_UNTRANSLATED
    );

    /** @type {string} */
    let rowClass;
    /** @type {string|null} */
    let reasonCode = null;

    if (keyIncomplete) {
      rowClass = EXTERNAL_ROW_CLASS.UNDECIDABLE;
      reasonCode = EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNDECIDABLE;
    } else if (candidates.length > 1) {
      rowClass = EXTERNAL_ROW_CLASS.UNDECIDABLE;
      reasonCode = EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_KEY_AMBIGUOUS;
    } else if (venue === null) {
      // `schemas.js` states this outright: `venueLabel` absent and
      // `venueLabel: null` mean opposite things, and the second "is a row that
      // must be classified `undecidable` rather than silently compared on the
      // fields that did arrive". The guard below tested only a venue that had
      // been looked up, so a row stating no venue at all skipped it and came
      // back `matched-identical` and `acceptable` — the one arrangement that
      // makes an unjudgeable row acceptable. The reasoning is the same one the
      // unresolved case gets: the key is (date, home, away) and does not carry
      // the ground, so without a venue "the same two teams on the same date" is
      // not known to be the same fixture.
      rowClass = EXTERNAL_ROW_CLASS.UNDECIDABLE;
      reasonCode = EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_VENUE_UNSTATED;
    } else if (venue.state !== EXTERNAL_NAME_RESOLUTION.RESOLVED) {
      rowClass = EXTERNAL_ROW_CLASS.UNDECIDABLE;
      reasonCode =
        venue.state === EXTERNAL_NAME_RESOLUTION.AMBIGUOUS
          ? EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_AMBIGUOUS
          : EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED;
    } else if (candidates.length === 0) {
      rowClass = EXTERNAL_ROW_CLASS.UNMATCHED;
      reasonCode = EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNMATCHED;
    } else if (differences.length > 0) {
      rowClass = EXTERNAL_ROW_CLASS.MATCHED_DIFFERING;
      reasonCode = EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_DIFFERS;
    } else {
      rowClass = EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL;
    }

    const acceptable =
      rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL ||
      rowClass === EXTERNAL_ROW_CLASS.MATCHED_DIFFERING;

    rows.push({
      rowId: row.rowId,
      sourceLabel: row.sourceLabel,
      rowClass,
      reasonCode,
      matchKey,
      matchedOn: Object.freeze(matchedOn),
      fixtureId: fixture === null ? null : fixture.fixtureId,
      candidateFixtureIds,
      venue,
      differences,
      comparedFields: compared,
      uncomparedFields: uncompared,
      oneSidedFields: oneSided,
      untranslatedFields: untranslated,
      fieldPresence: Object.freeze(fieldPresence),
      acceptable,
    });
  }

  /** @type {Record<string, string[]>} */
  const byClass = {};
  for (const name of EXTERNAL_ROW_CLASS_ORDER) byClass[name] = [];
  for (const row of rows) byClass[row.rowClass].push(row.rowId);

  meta.rowsClassified = rows.length;
  meta.rowsMatchedIdentical = byClass[EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL].length;
  meta.rowsMatchedDiffering = byClass[EXTERNAL_ROW_CLASS.MATCHED_DIFFERING].length;
  meta.rowsUnmatched = byClass[EXTERNAL_ROW_CLASS.UNMATCHED].length;
  meta.rowsUndecidable = byClass[EXTERNAL_ROW_CLASS.UNDECIDABLE].length;
  meta.labelLookups = usage.lookups;
  meta.labelsResolved = usage.resolved;
  meta.labelsUnresolved = usage.unresolved;
  meta.labelsUnclaimedOptional = usage.unclaimedOptional;
  meta.labelsAmbiguous = usage.ambiguous;
  meta.standingLabelLookups = usage.ourLookups;
  meta.standingRecordsExercised = usage.ourRecordIds.size;
  meta.mappingRecordsExercised = usage.usedRecordIds.size;

  /* -- bucket-level findings for the two decided-and-found classes --------- */

  if (meta.rowsMatchedIdentical > 0) {
    // "Nothing differing across `comparedFields`" is a claim about fields that
    // were compared. Where one of them was skipped on these very rows, saying
    // it anyway is the same defect as the message below it used to carry, so
    // the sentence names what was actually compared and what was not.
    const identical = rows.filter((row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL);
    // Each list is *"the fields observed to be P on at least one of these
    // rows"*, read off the per-row record. The version this replaces derived
    // the neither-side list by subtracting the union of one-sided fields from
    // the union of skipped fields — and a field that is one-sided on one row
    // and neither-sided on another is in both unions, so it cancelled and was
    // reported under neither heading. A union is not a row: the only place the
    // per-row fact survives is the per-row record, so every one of these is
    // asked of the rows individually.
    /** @param {(presence: string) => boolean} predicate */
    const fieldsHere = (predicate) =>
      [
        ...new Set(identical.flatMap((row) => fieldsWherePresence(row.fieldPresence, predicate))),
      ].sort();
    const comparedHere = fieldsHere((presence) => presence === EXTERNAL_FIELD_PRESENCE.BOTH);
    const skippedHere = fieldsHere((presence) => presence !== EXTERNAL_FIELD_PRESENCE.BOTH);
    const oneSidedHere = fieldsHere(isOneSided);
    const neitherHere = fieldsHere((presence) => presence === EXTERNAL_FIELD_PRESENCE.NEITHER);
    const caveats = [
      oneSidedHere.length > 0
        ? `${oneSidedHere.join(', ')} is carried by one side only on some of them, which is not agreement`
        : null,
      neitherHere.length > 0
        ? `${neitherHere.join(', ')} is carried by neither side on some of them`
        : null,
    ].filter((clause) => clause !== null);
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_MATCHED,
        `${meta.rowsMatchedIdentical} of ${meta.rowsRead} imported row(s) match a fixture we hold on ${keyFields.join(' + ')} with nothing differing across ${comparedHere.length > 0 ? comparedHere.join(', ') : 'no field at all'}${caveats.length > 0 ? `; ${caveats.join('; ')}` : ''}`,
        {
          count: meta.rowsMatchedIdentical,
          rowIds: byClass[EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL],
          keyFields,
          comparedFields,
          fieldsComparedOnTheseRows: comparedHere,
          fieldsSkippedOnTheseRows: skippedHere,
          fieldsOneSidedOnTheseRows: oneSidedHere,
          fieldsNeitherSideCarriesOnTheseRows: neitherHere,
        }
      )
    );
  }

  if (meta.rowsMatchedDiffering > 0) {
    const differing = rows.filter((row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_DIFFERING);
    const deltas = differing
      .flatMap((row) => row.differences)
      .filter((difference) => difference.deltaMinutes !== null)
      .map((difference) => /** @type {number} */ (difference.deltaMinutes));
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_DIFFERS,
        `${meta.rowsMatchedDiffering} of ${meta.rowsRead} imported row(s) match a fixture we hold and differ${deltas.length > 0 ? ` (kickoff deltas ${[...new Set(deltas)].sort((a, b) => a - b).join(', ')} min)` : ''}; each row publishes which field and by how much`,
        {
          count: meta.rowsMatchedDiffering,
          rowIds: byClass[EXTERNAL_ROW_CLASS.MATCHED_DIFFERING],
          fieldsDiffering: [
            ...new Set(differing.flatMap((row) => row.differences.map((d) => d.field))),
          ].sort(),
          kickoffDeltasMinutes: [...new Set(deltas)].sort((a, b) => a - b),
        }
      )
    );
  }

  /* -- one finding per row for the two an operator must act on ------------- */

  for (const row of rows) {
    if (row.rowClass === EXTERNAL_ROW_CLASS.UNMATCHED) {
      findings.push(
        makeExternalImportFinding(
          EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNMATCHED,
          `imported row ${row.rowId} (${row.matchKey}) matches no fixture we hold; it is reported rather than dropped`,
          {
            rowId: row.rowId,
            sourceLabel: row.sourceLabel,
            matchKey: row.matchKey,
            keyFields,
          }
        )
      );
      continue;
    }
    if (row.rowClass !== EXTERNAL_ROW_CLASS.UNDECIDABLE) continue;

    if (row.reasonCode === EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_KEY_AMBIGUOUS) {
      findings.push(
        makeExternalImportFinding(
          EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_KEY_AMBIGUOUS,
          `imported row ${row.rowId} (${row.matchKey}) names ${row.candidateFixtureIds.length} of our fixtures, so no comparison can be attributed to one of them`,
          {
            rowId: row.rowId,
            matchKey: row.matchKey,
            candidateFixtureIds: row.candidateFixtureIds,
          }
        )
      );
    } else if (row.reasonCode === EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_VENUE_UNSTATED) {
      findings.push(
        makeExternalImportFinding(
          EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_VENUE_UNSTATED,
          `imported row ${row.rowId} (${row.matchKey}) states no venue at all, so the ground cannot be checked and "the same two teams on the same date" is not known to be the same fixture; it is reported rather than compared on the fields that did arrive`,
          {
            rowId: row.rowId,
            sourceLabel: row.sourceLabel,
            matchKey: row.matchKey,
            candidateFixtureIds: row.candidateFixtureIds,
          }
        )
      );
    } else if (row.venue !== null && row.venue.state !== EXTERNAL_NAME_RESOLUTION.RESOLVED) {
      const finding = nameResolutionFinding(row.venue);
      if (finding !== null) {
        findings.push(
          makeExternalImportFinding(finding.code, `imported row ${row.rowId}: ${finding.message}`, {
            ...finding.details,
            rowId: row.rowId,
            knownVenueLabels: registry.records
              .filter((record) => record.kind === EXTERNAL_MAPPING_KIND.VENUE)
              .map((record) => record.externalLabel)
              .sort(),
          })
        );
      }
    }

    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_UNDECIDABLE,
        `imported row ${row.rowId} could not be judged: ${row.reasonCode}. It is neither matched nor unmatched, and it is not counted as unchanged`,
        {
          rowId: row.rowId,
          matchKey: row.matchKey,
          decidedBy: row.reasonCode,
          differencesObserved: row.differences.map((difference) => difference.field),
          uncomparedFields: row.uncomparedFields,
          oneSidedFields: row.oneSidedFields,
        }
      )
    );
  }

  /* -- fields that could not be compared, per field and per cause ---------- */

  // One finding per (field, presence) rather than per field: the code and the
  // sentence are both looked up from what was observed, so neither can assert a
  // cause that came from the branch it sits in.
  for (const [groupKey, rowIds] of [...skippedByFieldAndPresence.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const separator = groupKey.indexOf('|');
    const field = groupKey.slice(0, separator);
    const presence = groupKey.slice(separator + 1);
    const report = FIELD_PRESENCE_REPORT[presence];
    findings.push(
      makeExternalImportFinding(
        report.code,
        `${field} could not be compared on ${rowIds.length} row(s): ${report.clause}`,
        { field, presence, count: rowIds.length, rowIds }
      )
    );
  }

  /* -- the meta-assertions ------------------------------------------------- */

  if (meta.rowsRead === 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_IMPORT_NO_ROWS_READ,
        `${query.subject}: zero rows were handed to the classifier, so every count below is a perfect score meaning "I looked at nothing"`,
        { subject: query.subject, standingFixtures: query.standing.length }
      )
    );
  } else if (meta.rowsMatchedIdentical + meta.rowsMatchedDiffering + meta.rowsUnmatched === 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_IMPORT_NOTHING_CLASSIFIED,
        `${query.subject}: all ${meta.rowsRead} row(s) came back undecidable, so this run judged nothing about the publication it read`,
        { subject: query.subject, rowsRead: meta.rowsRead }
      )
    );
  }

  const usageReport = mappingUsageFindings(registry, usage);
  findings.push(...usageReport.findings);

  assertExternalImportFindings(findings, `import classification of ${query.subject}`);

  return {
    subject: query.subject,
    keyFields,
    comparedFields,
    rows,
    byClass,
    unexercisedRecords: usageReport.unexercised,
    findings,
    status: deriveExternalImportStatus(findings),
    meta,
  };
}

/**
 * The rows whose acceptance could change anything — the acceptance **domain**.
 *
 * `matched-identical` rows are acceptable and are deliberately *not* in the
 * domain: accepting one is a legal no-op, and putting it in the domain would
 * double the sweep's size with sets that differ from each other by nothing.
 *
 * @param {import('./types.js').ExternalImportResolution} resolution
 * @returns {string[]} row ids, sorted
 */
export function acceptanceDomainOf(resolution) {
  return resolution.rows
    .filter((row) => row.rowClass === EXTERNAL_ROW_CLASS.MATCHED_DIFFERING)
    .map((row) => row.rowId)
    .sort();
}
