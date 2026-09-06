/**
 * Adapter from the season-2026 corpus's `facility_geometry.json` shape to a
 * facility graph.
 *
 * **Direction of the arrow: fixtures -> facility.** This module takes the
 * already-parsed plain object that `parseFacilityGeometry()` returns and never
 * imports anything from `packages/core/src/fixtures/`. The facility package
 * stays free of `node:fs` and of any knowledge of where the corpus lives.
 *
 * Nothing here edits the corpus. `equipmentOverrides` exists so a test can ask
 * "what if the 9v9 goals had *not* been confirmed?" without touching a fixture
 * file that `computeFixtureChecksums()` proves is byte-stable.
 *
 * @module facility/adapters/season2026Geometry
 */

import { buildFacilityGraph } from '../facilityGraph.js';
import { buildVenueComplexMap } from '../venueComplex.js';

/**
 * Equipment each format requires, stated explicitly.
 *
 * Only 9v9 appears because 9v9 goals are the only kit the corpus records
 * anything about. Filling in the rest by the pattern `` `${format} goals` ``
 * would be invention: it would create requirements the season never had, and a
 * phantom requirement blocks real bookings just as effectively as a real one.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const SEASON_2026_FORMAT_EQUIPMENT = Object.freeze({
  '9v9': Object.freeze(['9v9 goals']),
});

/**
 * The venue complexes of the season-2026 club, **declared**.
 *
 * `Maplewood Back` and `Maplewood Front` are two named venues in
 * `facility_geometry.json` and one site on the ground: a coach moving between
 * them walks. Nothing in the corpus says so — the geometry file carries venue
 * names, lighting and overlap prose, and no field that could express a complex
 * — so this is an operator statement of standing practice, recorded here with
 * that provenance on it. It is the same footing as the 15-minute within-venue
 * figure in `constraints/adapters/season2026Constraints.js`, which no corpus
 * file carries either.
 *
 * It is spelled out rather than derived. There is no rule turning
 * `"Maplewood Back"` into `"Maplewood"`: a shared first word is not a fact
 * about geography, and a heuristic would merge any two sites that happened to
 * share one. The venue ids come from {@link season2026VenueId} so that a
 * renamed corpus venue produces a complex naming a venue nothing else knows —
 * which a test catches — rather than a quietly different id.
 *
 * @type {ReadonlyArray<Object>}
 */
export const SEASON_2026_VENUE_COMPLEXES = Object.freeze([
  Object.freeze({
    id: 'maplewood',
    name: 'Maplewood',
    venueIds: Object.freeze([
      season2026VenueId('Maplewood Back'),
      season2026VenueId('Maplewood Front'),
    ]),
    note: 'two halves of one park; a coach crossing between them walks, and the club has always scheduled them as one site',
    source:
      'club operations — operator statement of standing practice; no corpus file carries it, exactly as with the 15-minute within-venue figure in constraints/adapters/season2026Constraints.js',
  }),
]);

/**
 * Build the season-2026 venue-complex map.
 *
 * Takes no corpus argument: like `season2026Constraints.js` this is a
 * transcription, not a loader, and it reads nothing from disk. The check that
 * the venues it names are venues the corpus actually has belongs to the test
 * that holds the corpus, and `tests/facilityGraph.test.js` makes it.
 *
 * @param {{ complexes?: ReadonlyArray<Object> }} [options]
 * @returns {import('../types.js').VenueComplexMap}
 */
export function buildSeason2026VenueComplexMap(options = {}) {
  return buildVenueComplexMap({
    complexes: [...(options.complexes ?? SEASON_2026_VENUE_COMPLEXES)],
  });
}

/**
 * Slugify a corpus name into an id component.
 *
 * Deliberately colon-free. `GameSchedulingPage.jsx` splits drag-target ids on
 * `':'`, so a colon-bearing id that ever reached the UI would produce a drag
 * that silently does nothing. The corpus's own `makeFieldId()` builds
 * `"Alder Park::Pitch 1A"`; facility ids do not.
 *
 * @param {string} value
 * @returns {string}
 */
function slug(value) {
  const out = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (out === '') throw new Error(`season2026 facility adapter: cannot slugify "${value}"`);
  return out;
}

/**
 * Stable venue id for a corpus venue name.
 *
 * @param {string} venueName
 * @returns {string}
 */
export function season2026VenueId(venueName) {
  return slug(venueName);
}

/**
 * Stable surface id for a corpus venue/field name pair. Opaque by contract:
 * callers must not parse it.
 *
 * @param {string} venueName
 * @param {string} fieldName
 * @returns {string}
 */
export function season2026SurfaceId(venueName, fieldName) {
  return `${slug(venueName)}/${slug(fieldName)}`;
}

/**
 * Classify the corpus's free-text equipment status into the tri-state.
 *
 * The corpus's single record reads *"was in doubt; confirmed available"*, which
 * is why the model is tri-state rather than boolean: a boolean would keep the
 * verdict and throw away the fact that it was ever in doubt.
 *
 * `strict` defaults to **true** and throws on text this function does not
 * recognise. The corpus is an immutable fixture with exactly one entry, so a
 * throw costs nothing and is the loud failure the working conventions demand.
 * Pass `strict: false` for a future non-fixture source: unrecognised text then
 * classifies as `unknown` and the raw text is preserved on `note`.
 *
 * @param {string} text
 * @param {{ strict?: boolean }} [options]
 * @returns {'available'|'unavailable'|'unknown'}
 */
export function classifyEquipmentStatus(text, options = {}) {
  const strict = options.strict ?? true;
  const raw = String(text ?? '').trim();
  const lower = raw.toLowerCase();

  if (lower === 'available') return 'available';
  if (lower === 'unavailable') return 'unavailable';
  if (lower === 'unknown') return 'unknown';
  if (/\bunavailable\b/.test(lower) || /\bnot available\b/.test(lower)) return 'unavailable';
  if (/\bavailable\b/.test(lower)) return 'available';
  if (/\bunknown\b/.test(lower) || /\bin doubt\b/.test(lower) || /\btbd\b/.test(lower)) {
    return 'unknown';
  }

  if (strict) {
    throw new Error(
      `season2026 facility adapter: unrecognised equipment status "${raw}" (pass strict: false to classify it as "unknown")`
    );
  }
  return 'unknown';
}

/**
 * Key an equipment window by everything that makes it the same statement, so an
 * override can replace a corpus record rather than argue with it.
 *
 * @param {{ scope: { kind: string, id: string }, equipment: string, fromDate: string, toDate: string }} window
 * @returns {string}
 */
function equipmentKey(window) {
  return [
    window.scope.kind,
    window.scope.id,
    window.equipment,
    window.fromDate,
    window.toDate,
  ].join('|');
}

/**
 * Translate parsed corpus geometry into `buildFacilityGraph()` input.
 *
 * Exposed separately from {@link buildFacilityGraphFromSeason2026} so a test can
 * run the plain object through `FacilityGraphInputSchema` and prove the adapter
 * has not quietly grown a sixth divergent copy of the model.
 *
 * @param {{ venues: Array<Object>, fields?: Array<Object>, equipmentExceptions?: Array<Object> }} geometry
 *   - the return value of `parseFacilityGeometry()`
 * @param {{ strict?: boolean, equipmentOverrides?: Array<Object>, formatEquipment?: Record<string, ReadonlyArray<string>>, sizePolicy?: string, sizeRank?: Record<string, number> }} [options]
 * @returns {import('../types.js').FacilityGraphInput}
 */
export function toSeason2026FacilityGraphInput(geometry, options = {}) {
  const strict = options.strict ?? true;

  /** @type {Array<Object>} */
  const venues = [];
  /** @type {Array<Object>} */
  const surfaces = [];
  /** @type {Array<[string, string]>} */
  const overlapPairs = [];
  const seenSurfaceIds = new Map();

  for (const venue of geometry.venues ?? []) {
    const venueId = season2026VenueId(venue.name);
    venues.push({
      id: venueId,
      name: venue.name,
      // A stated flag is carried; an absent one stays absent (GAP-05).
      lit: typeof venue.lit === 'boolean' ? venue.lit : null,
      // Orchard Park's "20-min turnover is HARD here" note rides along
      // untouched. Acting on it is Phase 2's job, not this adapter's.
      notes: venue.notes ?? null,
      overlapNote: venue.overlapNote ?? null,
    });

    for (const field of venue.fields ?? []) {
      const surfaceId = season2026SurfaceId(venue.name, field.name);
      const previous = seenSurfaceIds.get(surfaceId);
      if (previous) {
        throw new Error(
          `season2026 facility adapter: "${venue.name}" / "${field.name}" and "${previous}" slugify to the same id "${surfaceId}"`
        );
      }
      seenSurfaceIds.set(surfaceId, `${venue.name} / ${field.name}`);

      surfaces.push({
        id: surfaceId,
        venueId,
        name: field.name,
        sizes: [...(field.sizes ?? [])],
        lined: [...(field.lined ?? [])],
        parentId: field.parent ? season2026SurfaceId(venue.name, field.parent) : null,
        childIds: (field.children ?? []).map((child) => season2026SurfaceId(venue.name, child)),
        // Parent pitches are bookable: "book Pitch 1 whole while 1A is busy"
        // must be rejected by occupancy, which names the real reason, and not
        // by a blanket "this surface cannot be booked".
        bookable: true,
        note: field.note ?? null,
      });
    }

    for (const [left, right] of venue.overlapPairs ?? []) {
      overlapPairs.push([
        season2026SurfaceId(venue.name, left),
        season2026SurfaceId(venue.name, right),
      ]);
    }
  }

  /** @type {Map<string, Object>} */
  const equipmentWindows = new Map();
  const exceptions = geometry.equipmentExceptions ?? [];
  for (let index = 0; index < exceptions.length; index += 1) {
    const entry = exceptions[index];
    const window = {
      id: `season2026-equipment-${index}`,
      equipment: entry.equipment,
      status: classifyEquipmentStatus(entry.status, { strict }),
      scope: { kind: 'venue', id: season2026VenueId(entry.venue) },
      // A single-date exception is a one-day range.
      fromDate: entry.date,
      toDate: entry.date,
      note: entry.status ?? null,
      source: `facility_geometry.json#equipment_exceptions[${index}]`,
    };
    equipmentWindows.set(equipmentKey(window), window);
  }

  // Overrides replace a corpus record with the same scope, equipment and date
  // range instead of sitting beside it. Two equally specific records that
  // disagree are a legitimate state the resolver reports as
  // EQUIPMENT_PRECEDENCE_AMBIGUOUS, but that is not what a caller asking
  // "what if this had been unavailable?" means.
  for (const override of options.equipmentOverrides ?? []) {
    const window = {
      note: null,
      source: 'equipmentOverrides',
      ...override,
      scope: { ...override.scope },
    };
    equipmentWindows.set(equipmentKey(window), window);
  }

  /** @type {Record<string, string[]>} */
  const formatEquipment = {};
  for (const [format, items] of Object.entries(
    options.formatEquipment ?? SEASON_2026_FORMAT_EQUIPMENT
  )) {
    formatEquipment[format] = [...items];
  }

  /** @type {Record<string, unknown>} */
  const input = {
    venues,
    surfaces,
    overlapPairs,
    equipmentWindows: [...equipmentWindows.values()],
    formatEquipment,
  };
  if (options.sizePolicy) input.sizePolicy = options.sizePolicy;
  if (options.sizeRank) input.sizeRank = { ...options.sizeRank };
  return /** @type {import('../types.js').FacilityGraphInput} */ (input);
}

/**
 * Build a facility graph from parsed season-2026 geometry.
 *
 * @param {{ venues: Array<Object>, fields?: Array<Object>, equipmentExceptions?: Array<Object> }} geometry
 * @param {{ strict?: boolean, equipmentOverrides?: Array<Object>, formatEquipment?: Record<string, ReadonlyArray<string>>, sizePolicy?: string, sizeRank?: Record<string, number> }} [options]
 * @returns {import('../types.js').FacilityGraph}
 */
export function buildFacilityGraphFromSeason2026(geometry, options = {}) {
  return buildFacilityGraph(toSeason2026FacilityGraphInput(geometry, options));
}
