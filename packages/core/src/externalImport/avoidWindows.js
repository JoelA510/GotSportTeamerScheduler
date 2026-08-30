/**
 * The avoid-windows round trip: what the other party must not schedule into,
 * written in **their** vocabulary, and read back through the same records.
 *
 * ## Why this exists, and what it would have prevented
 *
 * Incident 3. The external league published its seeding fixtures at 12:30 on
 * 2026-08-22; an 11v11 at 12:30 occupies Alder's Pitch 2 until 14:00; a 9v9
 * kicks off at 13:50 on Pitch 1A, which **physically overlaps Pitch 2**. Ten
 * minutes. The league could not have known: `overlap_pairs` is a fact about our
 * ground, and 1A is a pitch they have no name for and never see.
 *
 * So an avoid window published for `Alder Park (Back Pitch 2)` is **not** the
 * list of things booked on Pitch 2. It is the list of things booked anywhere in
 * Pitch 2's occupancy footprint — `facility/occupancy.js`
 * `conflictingSurfacesOf()`, the same cone every other module asks — with each
 * window saying which it is:
 * {@link import('./reasonCodes.js').EXTERNAL_AVOID_ORIGIN.OWN_SURFACE} or
 * {@link import('./reasonCodes.js').EXTERNAL_AVOID_ORIGIN.OVERLAPPING_SURFACE}.
 * An export that published only the pitch's own bookings would be an export that
 * reproduces incident 3 on request.
 *
 * ## Written in their naming, or not written
 *
 * Every window names an `externalLabel`, resolved **backwards** through the
 * mapping registry by {@link import('./mapping.js').reverseResolveSurface}. A
 * surface in the requested scope that no record claims is
 * {@link import('./reasonCodes.js').EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_UNMAPPED}
 * at **blocking** and produces no window: it is never exported under our own id,
 * because a document naming `alder-park/pitch-2` is a document the recipient
 * cannot act on and may silently ignore. One claimed by two labels is
 * `EXTERNAL_AVOID_LABEL_AMBIGUOUS`, also blocking, for the same reason in
 * reverse — picking one of them decides, silently, which name the recipient
 * reads.
 *
 * ## Windows are not merged
 *
 * One source fixture, one window. Merging adjacent windows would produce a
 * shorter document and would throw away which fixture each span belongs to and
 * whether it sits on the recipient's own pitch or behind it — the two things
 * that make a window explicable. The recipient may union them; this module will
 * not do it on their behalf and then be unable to say why a span exists.
 *
 * ## An unknown end stays unknown
 *
 * The corpus's `Scrimmage` rows have no `game_formats.csv` timing (GAP-14).
 * Their window is exported with `endMinutes: null` and
 * `EXTERNAL_AVOID_END_UNKNOWN` at `compromise` — *"this ground is occupied from
 * 17:20 for a time we do not know"*, which is true, rather than a closed window
 * built on a guessed footprint or a row quietly left out. {@link avoidWindowsAdmit}
 * answers `undetermined` against such a window and never `admitted`.
 *
 * @module externalImport/avoidWindows
 */

import { conflictingSurfacesOf } from '../facility/occupancy.js';
import { getSurface } from '../facility/facilityGraph.js';
import { naiveDateTime } from '../reserve/publication.js';

import {
  EXTERNAL_AVOID_ORIGIN,
  EXTERNAL_IMPACT_VERDICT,
  EXTERNAL_IMPORT_REASON,
  EXTERNAL_NAME_RESOLUTION,
  assertExternalImportFindings,
  createExternalImportMeta,
  deriveExternalImportStatus,
  makeExternalImportFinding,
} from './reasonCodes.js';
import {
  EXTERNAL_MAPPING_KIND,
  createMappingUsage,
  recordMappingUse,
  resolveExternalName,
  reverseResolveSurface,
} from './mapping.js';
import { AvoidWindowDocumentSchema, AvoidWindowQuerySchema } from './schemas.js';

/** The document version this module writes and reads. */
export const AVOID_WINDOW_DOCUMENT_VERSION = 1;

/**
 * **The fields {@link avoidWindowsAdmit} matches a proposal on**, and therefore
 * the fields a window must still carry after it has crossed the document
 * boundary and come back through {@link readAvoidWindowDocument}.
 *
 * It is a frozen list rather than four names remembered in three places because
 * of what happens when one of them is dropped: `avoidWindowsAdmit()` matches on
 * equality, so a window missing `externalLabel` matches *no* proposal and the
 * document answers `safe` to everything — a document whose entire purpose is to
 * refuse the league's 12:30 admitting it, with no error and no finding. A
 * membership comparison of window keys cannot see that; only asking the
 * read-back document the question the original was built to answer can.
 * `tests/externalFixtureImport.test.js` asserts every read-back window carries
 * all four, and proves the list is load bearing by deleting each in turn and
 * showing the 12:30 stops being refused.
 *
 * @type {ReadonlyArray<string>}
 */
export const AVOID_WINDOW_ADMISSION_FIELDS = Object.freeze([
  'date',
  'externalLabel',
  'startMinutes',
  'endMinutes',
]);

/**
 * Rendered for the document, so `TIME TBD` never becomes a fabricated clock.
 * `naiveDateTime()` from `reserve/publication.js` is the one GAP-30-safe
 * renderer in this repository and is reused rather than restated.
 */
const OPEN_ENDED = null;

/**
 * A stable identity for one window, used by the round-trip check.
 *
 * `externalLabel` is part of the identity and not merely `surfaceId`, because
 * the label is the half of a window the *recipient* reads and the half
 * {@link avoidWindowsAdmit} matches on. A key built from our surface id alone
 * calls two windows the same when they name different ground to the party the
 * document is for — which is how a document that came back having lost its
 * labels once passed the round-trip check while admitting everything.
 *
 * @param {{ date: string, externalLabel: string, surfaceId: string, startMinutes: number, endMinutes: number|null, sourceFixtureIds: ReadonlyArray<string> }} window
 * @returns {string}
 */
export function avoidWindowKey(window) {
  return [
    window.date,
    window.externalLabel,
    window.surfaceId,
    window.startMinutes,
    window.endMinutes === null ? 'open' : window.endMinutes,
    [...window.sourceFixtureIds].sort().join('~'),
  ].join('|');
}

/**
 * **Build the avoid-windows export.**
 *
 * @param {Object} input
 * @param {Object} input.query - see `AvoidWindowQuerySchema`
 * @param {import('./types.js').ExternalMappingRegistry} input.registry
 * @param {ReadonlyArray<Object>} input.standing - `StandingFixtureSchema` values
 * @param {import('../facility/types.js').FacilityGraph} input.graph
 * @returns {import('./types.js').AvoidWindowExport}
 */
export function buildAvoidWindows({ query, registry, standing, graph }) {
  const parsed = /** @type {any} */ (AvoidWindowQuerySchema.parse(query));
  const meta = createExternalImportMeta();
  meta.mappingRecordsDeclared = registry.records.length;
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];

  const dates = [...new Set(parsed.dates)].sort();
  const surfaceIds = [...new Set(parsed.surfaceIds)].sort();
  const excluded = new Set(parsed.excludeFixtureIds);

  if (dates.length === 0 || surfaceIds.length === 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_SCOPE_EMPTY,
        `${parsed.subject}: the export was asked for ${dates.length} date(s) and ${surfaceIds.length} surface(s); a document saying "avoid nothing" is the worst thing to send an external league and is refused rather than produced`,
        { subject: parsed.subject, dateCount: dates.length, surfaceCount: surfaceIds.length }
      )
    );
  }

  /** @type {import('./types.js').AvoidWindow[]} */
  const windows = [];
  /** @type {string[]} */
  const unmappedSurfaceIds = [];
  /** @type {Map<string, number>} */
  const overlapCounts = new Map();

  const byDate = new Map();
  for (const fixture of standing) {
    const date = /** @type {any} */ (fixture).date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(fixture);
  }

  for (const surfaceId of surfaceIds) {
    const label = reverseResolveSurface(registry, surfaceId);
    if (label.state !== EXTERNAL_NAME_RESOLUTION.RESOLVED) {
      unmappedSurfaceIds.push(surfaceId);
      const code =
        label.state === EXTERNAL_NAME_RESOLUTION.AMBIGUOUS
          ? EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_AMBIGUOUS
          : EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_UNMAPPED;
      findings.push(
        makeExternalImportFinding(
          code,
          code === EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_LABEL_AMBIGUOUS
            ? `${surfaceId} is claimed by ${label.candidateTargets.length} external labels (${label.candidateTargets.join(', ')}); choosing one would decide silently which name the recipient reads, so no window is exported for it`
            : `no mapping record gives ${surfaceId} an external name, so no window is exported for it; publishing it under our own id would send the recipient a line they cannot act on`,
          {
            surfaceId,
            surfaceName: getSurface(graph, surfaceId)?.name ?? null,
            candidateLabels: label.candidateTargets,
            recordIds: label.candidateRecordIds,
          }
        )
      );
      continue;
    }

    const externalLabel = /** @type {string} */ (label.candidateTargets[0]);
    // A record may name ground the graph does not hold — `readExternalMappingRegistry()`
    // reports that as `EXTERNAL_MAPPING_TARGET_UNKNOWN` and keeps the record, so
    // the label still reverse-resolves. Asking `conflictingSurfacesOf()` about
    // it throws out of `requireSurface()`, and an export that dies on one bad
    // record tells the operator nothing about the other surfaces in scope. The
    // occupancy footprint is unknowable here, so no window is produced and the
    // reason is published, exactly as it is for a surface with no external name.
    if (!getSurface(graph, surfaceId)) {
      unmappedSurfaceIds.push(surfaceId);
      findings.push(
        makeExternalImportFinding(
          EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_SURFACE_UNKNOWN,
          `${surfaceId} is claimed by the external label ${JSON.stringify(externalLabel)} but the facility graph does not hold it, so its occupancy footprint cannot be computed and no window is exported for it; the export reports this rather than failing whole`,
          {
            surfaceId,
            externalLabel,
            recordIds: label.candidateRecordIds,
            surfaceCount: graph.surfaceIds.length,
          }
        )
      );
      continue;
    }
    const cone = new Set(conflictingSurfacesOf(graph, surfaceId));
    for (const date of dates) {
      meta.avoidScopeCells += 1;
      const fixtures = (byDate.get(date) ?? []).filter(
        (fixture) =>
          cone.has(/** @type {any} */ (fixture).surfaceId) &&
          !excluded.has(/** @type {any} */ (fixture).fixtureId)
      );
      for (const fixture of fixtures) {
        const source = /** @type {any} */ (fixture);
        const origin =
          source.surfaceId === surfaceId
            ? EXTERNAL_AVOID_ORIGIN.OWN_SURFACE
            : EXTERNAL_AVOID_ORIGIN.OVERLAPPING_SURFACE;
        if (origin === EXTERNAL_AVOID_ORIGIN.OVERLAPPING_SURFACE) {
          const key = `${date}|${externalLabel}`;
          overlapCounts.set(key, (overlapCounts.get(key) ?? 0) + 1);
          meta.avoidWindowsFromOverlap += 1;
        }
        if (source.endMinutes === null) {
          meta.avoidWindowsOpenEnded += 1;
          findings.push(
            makeExternalImportFinding(
              EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_END_UNKNOWN,
              `${source.fixtureId} occupies ${source.surfaceId} on ${date} from minute ${source.startMinutes ?? source.kickoffMinutes} for a length ${source.format === null ? 'no format states' : `game_formats.csv does not state for ${source.format}`} (GAP-14); the window is exported open rather than closed by a guess or left out`,
              {
                fixtureId: source.fixtureId,
                surfaceId: source.surfaceId,
                externalLabel,
                date,
                startMinutes: source.kickoffMinutes,
                format: source.format,
              }
            )
          );
        }
        windows.push({
          date,
          externalLabel,
          venueId: source.venueId,
          surfaceId,
          startMinutes: source.kickoffMinutes,
          endMinutes: source.endMinutes,
          startAt: naiveDateTime(date, source.kickoffMinutes, 'TIME TBD'),
          endAt:
            source.endMinutes === null
              ? OPEN_ENDED
              : naiveDateTime(date, source.endMinutes, 'TIME TBD'),
          origin,
          sourceFixtureIds: [source.fixtureId],
          sourceSurfaceIds: [source.surfaceId],
        });
      }
    }
  }

  windows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.externalLabel.localeCompare(b.externalLabel) ||
      a.startMinutes - b.startMinutes ||
      a.sourceFixtureIds.join().localeCompare(b.sourceFixtureIds.join())
  );
  meta.avoidWindowsExported = windows.length;

  for (const [key, count] of [...overlapCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const separator = key.indexOf('|');
    const date = key.slice(0, separator);
    const externalLabel = key.slice(separator + 1);
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_WINDOW_FROM_OVERLAP,
        `${count} of the windows published for ${JSON.stringify(externalLabel)} on ${date} exist because ground that physically overlaps it is in use, not because that pitch is booked; the recipient has no name for those pitches and could not have derived these windows (incident 3)`,
        { date, externalLabel, count }
      )
    );
  }

  if (dates.length > 0 && surfaceIds.length > 0 && windows.length === 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_NONE_EXPORTED,
        `${parsed.subject}: ${surfaceIds.length} surface(s) over ${dates.length} date(s) produced no window at all, so this document tells the recipient nothing while looking like an answer`,
        {
          subject: parsed.subject,
          dates,
          surfaceIds,
          standingFixtures: standing.length,
          excludedFixtures: excluded.size,
        }
      )
    );
  }

  const document = /** @type {Object} */ (
    AvoidWindowDocumentSchema.parse({
      version: AVOID_WINDOW_DOCUMENT_VERSION,
      documentId: parsed.documentId,
      subject: parsed.subject,
      generatedFor: parsed.generatedFor,
      party: registry.party,
      dates,
      windows: windows.map((window) => ({
        date: window.date,
        externalLabel: window.externalLabel,
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
        startAt: window.startAt,
        endAt: window.endAt,
        origin: window.origin,
        sourceFixtureIds: window.sourceFixtureIds,
        sourceSurfaceIds: window.sourceSurfaceIds,
      })),
    })
  );

  assertExternalImportFindings(findings, `avoid-window export ${parsed.documentId}`);

  return {
    subject: parsed.subject,
    document,
    windows,
    unmappedSurfaceIds,
    findings,
    status: deriveExternalImportStatus(findings),
    meta,
  };
}

/**
 * **Read a document back**, resolving its labels forward through the same
 * registry that wrote them.
 *
 * There is no fast path that trusts a document because this module produced it:
 * a label the registry no longer claims is reported exactly as it would be on a
 * document from anybody else, which is what makes the round-trip check a check.
 *
 * @param {unknown} rawDocument
 * @param {import('./types.js').ExternalMappingRegistry} registry
 * @returns {{ windows: Array<{ date: string, externalLabel: string, surfaceId: string, venueId: string|null, startMinutes: number, endMinutes: number|null, origin: string, sourceFixtureIds: string[], sourceSurfaceIds: string[] }>, findings: import('./types.js').ExternalImportFinding[], status: string, meta: import('./types.js').ExternalImportMeta }}
 */
export function readAvoidWindowDocument(rawDocument, registry) {
  const document = /** @type {any} */ (AvoidWindowDocumentSchema.parse(rawDocument));
  const meta = createExternalImportMeta();
  meta.mappingRecordsDeclared = registry.records.length;
  const usage = createMappingUsage();
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];
  /** @type {Array<{ date: string, externalLabel: string, surfaceId: string, venueId: string|null, startMinutes: number, endMinutes: number|null, origin: string, sourceFixtureIds: string[], sourceSurfaceIds: string[] }>} */
  const windows = [];

  for (const window of document.windows) {
    const resolved = recordMappingUse(
      usage,
      resolveExternalName(registry, EXTERNAL_MAPPING_KIND.VENUE, window.externalLabel)
    );
    if (resolved.state !== EXTERNAL_NAME_RESOLUTION.RESOLVED) {
      const code =
        resolved.state === EXTERNAL_NAME_RESOLUTION.AMBIGUOUS
          ? EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_AMBIGUOUS
          : EXTERNAL_IMPORT_REASON.EXTERNAL_MAPPING_LABEL_UNRESOLVED;
      findings.push(
        makeExternalImportFinding(
          code,
          `avoid-window document ${document.documentId} names ${JSON.stringify(window.externalLabel)} on ${window.date}, which this registry ${resolved.state === EXTERNAL_NAME_RESOLUTION.AMBIGUOUS ? 'claims twice' : 'does not claim'}; the window is reported rather than dropped or guessed at`,
          {
            documentId: document.documentId,
            externalLabel: window.externalLabel,
            date: window.date,
            startMinutes: window.startMinutes,
            recordIds: resolved.candidateRecordIds,
          }
        )
      );
      continue;
    }
    meta.avoidWindowsReadBack += 1;
    windows.push({
      date: window.date,
      // Carried, not dropped. `avoidWindowsAdmit()` matches a proposal on the
      // label, so a read-back window without one matches nothing and answers
      // `safe` to every proposal — the document's own refusal, lost in the act
      // of reading it. See {@link AVOID_WINDOW_ADMISSION_FIELDS}.
      externalLabel: window.externalLabel,
      surfaceId: /** @type {string} */ (resolved.surfaceId),
      venueId: resolved.venueId,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
      origin: window.origin,
      sourceFixtureIds: [...window.sourceFixtureIds],
      sourceSurfaceIds: [...window.sourceSurfaceIds],
    });
  }

  meta.labelLookups = usage.lookups;
  meta.labelsResolved = usage.resolved;
  meta.labelsUnresolved = usage.unresolved;
  meta.labelsUnclaimedOptional = usage.unclaimedOptional;
  meta.labelsAmbiguous = usage.ambiguous;
  meta.mappingRecordsExercised = usage.usedRecordIds.size;

  assertExternalImportFindings(findings, `avoid-window document ${document.documentId}`);

  return { windows, findings, status: deriveExternalImportStatus(findings), meta };
}

/**
 * **The round trip, as a check rather than as a claim.**
 *
 * Reads the export's own document back and asserts that the windows it yields
 * are the windows it was built from, keyed by
 * {@link avoidWindowKey}. A divergence is
 * {@link import('./reasonCodes.js').EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_ROUNDTRIP_DIVERGED}
 * at blocking, naming both directions — a window that went out and did not come
 * back, and one that came back having never gone out.
 *
 * @param {import('./types.js').AvoidWindowExport} exported
 * @param {import('./types.js').ExternalMappingRegistry} registry
 * @returns {{ findings: import('./types.js').ExternalImportFinding[], status: string, missing: string[], unexpected: string[], meta: import('./types.js').ExternalImportMeta }}
 */
export function checkAvoidWindowRoundTrip(exported, registry) {
  const readBack = readAvoidWindowDocument(exported.document, registry);
  const sent = new Set(exported.windows.map((window) => avoidWindowKey(window)));
  const back = new Set(readBack.windows.map((window) => avoidWindowKey(window)));

  const missing = [...sent].filter((key) => !back.has(key)).sort();
  const unexpected = [...back].filter((key) => !sent.has(key)).sort();

  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [...readBack.findings];
  if (missing.length > 0 || unexpected.length > 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_AVOID_ROUNDTRIP_DIVERGED,
        `reading avoid-window document ${exported.document.documentId} back through the registry did not reproduce it: ${missing.length} window(s) went out and did not come back, ${unexpected.length} came back that never went out`,
        {
          documentId: exported.document.documentId,
          missing,
          unexpected,
          sent: sent.size,
          readBack: back.size,
        }
      )
    );
  }

  assertExternalImportFindings(findings, `avoid-window round trip ${exported.document.documentId}`);

  return {
    findings,
    status: deriveExternalImportStatus(findings),
    missing,
    unexpected,
    meta: readBack.meta,
  };
}

/**
 * **Would this document admit a proposed kickoff?**
 *
 * Three-valued, and the third value is the point. A window with no known end
 * cannot say whether a proposal collides with it, so a proposal that reaches one
 * is `undetermined` — never `admitted`, which is what a two-valued answer would
 * have to call it.
 *
 * `endMinutes` on the proposal is the caller's own worst-case occupancy end (see
 * `timing/formatTiming.js` `occupancyEndMinutes()`); a null proposal end is
 * undetermined for the same reason from the other side.
 *
 * @param {ReadonlyArray<{ date: string, externalLabel: string, startMinutes: number, endMinutes: number|null }>} windows
 * @param {{ date: string, externalLabel: string, startMinutes: number, endMinutes: number|null }} proposal
 * @returns {{ verdict: string, blockedBy: Array<{ startMinutes: number, endMinutes: number|null }>, undecidedAgainst: Array<{ startMinutes: number, endMinutes: number|null }> }}
 */
export function avoidWindowsAdmit(windows, proposal) {
  /** @type {Array<{ startMinutes: number, endMinutes: number|null }>} */
  const blockedBy = [];
  /** @type {Array<{ startMinutes: number, endMinutes: number|null }>} */
  const undecidedAgainst = [];

  for (const window of windows) {
    if (window.date !== proposal.date) continue;
    if (window.externalLabel !== proposal.externalLabel) continue;
    if (window.endMinutes === null || proposal.endMinutes === null) {
      undecidedAgainst.push({
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
      });
      continue;
    }
    // Half-open, exactly as `bookingsOverlapInTime()` reads a pair: touching is
    // not overlapping, and the two must agree or a proposal this module admits
    // would be one the facility layer refuses.
    if (proposal.startMinutes < window.endMinutes && window.startMinutes < proposal.endMinutes) {
      blockedBy.push({ startMinutes: window.startMinutes, endMinutes: window.endMinutes });
    }
  }

  if (blockedBy.length > 0) {
    return { verdict: EXTERNAL_IMPACT_VERDICT.UNSAFE, blockedBy, undecidedAgainst };
  }
  if (undecidedAgainst.length > 0) {
    return { verdict: EXTERNAL_IMPACT_VERDICT.UNDETERMINED, blockedBy, undecidedAgainst };
  }
  return { verdict: EXTERNAL_IMPACT_VERDICT.SAFE, blockedBy, undecidedAgainst };
}
