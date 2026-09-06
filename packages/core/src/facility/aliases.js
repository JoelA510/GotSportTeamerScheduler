/**
 * The alias layer: the published field name as a display layer over surface
 * ids.
 *
 * Families read "Junior Field 1"; the ground is `Maplewood Back / Field 1`.
 * The club keeps **two** decoder rings for that translation — the practice
 * workbook's and the fields workbook's — and they disagree on 12 of the 20
 * codes they share. This module keys on the **published name** and holds,
 * for each, one **candidate per ring**, each resolved to ground independently
 * and by graph structure alone (`practiceSurfaces.js`). It follows neither
 * ring: a check taken through an alias runs over every candidate surface and
 * every finding names the ring it came from. A disagreement is carried, never
 * resolved — and the layer re-derives the label comparison so a test can
 * assert it agrees with the corpus loader's `compareDecoderRings()` (12).
 *
 * Why the published name is the wrong ground to check on: two codes can name
 * one surface, one code can name two (through two rings), and a name-keyed
 * conflict check gets both cases wrong at once. `tests/facilityAliases.test.js`
 * constructs exactly that.
 *
 * The layer holds **no booking state** and reads nothing from disk: rings
 * arrive as plain records, the corpus loader's or anyone else's.
 *
 * @module facility/aliases
 */

import { z } from 'zod';

import { deepFreeze } from './facilityGraph.js';
import { PRACTICE_SURFACE_RESOLUTION, resolvePracticeSurface } from './practiceSurfaces.js';
import { FACILITY_REASON, makeFinding } from './reasonCodes.js';

/** A non-empty string. */
const NonEmpty = z.string().min(1);

/** One row of one decoder ring, as the sheet states it. */
export const AliasRingEntrySchema = z
  .object({
    displayName: NonEmpty,
    /** The whole label the sheet writes (`Maplewood Field 1`); `null` when blank. */
    label: NonEmpty.nullable().default(null),
    venue: NonEmpty.nullable().default(null),
    field: NonEmpty.nullable().default(null),
    subunit: NonEmpty.nullable().default(null),
    /** The source's own doubt (`?`). */
    uncertain: z.boolean().default(false),
    source: z.string().nullable().default(null),
  })
  .strict();

/** One decoder ring. */
export const AliasRingSchema = z
  .object({
    ring: NonEmpty,
    entries: z.array(AliasRingEntrySchema),
  })
  .strict();

/** Input for {@link buildFieldAliasMap}. */
export const FieldAliasMapInputSchema = z
  .object({
    rings: z.array(AliasRingSchema).min(1),
  })
  .strict();

/**
 * How the rings' **labels** compare for one code. Lowercase: a state, not a
 * finding code. The vocabulary mirrors the loader's `DECODER_DISAGREEMENT_KIND`
 * so the two can be compared in a test.
 *
 * @readonly
 * @enum {string}
 */
export const ALIAS_LABEL_AGREEMENT = Object.freeze({
  /** Only one ring carries the code. */
  SINGLE_RING: 'single-ring',
  AGREE: 'agree',
  /** The first ring carries a label and the rings do not all say the same thing. */
  LABEL_CONFLICT: 'label-conflict',
  /** The first ring -- the driver -- is blank. A later ring's blank is a `LABEL_CONFLICT`, as the loader reports it. */
  BLANK_VS_LABEL: 'blank-vs-label',
});

/**
 * How the rings' **ground** compares for one code, after each candidate is
 * resolved by structure.
 *
 * @readonly
 * @enum {string}
 */
export const ALIAS_GROUND_AGREEMENT = Object.freeze({
  SINGLE_RING: 'single-ring',
  /** Every resolved candidate names the same surface set. */
  SAME: 'same',
  /** Two resolved candidates name different surface sets. */
  DIFFERENT: 'different',
  /** Some candidate did not resolve, so the question cannot be answered. */
  UNDECIDABLE: 'undecidable',
});

/**
 * @typedef {Object} AliasCandidate
 * @property {string} ring
 * @property {string|null} label
 * @property {string|null} venue
 * @property {string|null} field
 * @property {string|null} subunit
 * @property {boolean} uncertain
 * @property {string|null} source
 * @property {string} resolution - a `PRACTICE_SURFACE_RESOLUTION` value, or `blank`
 * @property {string[]} venueIds
 * @property {string[]} surfaceIds
 */

/**
 * @typedef {Object} FieldAlias
 * @property {string} displayName
 * @property {AliasCandidate[]} candidates - one per ring that carries the code
 * @property {string[]} surfaceIds - every surface any candidate resolved to, sorted, distinct
 * @property {string[]} venueIds - likewise for venues
 * @property {string} labelAgreement - an {@link ALIAS_LABEL_AGREEMENT} value
 * @property {string} groundAgreement - an {@link ALIAS_GROUND_AGREEMENT} value
 */

/**
 * @typedef {Object} FieldAliasMap
 * @property {Record<string, FieldAlias>} aliases - by published name
 * @property {string[]} displayNames - sorted
 * @property {string[]} rings - in input order
 * @property {import('./types.js').FacilityFinding[]} findings
 * @property {FieldAliasMapStats} stats
 */

/**
 * @typedef {Object} FieldAliasMapStats
 * @property {number} ringCount
 * @property {number} entryCount - rows read across all rings
 * @property {number} aliasCount - distinct published names
 * @property {number} sharedCount - names carried by more than one ring
 * @property {number} candidateCount
 * @property {number} resolvedCandidateCount
 * @property {number} ambiguousCandidateCount
 * @property {number} unresolvedCandidateCount - blank, venue unknown, surface unknown, venue only
 * @property {number} labelConflictCount
 * @property {number} blankVsLabelCount
 * @property {number} disagreementCount - labelConflictCount + blankVsLabelCount
 */

/**
 * What an `ALIAS_BLANK` finding says, derived from the row's own cells.
 *
 * Every clause is a fact about a cell: which are empty, what the field cell
 * holds when it holds anything, and whether the row can be placed at all
 * (which turns only on the venue). There is deliberately no per-shape branch,
 * because that is where a message describing an absent field while `field` is
 * present came from twice.
 *
 * @param {string} ring
 * @param {{ displayName: string, label: string|null, venue: string|null, field: string|null, subunit: string|null }} entry
 * @returns {string}
 */
function blankCellMessage(ring, entry) {
  const empty = [];
  if (entry.label === null) empty.push('no label');
  if (entry.venue === null) empty.push('no venue');
  if (entry.field === null) empty.push('no field');
  const carried =
    entry.field === null ? '' : `, though its field cell says ${JSON.stringify(entry.field)}`;
  const outcome =
    entry.venue === null
      ? 'so no ground is named and it cannot be placed'
      : 'so its ground is read from the venue and field cells instead of from the label';
  return `the ${ring} ring lists "${entry.displayName}" with ${empty.join(' and ')}${carried}; ${outcome}`;
}

/** The resolution word for a blank entry, beside the structural ones. */
const BLANK_RESOLUTION = 'blank';

/**
 * Build the alias map.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {import('./types.js').VenueComplexMap} complexMap
 * @param {{ rings: Array<{ ring: string, entries: Array<Object> }> }} input
 * @returns {FieldAliasMap}
 */
export function buildFieldAliasMap(graph, complexMap, input) {
  const parsed = FieldAliasMapInputSchema.parse(input);
  /** @type {import('./types.js').FacilityFinding[]} */
  const findings = [];
  // Null-prototype: a published name is a CSV cell, and `constructor` or
  // `__proto__` must be an alias like any other, never a prototype member.
  /** @type {Record<string, FieldAlias>} */
  const aliases = Object.create(null);
  const stats = {
    ringCount: parsed.rings.length,
    entryCount: 0,
    aliasCount: 0,
    sharedCount: 0,
    candidateCount: 0,
    resolvedCandidateCount: 0,
    ambiguousCandidateCount: 0,
    unresolvedCandidateCount: 0,
    labelConflictCount: 0,
    blankVsLabelCount: 0,
    disagreementCount: 0,
  };

  const seenRings = new Set();
  for (const ring of parsed.rings) {
    if (seenRings.has(ring.ring))
      throw new Error(`facility aliases: ring "${ring.ring}" given twice`);
    seenRings.add(ring.ring);
    const seenCodes = new Set();
    for (const entry of ring.entries) {
      stats.entryCount += 1;
      // First occurrence is read, exactly as the corpus loader's
      // compareDecoderRings() does; the duplicate is reported, never the
      // silent last-wins of an index.
      if (seenCodes.has(entry.displayName)) {
        findings.push(
          makeFinding(
            FACILITY_REASON.ALIAS_CODE_DUPLICATED,
            `ring "${ring.ring}" lists "${entry.displayName}" more than once; the first row is read`,
            { displayName: entry.displayName, ring: ring.ring, label: entry.label }
          )
        );
        continue;
      }
      seenCodes.add(entry.displayName);
      const candidate = resolveCandidate(graph, complexMap, ring.ring, entry, findings);
      stats.candidateCount += 1;
      if (candidate.resolution === PRACTICE_SURFACE_RESOLUTION.RESOLVED) {
        stats.resolvedCandidateCount += 1;
      } else if (candidate.resolution === PRACTICE_SURFACE_RESOLUTION.AMBIGUOUS) {
        stats.ambiguousCandidateCount += 1;
      } else {
        stats.unresolvedCandidateCount += 1;
      }
      const alias = aliases[entry.displayName] ?? {
        displayName: entry.displayName,
        candidates: [],
        surfaceIds: [],
        venueIds: [],
        labelAgreement: ALIAS_LABEL_AGREEMENT.SINGLE_RING,
        groundAgreement: ALIAS_GROUND_AGREEMENT.SINGLE_RING,
      };
      alias.candidates.push(candidate);
      aliases[entry.displayName] = alias;
    }
  }

  for (const alias of Object.values(aliases)) {
    stats.aliasCount += 1;
    alias.surfaceIds = [...new Set(alias.candidates.flatMap((c) => c.surfaceIds))].sort();
    alias.venueIds = [...new Set(alias.candidates.flatMap((c) => c.venueIds))].sort();
    if (alias.candidates.length < 2) continue;
    stats.sharedCount += 1;

    const labels = alias.candidates.map((c) => c.label);
    const distinctLabels = new Set(labels);
    /**
     * The **driver** ring: the first one listed, which is the ring the corpus
     * loader's `compareDecoderRings()` iterates while looking the code up in
     * the other. The kind is decided from its label alone, exactly as the
     * loader decides it, rather than from "either side is blank" -- those are
     * two different rules and they disagree whenever the *second* ring is the
     * blank one, which the loader calls a label conflict.
     */
    const driverLabel = alias.candidates[0].label;
    // Two silences are not an agreement about ground, and the loader does not
    // report them as one either.
    if (distinctLabels.size === 1 && driverLabel !== null) {
      alias.labelAgreement = ALIAS_LABEL_AGREEMENT.AGREE;
    } else {
      alias.labelAgreement =
        driverLabel === null
          ? ALIAS_LABEL_AGREEMENT.BLANK_VS_LABEL
          : ALIAS_LABEL_AGREEMENT.LABEL_CONFLICT;
      if (alias.labelAgreement === ALIAS_LABEL_AGREEMENT.BLANK_VS_LABEL)
        stats.blankVsLabelCount += 1;
      else stats.labelConflictCount += 1;
      stats.disagreementCount += 1;
      findings.push(
        makeFinding(
          FACILITY_REASON.ALIAS_RINGS_DISAGREE,
          `"${alias.displayName}" is ${alias.candidates
            .map((c) => `${JSON.stringify(c.label)} on the ${c.ring} ring`)
            .join(' and ')}; every candidate is carried and none is preferred`,
          {
            displayName: alias.displayName,
            kind: alias.labelAgreement,
            rings: alias.candidates.map((c) => c.ring),
            labels,
            surfaceIds: alias.surfaceIds,
          }
        )
      );
    }

    const resolvedSets = alias.candidates
      .filter(
        (c) =>
          c.resolution === PRACTICE_SURFACE_RESOLUTION.RESOLVED ||
          c.resolution === PRACTICE_SURFACE_RESOLUTION.AMBIGUOUS
      )
      .map((c) => c.surfaceIds.join('\u0000'));
    if (resolvedSets.length < alias.candidates.length) {
      alias.groundAgreement = ALIAS_GROUND_AGREEMENT.UNDECIDABLE;
    } else {
      alias.groundAgreement =
        new Set(resolvedSets).size === 1
          ? ALIAS_GROUND_AGREEMENT.SAME
          : ALIAS_GROUND_AGREEMENT.DIFFERENT;
    }
  }

  const displayNames = Object.keys(aliases).sort();
  return deepFreeze({
    aliases,
    displayNames,
    rings: parsed.rings.map((ring) => ring.ring),
    findings,
    stats,
  });
}

/**
 * Resolve one ring row to ground and report what stood in the way.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {import('./types.js').VenueComplexMap} complexMap
 * @param {string} ring
 * @param {Object} entry - schema-parsed
 * @param {import('./types.js').FacilityFinding[]} findings
 * @returns {AliasCandidate}
 */
function resolveCandidate(graph, complexMap, ring, entry, findings) {
  const base = {
    ring,
    label: entry.label,
    venue: entry.venue,
    field: entry.field,
    subunit: entry.subunit,
    uncertain: entry.uncertain,
    source: entry.source,
  };
  const details = { displayName: entry.displayName, ring, label: entry.label, venue: entry.venue };

  if (entry.uncertain) {
    findings.push(
      makeFinding(
        FACILITY_REASON.ALIAS_SOURCE_UNCERTAIN,
        `the ${ring} ring marks "${entry.displayName}" -> ${JSON.stringify(entry.label)} as uncertain`,
        details
      )
    );
  }
  // **Two different absences, and only one of them is unplaceable.**
  //
  // The label is what the ring *calls* the ground; `venue`, `field` and
  // `subunit` are the cells the resolver actually reads. A row with no venue
  // names no ground and nothing can place it. A row with no label but a real
  // venue and field names its ground perfectly well in the cells that matter,
  // and discarding it -- while telling the reader there is "no field behind
  // it", with the field sitting in `base` and the graph holding it -- is a
  // wrong answer rather than a missing one. Both absences are reported; only
  // the missing venue stops here. (The loader reports the label-with-no-venue
  // shape separately as DECODER_RING_ALIAS_VENUE_BLANK.)
  if (entry.label === null || entry.venue === null) {
    // **The sentence is built from the cells, not from a branch per shape.**
    // Round 3 narrowed a wrong message instead of removing it: the both-blank
    // arm still read "with no field behind it" while its predicate was about
    // label and venue, and on the fields ring `field` comes from `remainder`,
    // which the adapter does not blank. A row with an empty label, an empty
    // venue and a real remainder was told its field was missing with the field
    // sitting right there in `base`. Naming exactly the cells that *are* empty,
    // and quoting the field whenever there is one, leaves no branch able to
    // call a present field absent.
    findings.push(
      makeFinding(FACILITY_REASON.ALIAS_BLANK, blankCellMessage(ring, entry), {
        ...details,
        blankLabel: entry.label === null,
        blankVenue: entry.venue === null,
        blankField: entry.field === null,
      })
    );
  }
  if (entry.venue === null) {
    return { ...base, resolution: BLANK_RESOLUTION, venueIds: [], surfaceIds: [] };
  }

  const resolved = resolvePracticeSurface(graph, complexMap, {
    venue: entry.venue,
    field: entry.field,
    subunit: entry.subunit,
  });
  const ground = {
    ...details,
    field: entry.field,
    subunit: entry.subunit,
    venueIds: resolved.venueIds,
    surfaceIds: resolved.surfaceIds,
  };
  switch (resolved.status) {
    case PRACTICE_SURFACE_RESOLUTION.VENUE_UNKNOWN:
      findings.push(
        makeFinding(
          FACILITY_REASON.ALIAS_VENUE_UNKNOWN,
          `the ${ring} ring places "${entry.displayName}" at "${entry.venue}", a venue the graph does not hold`,
          ground
        )
      );
      break;
    case PRACTICE_SURFACE_RESOLUTION.SURFACE_UNKNOWN:
    case PRACTICE_SURFACE_RESOLUTION.SUBUNIT_UNKNOWN:
      findings.push(
        makeFinding(
          FACILITY_REASON.ALIAS_SURFACE_UNKNOWN,
          `the ${ring} ring places "${entry.displayName}" on "${entry.field}${entry.subunit ? ` ${entry.subunit}` : ''}" at ${entry.venue}, which is not a surface the graph holds there`,
          ground
        )
      );
      break;
    case PRACTICE_SURFACE_RESOLUTION.AMBIGUOUS:
      findings.push(
        makeFinding(
          FACILITY_REASON.ALIAS_SURFACE_AMBIGUOUS,
          `the ${ring} ring's "${entry.displayName}" -> "${entry.venue} / ${entry.field}" fits ${resolved.surfaceIds.length} surfaces (${resolved.surfaceIds.join(', ')}); every one is carried`,
          ground
        )
      );
      break;
    case PRACTICE_SURFACE_RESOLUTION.VENUE_ONLY:
      findings.push(
        makeFinding(
          FACILITY_REASON.ALIAS_VENUE_ONLY,
          `the ${ring} ring places "${entry.displayName}" at ${entry.venue} and names no field`,
          ground
        )
      );
      break;
    default:
      break;
  }
  return {
    ...base,
    resolution: resolved.status,
    venueIds: resolved.venueIds,
    surfaceIds: resolved.surfaceIds,
  };
}

/**
 * The alias for a published name, or `null` — with a finding, so the caller
 * cannot read "not there" as "no ground to check".
 *
 * @param {FieldAliasMap} map
 * @param {string} displayName
 * @returns {{ alias: FieldAlias|null, findings: import('./types.js').FacilityFinding[] }}
 */
export function lookupFieldAlias(map, displayName) {
  const alias = Object.prototype.hasOwnProperty.call(map.aliases, displayName)
    ? map.aliases[displayName]
    : null;
  if (alias) return { alias, findings: [] };
  return {
    alias: null,
    findings: [
      makeFinding(
        FACILITY_REASON.ALIAS_UNKNOWN,
        `"${displayName}" is not a published field name on any ring`,
        { displayName }
      ),
    ],
  };
}

/**
 * The ground a published name stands for: every surface any ring's candidate
 * resolved to, each tagged with the ring that put it there.
 *
 * Unresolved candidates are **counted, not skipped** — `unresolvedCandidates`
 * says how many the caller is not being told about, so a check over the
 * returned surfaces can refuse to call itself complete.
 *
 * @param {FieldAliasMap} map
 * @param {string} displayName
 * @returns {{ displayName: string, surfaces: Array<{ surfaceId: string, rings: string[] }>, unresolvedCandidates: number, findings: import('./types.js').FacilityFinding[] }}
 */
export function surfacesOfAlias(map, displayName) {
  const { alias, findings } = lookupFieldAlias(map, displayName);
  if (!alias) return { displayName, surfaces: [], unresolvedCandidates: 0, findings };
  /** @type {Map<string, string[]>} */
  const ringsBySurface = new Map();
  let unresolvedCandidates = 0;
  for (const candidate of alias.candidates) {
    if (candidate.surfaceIds.length === 0) {
      unresolvedCandidates += 1;
      continue;
    }
    for (const surfaceId of candidate.surfaceIds) {
      const rings = ringsBySurface.get(surfaceId) ?? [];
      rings.push(candidate.ring);
      ringsBySurface.set(surfaceId, rings);
    }
  }
  const surfaces = [...ringsBySurface.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([surfaceId, rings]) => ({ surfaceId, rings }));
  return { displayName, surfaces, unresolvedCandidates, findings };
}
