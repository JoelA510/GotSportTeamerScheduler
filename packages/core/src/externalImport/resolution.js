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
 * `uncomparedFields`. The reader sees what would have been said and why it was
 * not said.
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
 * `recordUnclaimed` is the one asymmetry and it is about the **ledger**, never
 * about the value. `usage` counts what the *imported publication* asked of the
 * registry; our own fixtures are the thing being compared against, not part of
 * that artifact, and recording a `labelsUnclaimedOptional` for each of the
 * hundred-odd standing labels no external record was ever meant to claim is
 * precisely the noise `createExternalImportMeta()` splits that counter out to
 * avoid. A record that *does* fire on our side is recorded either way, so
 * nothing that exercised the registry goes uncounted.
 *
 * @param {import('./types.js').ExternalMappingRegistry} registry
 * @param {ReturnType<typeof createMappingUsage>} usage
 * @param {unknown} raw
 * @param {{ recordUnclaimed: boolean }} options
 * @returns {unknown}
 */
function participantComponent(registry, usage, raw, { recordUnclaimed }) {
  if (raw === null || raw === undefined) return raw;
  const resolved = resolveExternalName(
    registry,
    EXTERNAL_MAPPING_KIND.PARTICIPANT,
    /** @type {string} */ (raw)
  );
  if (resolved.state === EXTERNAL_NAME_RESOLUTION.RESOLVED) {
    recordMappingUse(usage, resolved);
    return resolved.subjectId;
  }
  if (recordUnclaimed) recordMappingUse(usage, resolved, { optional: true });
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
        return participantComponent(registry, usage, raw, { recordUnclaimed: false });
      })
    );
    if (!standingByKey.has(key)) standingByKey.set(key, []);
    /** @type {any[]} */ (standingByKey.get(key)).push(fixture);
  }

  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];
  /** @type {import('./types.js').ExternalRowResolution[]} */
  const rows = [];
  /** @type {Map<string, string[]>} */
  const uncomparedByField = new Map();

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
      return participantComponent(registry, usage, raw, { recordUnclaimed: true });
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
    /** @type {string[]} */
    const compared = [];
    /** @type {string[]} */
    const uncompared = [];

    if (fixture !== null) {
      for (const field of comparedFields) {
        const spec = EXTERNAL_COMPARED_FIELD[field];
        const ours = fixture[spec.ours];
        /** @type {unknown} */
        let theirs;
        if (spec.fromVenue) {
          theirs =
            venue !== null && venue.state === EXTERNAL_NAME_RESOLUTION.RESOLVED
              ? venue[field === 'venueId' ? 'venueId' : 'surfaceId']
              : null;
        } else {
          theirs = row[field];
        }
        // Uncompared is a fact about the **pair**, not about their side of it.
        // Testing only `theirs` meant a null of ours was compared against a
        // real value and reported as a difference (`ours: null`), which put a
        // row nothing can honestly accept into the acceptance domain and made
        // the sweep answer a bigger question than the corpus poses.
        if (ours === null || ours === undefined || theirs === null || theirs === undefined) {
          uncompared.push(field);
          meta.fieldsUncompared += 1;
          if (!uncomparedByField.has(field)) uncomparedByField.set(field, []);
          /** @type {string[]} */ (uncomparedByField.get(field)).push(row.rowId);
          continue;
        }
        compared.push(field);
        meta.fieldComparisons += 1;
        if (ours === theirs) continue;
        differences.push({
          field,
          ours,
          theirs,
          deltaMinutes:
            spec.minutes && typeof ours === 'number' && typeof theirs === 'number'
              ? theirs - ours
              : null,
        });
      }
    }

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
  meta.mappingRecordsExercised = usage.usedRecordIds.size;

  /* -- bucket-level findings for the two decided-and-found classes --------- */

  if (meta.rowsMatchedIdentical > 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_ROW_MATCHED,
        `${meta.rowsMatchedIdentical} of ${meta.rowsRead} imported row(s) match a fixture we hold on ${keyFields.join(' + ')} with nothing differing across ${comparedFields.join(', ')}`,
        {
          count: meta.rowsMatchedIdentical,
          rowIds: byClass[EXTERNAL_ROW_CLASS.MATCHED_IDENTICAL],
          keyFields,
          comparedFields,
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
        }
      )
    );
  }

  /* -- fields that could not be compared, per field with its rows ---------- */

  for (const [field, rowIds] of [...uncomparedByField.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_FIELD_UNCOMPARED,
        `${field} could not be compared on ${rowIds.length} row(s): the imported artifact carries no value for it there, so it is left out of the comparison rather than compared against null`,
        { field, count: rowIds.length, rowIds }
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
