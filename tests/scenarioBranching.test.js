/**
 * **Scenario branching — Prompt 6.1.**
 *
 * > *"The source project needed parallel schedules for 'with/without venue A',
 * > 'with/without venue B', and 'with/without equipment at one site on one
 * > date'. Each was a hand-built duplicate of the entire pipeline, separately
 * > verified, and impossible to keep in sync."*
 *
 * The acceptance test the build plan names is `describe('the acceptance test')`:
 * *"build 'no venue X' from the fixture baseline, diff it, and confirm the
 * report identifies the affected format, the replacement venues, and the added
 * compromises (e.g. games on undersized or wrongly-lined pitches)."*
 *
 * It is worth nothing without `describe('the negative control')`, which runs the
 * **same branch with the relocation proposer switched off** and asserts that
 * every displaced game is TIME TBD naming `PERMIT_BLACKOUT` and that **no
 * replacement venue is named anywhere**. "We found replacements" only means
 * something if the alternative finds none.
 *
 * ## Every number here is derived from the corpus at test time
 *
 * No venue name, no field name, no clock time and no game id is typed in as an
 * expectation. The withdrawn venue is chosen **by a stated property** — the only
 * venue whose whole use is one format and which has more than one grade of
 * replacement available — and the test asserts that property rather than
 * asserting the name.
 *
 * ## The three named falsifications
 *
 * `describe('the three falsifications')` is not decoration. Three "a check that
 * cannot fail" defects have already been caught in fresh code in this project,
 * so each meta-assertion here has its failing case constructed and proven:
 * sharing (a record-copying materialiser fails the same assertion), the diff
 * partition (a dropped row and a double-counted row are each caught), and
 * vacuity (an override for ground the schedule never uses).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  buildAvailabilityCalendar,
  resolvePermitWindow,
  weekdayCodeOf,
} from '@squadlogic/core/availability/index.js';
import { toAvailabilityCalendarInput } from '@squadlogic/core/availability/adapters/season2026Permits.js';
import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_TYPE,
  SEASON_2026_CONSTRAINTS,
  buildSeason2026ConstraintRegistry,
} from '@squadlogic/core/constraints/index.js';
import {
  buildFacilityGraphFromSeason2026,
  buildSeason2026VenueComplexMap,
  checkLining,
  checkSizeEligibility,
  toSeason2026FacilityGraphInput,
} from '@squadlogic/core/facility/index.js';
import { FACILITY_STATUS } from '@squadlogic/core/facility/reasonCodes.js';
import {
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadSeason2026,
  loadSunsets,
} from '@squadlogic/core/fixtures/index.js';
import { PUBLICATION_TBD } from '@squadlogic/core/reserve/index.js';
import { candidateSlotsFor, RESOLVE_OBJECTIVE_WEIGHTS } from '@squadlogic/core/resolve/index.js';
import { runRuleEngine } from '@squadlogic/core/ruleEngine/index.js';
import { toSeason2026Schedule } from '@squadlogic/core/ruleEngine/adapters/season2026Schedule.js';
import {
  buildFormatTimingTableFromSeason2026,
  toFormatTimingInput,
} from '@squadlogic/core/timing/index.js';
import { verifySnapshotDigest } from '@squadlogic/core/publication/index.js';
import {
  RELOCATION_POLICY,
  REPLACEMENT_GRADE,
  SCENARIO_OVERRIDE_KIND,
  SCENARIO_REASON,
  SCENARIO_RECORD_SET,
  ScenarioMemo,
  diffAgainstBaselineScenario,
  diffScenarios,
  diffSchedules,
  expandVenueUnavailable,
  makeScenario,
  makeSeasonInputs,
  materialiseScenario,
  promoteScenario,
  proposeRelocations,
  replacementSurfacesFor,
  runScenario,
  scenarioFingerprint,
  scheduleDiffPartitionFindings,
  season2026CapacitySubjects,
  shelveUnrelocatable,
  season2026EarliestKickoffFor,
  season2026RelocationPolicy,
  season2026SeasonInputs,
  season2026VenueUnavailableScenario,
} from '@squadlogic/core/scenario/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, engines and the baseline bundle, assembled once                     */
/* -------------------------------------------------------------------------- */

const season = loadSeason2026();
const geometry = loadFacilityGeometry();
const facilityInput = toSeason2026FacilityGraphInput(geometry);
const graph = buildFacilityGraphFromSeason2026(geometry);
const rawFormats = loadGameFormats();
const timingInput = toFormatTimingInput(rawFormats);
const table = buildFormatTimingTableFromSeason2026(rawFormats);
const sunsets = loadSunsets();
/** Derived from the corpus rather than typed in, so a re-dated fixture moves it. */
const SEASON_YEAR = Number(sunsets[0].date.slice(0, 4));
const calendarInput = toAvailabilityCalendarInput(
  loadFacilityPermits({ seasonYear: SEASON_YEAR }),
  sunsets
);
const calendar = buildAvailabilityCalendar(calendarInput);
const registry = buildSeason2026ConstraintRegistry();
const venueComplexes = buildSeason2026VenueComplexMap();
const schedule = toSeason2026Schedule(season);
const resources = { graph, timingTable: table, calendar, venueComplexes };
const baselineEngines = { graph, table, calendar, registry, resources };
const baselineVerification = runRuleEngine(schedule, { registry, resources });

/** The baseline bundle every branch below is built over. */
const inputs = season2026SeasonInputs({
  schedule,
  facilityInput,
  timingInput,
  calendarInput,
  constraints: SEASON_2026_CONSTRAINTS,
  venueComplexes,
});

/** Who each branch below says it was asked for by. Never a clock read. */
const REQUESTED_BY = 'ops@club.example';
const REQUESTED_AT = '2026-08-01T09:00:00';

/* -------------------------------------------------------------------------- */
/* Choosing the venue by a stated property, not by name                        */
/* -------------------------------------------------------------------------- */

/**
 * What each venue in the corpus carries, derived from the schedule.
 *
 * @returns {Array<{ venueId: string, games: number, formats: string[], dates: string[] }>}
 */
function venueProfiles() {
  /** @type {Map<string, { venueId: string, games: number, formats: Set<string>, dates: Set<string> }>} */
  const byVenue = new Map();
  for (const game of schedule.games) {
    const entry = byVenue.get(game.venueId) ?? {
      venueId: game.venueId,
      games: 0,
      formats: new Set(),
      dates: new Set(),
    };
    entry.games += 1;
    if (game.format) entry.formats.add(game.format);
    entry.dates.add(game.date);
    byVenue.set(game.venueId, entry);
  }
  return [...byVenue.values()]
    .map((entry) => ({
      venueId: entry.venueId,
      games: entry.games,
      formats: [...entry.formats].sort(),
      dates: [...entry.dates].sort(),
    }))
    .sort((a, b) => b.games - a.games || a.venueId.localeCompare(b.venueId));
}

/**
 * The venue whose withdrawal produces the report the acceptance test describes.
 *
 * Chosen by three stated properties, all read from the corpus:
 *
 * 1. it hosts exactly **one** format, so "the affected format" is unambiguous;
 * 2. the format has replacement ground elsewhere, so there is something to name;
 * 3. that ground carries **more than one grade** of replacement, so there are
 *    *added compromises* rather than a clean swap.
 *
 * Two venues satisfy all three on this corpus, and the largest is taken — the
 * withdrawal that displaces the most games is the one an operator actually asks
 * about. The test asserts the property and the ordering rather than the name.
 */
const CANDIDATE_WITHDRAWALS = venueProfiles().filter((profile) => {
  if (profile.formats.length !== 1) return false;
  const surfaces = replacementSurfacesFor(graph, {
    format: profile.formats[0],
    excludeVenueIds: [profile.venueId],
    maxGradesAbove: 1,
  });
  if (surfaces.length === 0) return false;
  const grades = new Set(
    surfaces.map((surfaceId) =>
      checkLining(graph, { surfaceId, format: profile.formats[0] }).status ===
      FACILITY_STATUS.ALLOWED
        ? REPLACEMENT_GRADE.CLEAN
        : REPLACEMENT_GRADE.COMPROMISED
    )
  );
  return grades.size > 1;
});

const WITHDRAWN = CANDIDATE_WITHDRAWALS[0];
const AFFECTED_FORMAT = WITHDRAWN.formats[0];

const scenario = season2026VenueUnavailableScenario({
  venueId: WITHDRAWN.venueId,
  baselineId: inputs.id,
  requestedBy: REQUESTED_BY,
  at: REQUESTED_AT,
});

const policy = season2026RelocationPolicy({
  graph,
  table,
  format: AFFECTED_FORMAT,
  excludeVenueIds: [WITHDRAWN.venueId],
  games: schedule.games,
});

const requirement = {
  slots: Math.max(
    ...WITHDRAWN.dates.map(
      (date) =>
        schedule.games.filter((g) => g.venueId === WITHDRAWN.venueId && g.date === date).length
    )
  ),
  label: `the games ${WITHDRAWN.venueId} held on its busiest date`,
  source: 'derived from fixtures/season-2026/combined_schedule.csv',
};

const runOptions = {
  baselineEngines,
  baselineVerification,
  relocationPolicy: policy,
  requirement,
};

/** The branch, searched. */
const result = runScenario(inputs, scenario, runOptions);

/** The same branch, with the search switched off. */
const control = runScenario(inputs, scenario, { ...runOptions, relocations: false });

const capacitySubjects = season2026CapacitySubjects({
  graph,
  table,
  format: AFFECTED_FORMAT,
  dates: WITHDRAWN.dates,
  // Both sides of the delta count the *same* ground: the replacement surfaces
  // plus the ones being withdrawn. Counting only the survivors would report a
  // capacity gain, because the withdrawn ground would never have been in the
  // baseline number either.
  surfaceIds: [
    ...policy.surfaceIds,
    ...new Set(
      schedule.games.filter((g) => g.venueId === WITHDRAWN.venueId).map((g) => g.surfaceId)
    ),
  ],
  requirement,
  games: schedule.games,
});

const diff = diffAgainstBaselineScenario(result, {
  baselineEngines,
  baselineVerification,
  capacitySubjects,
});

const controlDiff = diffAgainstBaselineScenario(control, {
  baselineEngines,
  baselineVerification,
  capacitySubjects,
});

/** The baseline rows by id, for the footprints and labels a proposal travels with. */
const gamesById = Object.fromEntries(schedule.games.map((game) => [String(game.id), game]));

/** Every code a list of findings carries. */
const codesOf = (findings) => findings.map((finding) => finding.code);

/* -------------------------------------------------------------------------- */

describe('the corpus supports the question being asked', () => {
  it('finds the venue whose withdrawal produces the acceptance test report', () => {
    // The meta-assertion the whole file rests on. A filter that matched nothing
    // would make every assertion below vacuous, and the ordering is asserted so
    // that the subject is the largest such withdrawal rather than whichever
    // happened to sort first.
    const profiles = venueProfiles();
    expect(profiles.length).toBeGreaterThan(4);
    expect(CANDIDATE_WITHDRAWALS.length).toBeGreaterThanOrEqual(1);
    expect(CANDIDATE_WITHDRAWALS.length).toBeLessThan(profiles.length);
    expect(WITHDRAWN.games).toBe(Math.max(...CANDIDATE_WITHDRAWALS.map((p) => p.games)));
    expect(WITHDRAWN.games).toBeGreaterThan(50);
    expect(WITHDRAWN.dates.length).toBeGreaterThan(5);
    // Every venue the filter rejected is rejected for a stated reason, and at
    // least one is rejected by each of the three.
    const rejected = profiles.filter(
      (profile) => !CANDIDATE_WITHDRAWALS.some((c) => c.venueId === profile.venueId)
    );
    expect(rejected.some((profile) => profile.formats.length > 1)).toBe(true);
    expect(
      rejected.some((profile) => {
        if (profile.formats.length !== 1) return false;
        const surfaces = replacementSurfacesFor(graph, {
          format: profile.formats[0],
          excludeVenueIds: [profile.venueId],
          maxGradesAbove: 1,
        });
        const grades = new Set(
          surfaces.map(
            (surfaceId) =>
              checkLining(graph, { surfaceId, format: profile.formats[0] }).status ===
              FACILITY_STATUS.ALLOWED
          )
        );
        // Rejected because every replacement is the same grade: there would be
        // no *added compromise* to report, which is a third of the answer.
        return surfaces.length > 0 && grades.size === 1;
      })
    ).toBe(true);
  });

  it('anchors the candidate grid where the season actually starts this format', () => {
    // Not the club's blanket 08:00: the two differ here, and a grid laid at a
    // cadence of the format's own block from the wrong anchor falls **between**
    // every published kickoff, so no relocated game could ever keep its time.
    const anchor = season2026EarliestKickoffFor(schedule.games, AFFECTED_FORMAT);
    const published = [
      ...new Set(
        schedule.games.filter((g) => g.format === AFFECTED_FORMAT).map((g) => g.startMinutes)
      ),
    ].sort((a, b) => a - b);
    expect(published.length).toBeGreaterThan(3);
    expect(anchor).toBe(published[0]);
    expect(policy.earliestKickoffMinutes).toBe(anchor);
    // …and the cadence is the format's own block, read from the timing table.
    expect(policy.cadenceMinutes).toBe(table.formats[AFFECTED_FORMAT].blockMinutes);
    // Every published kickoff of this format lands on the grid the policy lays.
    for (const kickoff of published) {
      expect((kickoff - anchor) % policy.cadenceMinutes, String(kickoff)).toBe(0);
    }
  });
});

describe('the acceptance test :: build "no venue X", diff it, read the report', () => {
  it('identifies the affected format, and only that one', () => {
    expect(result.displaced.length).toBe(WITHDRAWN.games);
    const formats = [...new Set(result.displaced.map((game) => game.format))];
    expect(formats).toEqual([AFFECTED_FORMAT]);
    // Enumerated from the schedule rather than from the run, so a run that
    // under-counted is caught rather than believed.
    const standing = schedule.games
      .filter((game) => game.venueId === WITHDRAWN.venueId)
      .map((game) => String(game.id))
      .sort();
    expect(result.displaced.map((game) => game.gameId).sort()).toEqual(standing);
    const displacedFinding = result.findings.find(
      (finding) => finding.code === SCENARIO_REASON.SCENARIO_GAME_DISPLACED
    );
    expect(displacedFinding?.details.formats).toEqual([AFFECTED_FORMAT]);
    expect(displacedFinding?.details.venueIds).toEqual([WITHDRAWN.venueId]);
  });

  it('names the replacement venues, with a grade for each', () => {
    expect(result.relocations.proposals.length).toBeGreaterThan(0);
    const venues = [...new Set(result.relocations.proposals.map((p) => p.toVenueId))].sort();
    // Every replacement is somewhere else, is size-eligible for the format, and
    // is one of the surfaces the policy stated.
    expect(venues).not.toContain(WITHDRAWN.venueId);
    for (const proposal of result.relocations.proposals) {
      expect(policy.surfaceIds, proposal.gameId).toContain(proposal.to.surfaceId);
      expect(
        checkSizeEligibility(graph, { surfaceId: proposal.to.surfaceId, format: AFFECTED_FORMAT })
          .status,
        proposal.to.surfaceId
      ).not.toBe(FACILITY_STATUS.REJECTED);
      // The date never moves: families have the date, and the policy says so.
      expect(proposal.to.date).toBe(proposal.from.date);
    }
    // **Two grades**, which is what makes "added compromises" a real column.
    const grades = new Set(result.relocations.proposals.map((p) => p.grade));
    expect([...grades].sort()).toEqual([REPLACEMENT_GRADE.CLEAN, REPLACEMENT_GRADE.COMPROMISED]);
    // The clean ground is lined for the format; the compromised ground is not.
    for (const proposal of result.relocations.proposals) {
      const lining = checkLining(graph, {
        surfaceId: proposal.to.surfaceId,
        format: AFFECTED_FORMAT,
      });
      expect(lining.status === FACILITY_STATUS.ALLOWED, proposal.to.surfaceId).toBe(
        proposal.grade === REPLACEMENT_GRADE.CLEAN
      );
    }
    const finding = result.findings.find(
      (f) => f.code === SCENARIO_REASON.SCENARIO_RELOCATION_PROPOSED
    );
    expect(finding?.details.venueIds).toEqual(venues);
    expect(finding?.details.proposed).toBe(result.relocations.proposals.length);
  });

  it('names the added compromises, and they are the corpus’s own', () => {
    const compromised = result.relocations.proposals.filter(
      (p) => p.grade === REPLACEMENT_GRADE.COMPROMISED
    );
    expect(compromised.length).toBeGreaterThan(0);
    const codes = [...new Set(compromised.flatMap((p) => p.compromiseCodes))].sort();
    expect(codes).toEqual(['LINING_MISMATCH']);
    // The rule engine agrees, independently: the branch's schedule carries
    // exactly that many more of the code than the baseline did.
    expect(diff.constraints.byCode.LINING_MISMATCH.delta).toBe(compromised.length);
    expect(diff.constraints.newlyViolated).toContain('LINING_MISMATCH');
    expect(codesOf(result.findings)).toContain(SCENARIO_REASON.SCENARIO_RELOCATION_COMPROMISED);
  });

  it('reports "undersized" as unreachable rather than manufacturing it', () => {
    // The build plan's example names *"undersized or wrongly-lined pitches"*.
    // Only the second half is deliverable, and the reason is a property of the
    // model rather than of this corpus: SIZE_TOO_SMALL is blocking and the size
    // policy is downward-closed, so a game is refused rather than placed on
    // ground too small for it. Asserted here so a later change that quietly
    // softened the size constraint would fail this test rather than pass it.
    const tooSmall = Object.values(graph.surfaces).filter(
      (surface) =>
        checkSizeEligibility(graph, { surfaceId: surface.id, format: AFFECTED_FORMAT }).status ===
        FACILITY_STATUS.REJECTED
    );
    expect(tooSmall.length).toBeGreaterThan(0);
    for (const surface of tooSmall) {
      expect(policy.surfaceIds, surface.id).not.toContain(surface.id);
      expect(
        result.relocations.proposals.map((p) => p.to.surfaceId),
        surface.id
      ).not.toContain(surface.id);
    }
  });

  it('keeps every fixture it cannot place visible, with a reason (incident 10)', () => {
    expect(result.relocations.unrelocatable.length).toBeGreaterThan(0);
    expect(result.unplaced.length).toBe(result.relocations.unrelocatable.length);
    for (const fixture of result.unplaced) {
      expect(fixture.timeStatus).toBe(PUBLICATION_TBD.TIME);
      expect(fixture.locationStatus).toBe(PUBLICATION_TBD.LOCATION);
      expect(fixture.reason.length).toBeGreaterThan(20);
      // The machine-readable half beside the sentence, from the branch's own
      // finding rather than from a third opinion about why.
      expect(fixture.reasonCodes).toContain('PERMIT_BLACKOUT');
      expect(fixture.constraintIds.length).toBeGreaterThan(0);
      expect(fixture.publishedSurfaceId?.startsWith(WITHDRAWN.venueId)).toBe(true);
    }
    // …and nothing was silently dropped: the accounting is against the
    // baseline's own ids, never against the run's output.
    expect(result.accounting.missingFixtureIds).toEqual([]);
    expect(result.accounting.doubleCountedFixtureIds).toEqual([]);
    expect(result.accounting.totals.expected).toBe(schedule.games.length);
    expect(result.accounting.totals.accounted).toBe(schedule.games.length);
    expect(result.accounting.meta.fixturesAccountedFor).toBe(schedule.games.length);
    expect(result.accounting.meta.fixturesTimeTbd).toBe(result.unplaced.length);
    expect(result.schedule.games.length).toBe(schedule.games.length - result.unplaced.length);
  });

  it('accounts for every displaced game as either relocated or TIME TBD', () => {
    const proposed = result.relocations.proposals.map((p) => p.gameId);
    const shelved = result.relocations.unrelocatable.map((u) => u.gameId);
    expect(proposed.length + shelved.length).toBe(result.displaced.length);
    expect([...proposed, ...shelved].sort()).toEqual(
      result.displaced.map((game) => game.gameId).sort()
    );
    expect(new Set([...proposed, ...shelved]).size).toBe(result.displaced.length);
  });

  it('produces a different season under a different stated policy', () => {
    // "Under a stated policy" is only meaningful if the policy changes the
    // answer. The same displaced set, the same ground, the same engines — and a
    // different allocation, which is why every proposal and every finding
    // carries the policy it was made under.
    const clean = proposeRelocations(result.materialised.engines, {
      displaced: result.displaced,
      survivors: schedule.games.filter(
        (game) => !result.displaced.some((d) => d.gameId === String(game.id))
      ),
      gamesById: Object.fromEntries(schedule.games.map((game) => [String(game.id), game])),
      policy: { ...policy, policy: RELOCATION_POLICY.PREFER_CLEAN },
      requirement,
    });
    expect(clean.policy).toBe(RELOCATION_POLICY.PREFER_CLEAN);
    expect(result.relocations.policy).toBe(RELOCATION_POLICY.NEAREST_KICKOFF);
    // It keeps more games on cleanly-lined ground…
    const cleanCount = (plan) =>
      plan.proposals.filter((p) => p.grade === REPLACEMENT_GRADE.CLEAN).length;
    expect(cleanCount(clean)).toBeGreaterThan(cleanCount(result.relocations));
    // …and pays for it in drift from the published kickoff.
    const totalDrift = (plan) => plan.proposals.reduce((sum, p) => sum + p.driftMinutes, 0);
    expect(totalDrift(clean)).toBeGreaterThan(totalDrift(result.relocations));
    for (const proposal of clean.proposals) {
      expect(proposal.policy).toBe(RELOCATION_POLICY.PREFER_CLEAN);
    }
  });

  it('says the replacements were proposed, not solved — and the re-solver could not have found them', () => {
    const finding = result.findings.find(
      (f) => f.code === SCENARIO_REASON.SCENARIO_RELOCATION_PROPOSED
    );
    expect(finding?.details.policy).toBe(policy.policy);
    expect(finding?.details.policySource).toBe(policy.source);
    expect(finding?.message).toMatch(/proposed/i);
    expect(finding?.details.candidatesConsidered).toBeGreaterThan(
      result.relocations.proposals.length
    );

    // The structural half of the claim: `candidateSlotsFor()` derives its
    // candidate venue from the game's own anchor surface and fixes every
    // candidate at the anchor's date, so a re-solve of this branch could never
    // have offered a slot at another venue. Read off the run's own state.
    const run = /** @type {any} */ (result.run);
    expect(run).not.toBeNull();
    const sample = result.displaced[0];
    const anchor = {
      date: sample.date,
      surfaceId: sample.surfaceId,
      startMinutes: sample.startMinutes,
    };
    const offered = candidateSlotsFor(
      run.state,
      sample.gameId,
      anchor,
      RESOLVE_OBJECTIVE_WEIGHTS
    ).filter(
      (slot) =>
        !(run.state.admittedSlotsByGameId[sample.gameId] ?? []).includes(
          `${slot.date}|${slot.surfaceId}|${slot.startMinutes}`
        )
    );
    expect(offered.length).toBeGreaterThan(0);
    for (const slot of offered) {
      expect(slot.date, JSON.stringify(slot)).toBe(anchor.date);
      expect(slot.surfaceId.startsWith(WITHDRAWN.venueId), JSON.stringify(slot)).toBe(true);
    }
  });

  it('answers the three things the diff is optimised for, and nothing else', () => {
    // (1) which games differ
    expect(diff.games.changed.length).toBe(result.relocations.proposals.length);
    expect(diff.games.removed.length).toBe(result.unplaced.length);
    expect(diff.games.added.length).toBe(0);
    expect(diff.games.unchanged).toBe(schedule.games.length - result.displaced.length);
    for (const change of diff.games.changed) {
      expect(change.changedFields.length).toBeGreaterThan(0);
      expect(change.before).not.toBeNull();
      expect(change.after).not.toBeNull();
    }

    // (2) which constraints break, "newly" rather than "at all"
    expect(diff.constraints.measured).toBe(true);
    expect(diff.constraints.newlyViolated.length).toBeGreaterThan(0);
    for (const code of diff.constraints.newlyViolated) {
      expect(diff.constraints.byCode[code].delta, code).toBeGreaterThan(0);
    }
    // The season's own 62 accepted exceptions are not reported as introduced.
    expect(baselineVerification.violations.length).toBeGreaterThan(0);
    const unchangedCodes = Object.entries(diff.constraints.byCode)
      .filter(([, counts]) => counts.delta === 0)
      .map(([code]) => code);
    expect(unchangedCodes.length).toBeGreaterThan(0);
    for (const code of unchangedCodes) {
      expect(diff.constraints.newlyViolated, code).not.toContain(code);
    }

    // (3) what capacity is lost, per stated subject and never as one scalar
    expect(diff.capacity).toHaveLength(capacitySubjects.length);
    const [subject] = diff.capacity;
    expect(subject.format).toBe(AFFECTED_FORMAT);
    expect(subject.leftSlots).toBeGreaterThan(subject.rightSlots);
    expect(subject.delta).toBe(subject.rightSlots - subject.leftSlots);
    expect(Object.keys(subject.byDate).sort()).toEqual([...WITHDRAWN.dates].sort());
    for (const date of WITHDRAWN.dates) {
      expect(subject.byDate[date].delta, date).toBeLessThan(0);
    }
    // The delta is the sum of the per-date deltas, and nothing claims to be a
    // season-wide "capacity lost" number.
    expect(Object.values(subject.byDate).reduce((sum, entry) => sum + entry.delta, 0)).toBe(
      subject.delta
    );

    // and the quality delta, through the one fitness function
    expect(diff.quality.measured).toBe(true);
    expect(diff.quality.delta).toBe(diff.quality.right - diff.quality.left);
    expect(diff.quality.delta).toBeGreaterThan(0);
  });
});

describe('the negative control :: the same branch with the proposer switched off', () => {
  it('carries every displaced game as TIME TBD naming the code the branch introduced', () => {
    expect(control.displaced.map((g) => g.gameId).sort()).toEqual(
      result.displaced.map((g) => g.gameId).sort()
    );
    expect(control.relocations.proposals).toEqual([]);
    expect(control.unplaced.length).toBe(control.displaced.length);
    for (const fixture of control.unplaced) {
      expect(fixture.timeStatus).toBe(PUBLICATION_TBD.TIME);
      expect(fixture.reasonCodes).toEqual(['PERMIT_BLACKOUT']);
    }
    expect(codesOf(control.findings)).toContain(SCENARIO_REASON.SCENARIO_RELOCATIONS_DISABLED);
  });

  it('names no replacement venue anywhere in its report', () => {
    // The whole point of the control. Every finding detail is scanned, not just
    // the ones this test expects to be empty.
    const named = new Set();
    for (const finding of control.findings) {
      for (const value of Object.values(finding.details)) {
        for (const entry of Array.isArray(value) ? value : [value]) {
          if (typeof entry !== 'string') continue;
          for (const surface of Object.values(graph.surfaces)) {
            if (entry.includes(surface.id) || entry === surface.venueId) named.add(surface.venueId);
          }
        }
      }
    }
    expect([...named].sort()).toEqual([WITHDRAWN.venueId]);
    expect(controlDiff.games.changed).toEqual([]);
    expect(controlDiff.games.removed.length).toBe(control.displaced.length);
  });

  it('is strictly worse than the searched run, by the one objective', () => {
    // "We found replacements" only means something because the alternative is
    // measurably worse under the same score.
    expect(controlDiff.quality.right).toBeGreaterThan(diff.quality.right);
    expect(control.schedule.games.length).toBeLessThan(result.schedule.games.length);
  });
});

describe('the three falsifications', () => {
  /* -- 1. sharing --------------------------------------------------------- */

  it('shares one record set across five branches, and a copying materialiser does not', () => {
    // Own the record objects so the mutation below cannot reach the module-level
    // seed array every other test in the repository reads.
    const owned = SEASON_2026_CONSTRAINTS.map((record) => ({ ...record }));
    const bundle = season2026SeasonInputs({
      schedule,
      facilityInput,
      timingInput,
      calendarInput,
      constraints: owned,
      venueComplexes,
      id: 'sharing-baseline',
    });
    const branches = ['a', 'b', 'c', 'd', 'e'].map((suffix) =>
      season2026VenueUnavailableScenario({
        venueId: WITHDRAWN.venueId,
        baselineId: bundle.id,
        requestedBy: REQUESTED_BY,
        at: REQUESTED_AT,
        id: `no-venue-${suffix}`,
        dates: [WITHDRAWN.dates[0]],
      })
    );

    // **The fix, applied once.** A constraint record is corrected in the
    // baseline and nothing is rebuilt, re-materialised or re-registered.
    const MARKER = 'corrected once, in the baseline, at 2026-08-02T10:00:00';
    const target = owned.find((record) => record.enforcement === 'reason-codes');
    expect(target).toBeDefined();
    /** @type {any} */ (target).rationale = MARKER;

    const seen = branches.map(
      (branch) =>
        materialiseScenario(bundle, branch).engines.registry.byId[/** @type {any} */ (target).id]
          .rationale
    );
    expect(seen).toHaveLength(5);
    expect(seen).toEqual([MARKER, MARKER, MARKER, MARKER, MARKER]);
    // …and the sharing is structural: the sets no override touched are the same
    // array object the baseline holds.
    for (const branch of branches) {
      const materialised = materialiseScenario(bundle, branch);
      expect(materialised.sharedRecordSets).toContain(SCENARIO_RECORD_SET.CONSTRAINTS);
      expect(materialised.records[SCENARIO_RECORD_SET.CONSTRAINTS]).toBe(bundle.constraints);
      expect(materialised.meta.recordSetsShared).toBeGreaterThan(0);
    }

    // **The falsification.** A materialiser that copied the record arrays —
    // which is exactly what five hand-built pipelines are — fails the same
    // assertion, so the assertion above is a check rather than a sentence.
    const copying = (base) => ({
      ...base,
      constraints: base.constraints.map((record) => ({ ...record })),
    });
    const copied = copying(bundle);
    /** @type {any} */ (target).rationale = 'a second correction, applied to the baseline only';
    const copiedSeen = copied.constraints.find(
      (record) => record.id === /** @type {any} */ (target).id
    ).rationale;
    expect(copiedSeen).toBe(MARKER);
    expect(copiedSeen).not.toBe(/** @type {any} */ (target).rationale);
    // …while the shared bundle does see it.
    expect(
      materialiseScenario(bundle, branches[0]).engines.registry.byId[/** @type {any} */ (target).id]
        .rationale
    ).toBe(/** @type {any} */ (target).rationale);
  });

  /* -- 2. the partition --------------------------------------------------- */

  it('reconciles the diff partition against both inputs, and catches a drop and a double-count', () => {
    const partition = diffSchedules({
      left: schedule.games,
      right: result.schedule.games,
    });
    // The honest partition reconciles from both sides and reports nothing.
    expect(
      scheduleDiffPartitionFindings(partition, {
        leftCount: schedule.games.length,
        rightCount: result.schedule.games.length,
      })
    ).toEqual([]);
    expect(
      partition.changed.length +
        partition.added.length +
        partition.removed.length +
        partition.unchanged.length
    ).toBe(schedule.games.length);

    // **A dropped row.** One changed game removed from the partition: both
    // sides now come up one short.
    const dropped = { ...partition, changed: partition.changed.slice(1) };
    const droppedFindings = scheduleDiffPartitionFindings(dropped, {
      leftCount: schedule.games.length,
      rightCount: result.schedule.games.length,
    });
    expect(droppedFindings.length).toBeGreaterThanOrEqual(2);
    expect(codesOf(droppedFindings)).toContain(SCENARIO_REASON.SCENARIO_DIFF_PARTITION_INCOMPLETE);
    for (const finding of droppedFindings) {
      expect(finding.severity).toBe(CONSTRAINT_SEVERITY.BLOCKING);
    }

    // **A double-counted row.** A game in two buckets at once.
    const doubled = {
      ...partition,
      removed: [...partition.removed, { ...partition.changed[0], before: null, after: null }],
    };
    const doubledFindings = scheduleDiffPartitionFindings(doubled, {
      leftCount: schedule.games.length,
      rightCount: result.schedule.games.length,
    });
    expect(codesOf(doubledFindings)).toContain(SCENARIO_REASON.SCENARIO_DIFF_PARTITION_INCOMPLETE);
    expect(
      doubledFindings.some((finding) => finding.details.side === 'both'),
      'the double-count must be caught by identity, not only by the totals'
    ).toBe(true);
  });

  /* -- 3. vacuity --------------------------------------------------------- */

  it('reports an override for ground the schedule never uses as vacuous', () => {
    // Every venue the corpus declares but never schedules a game at. If the
    // corpus ever schedules all of them, this test says so rather than passing.
    const used = new Set(schedule.games.map((game) => game.venueId));
    const unused = Object.values(graph.venues)
      .map((venue) => venue.id)
      .filter((venueId) => !used.has(venueId));
    const venueId = unused[0] ?? 'a-venue-this-corpus-does-not-have';

    const vacuous = makeScenario({
      id: 'vacuous-branch',
      name: 'without ground nobody uses',
      baselineId: inputs.id,
      rationale: 'the positive control for vacuity detection',
      requestedBy: REQUESTED_BY,
      createdAt: REQUESTED_AT,
      overrides: [
        {
          kind: SCENARIO_OVERRIDE_KIND.ADD,
          recordSet: SCENARIO_RECORD_SET.PERMITS,
          record: {
            id: 'vacuous-blackout',
            venueId,
            scopeKind: 'weekday-default',
            weekday: 'SAT',
            date: null,
            hasPermit: false,
            openMinutes: null,
            closeMinutes: null,
            lit: null,
            lightsOffMinutes: null,
            note: 'a venue this schedule never uses',
            source: 'test',
          },
          by: REQUESTED_BY,
          at: REQUESTED_AT,
          reason: 'withdraw ground the schedule never stands on',
        },
      ],
    });

    const vacuousResult = runScenario(inputs, vacuous, runOptions);
    expect(vacuousResult.displaced).toEqual([]);
    expect(codesOf(vacuousResult.findings)).toContain(SCENARIO_REASON.SCENARIO_OVERRIDE_VACUOUS);
    const finding = vacuousResult.findings.find(
      (f) => f.code === SCENARIO_REASON.SCENARIO_OVERRIDE_VACUOUS
    );
    // The same severity `CONSTRAINT_PROJECTION_VACUOUS` carries, and for the
    // same reason: a query that examined nothing must not read as a clean pass.
    expect(finding?.severity).toBe(CONSTRAINT_SEVERITY.COMPROMISE);
    // …and the branch that is *not* vacuous does not carry it.
    expect(codesOf(result.findings)).not.toContain(SCENARIO_REASON.SCENARIO_OVERRIDE_VACUOUS);
  });
});

describe('overrides are set operations on record arrays, not a fourth precedence ladder', () => {
  it('expands one venueId into a complete set of permit edits', () => {
    const [override] = scenario.overrides;
    const expansion = expandVenueUnavailable(override, inputs.permits);
    // Every base row for the venue is withdrawn…
    const mine = inputs.permits.filter((row) => row.venueId === WITHDRAWN.venueId);
    expect(mine.length).toBeGreaterThan(0);
    expect(expansion.removeIds.sort()).toEqual(mine.map((row) => String(row.id)).sort());
    // …and a blackout is laid on every weekday, so no date can fall through a
    // weekday nobody enumerated.
    expect(expansion.added).toHaveLength(7);
    expect([...new Set(expansion.added.map((row) => row.weekday))].sort()).toEqual([
      'FRI',
      'MON',
      'SAT',
      'SUN',
      'THU',
      'TUE',
      'WED',
    ]);
    for (const row of expansion.added) {
      expect(row.hasPermit).toBe(false);
      expect(row.openMinutes).toBeNull();
      expect(row.closeMinutes).toBeNull();
    }
  });

  it('withdraws the venue’s own rows, because a blackout beside an open window is ambiguous', () => {
    const branchCalendar = result.materialised.engines.calendar;
    for (const date of WITHDRAWN.dates) {
      const resolved = resolvePermitWindow(branchCalendar, {
        venueId: WITHDRAWN.venueId,
        date,
      });
      expect(resolved.window?.hasPermit, date).toBe(false);
      expect(resolved.ambiguous, date).toBe(false);
    }

    // **The falsification.** A branch that only *adds* the blackout, leaving the
    // venue's open window in place, resolves to the same blackout — and reports
    // the ambiguity on every consultation. That is what `remove` is for.
    const addOnly = makeScenario({
      id: 'add-only-blackout',
      name: 'blackout laid beside the open window',
      baselineId: inputs.id,
      rationale: 'the falsification for "remove is not convenience"',
      requestedBy: REQUESTED_BY,
      createdAt: REQUESTED_AT,
      overrides: expandVenueUnavailable(scenario.overrides[0], inputs.permits).added.map(
        (record) => ({
          kind: SCENARIO_OVERRIDE_KIND.ADD,
          recordSet: SCENARIO_RECORD_SET.PERMITS,
          record,
          by: REQUESTED_BY,
          at: REQUESTED_AT,
          reason: 'blackout only, with the open window left standing',
        })
      ),
    });
    const addOnlyCalendar = materialiseScenario(inputs, addOnly).engines.calendar;
    const resolved = resolvePermitWindow(addOnlyCalendar, {
      venueId: WITHDRAWN.venueId,
      date: WITHDRAWN.dates[0],
    });
    expect(resolved.window?.hasPermit).toBe(false);
    expect(resolved.ambiguous).toBe(true);
  });

  it('reports two overrides touching one record as a conflict, not a precedence question', () => {
    const victim = String(inputs.permits[0].id);
    const conflicted = makeScenario({
      id: 'conflicted',
      name: 'two edits, one record',
      baselineId: inputs.id,
      rationale: 'the positive control for override conflict detection',
      requestedBy: REQUESTED_BY,
      createdAt: REQUESTED_AT,
      overrides: [
        {
          kind: SCENARIO_OVERRIDE_KIND.REMOVE,
          recordSet: SCENARIO_RECORD_SET.PERMITS,
          recordId: victim,
          by: 'first@club.example',
          at: REQUESTED_AT,
          reason: 'the permit was withdrawn',
        },
        {
          kind: SCENARIO_OVERRIDE_KIND.REMOVE,
          recordSet: SCENARIO_RECORD_SET.PERMITS,
          recordId: victim,
          by: 'second@club.example',
          at: REQUESTED_AT,
          reason: 'the permit was withdrawn again',
        },
      ],
    });
    const materialised = materialiseScenario(inputs, conflicted);
    const finding = materialised.findings.find(
      (f) => f.code === SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe(CONSTRAINT_SEVERITY.BLOCKING);
    expect(finding?.details.recordId).toBe(victim);
    // The second edit is *not* applied: a conflict is reported rather than
    // resolved by picking a winner.
    expect(materialised.meta.recordsRemoved).toBe(1);
  });

  it('refuses an override whose target the baseline does not hold, or whose id collides', () => {
    const missing = materialiseScenario(
      inputs,
      makeScenario({
        id: 'missing-target',
        name: 'withdraw a record nobody has',
        baselineId: inputs.id,
        rationale: 'the positive control for a missing override target',
        requestedBy: REQUESTED_BY,
        createdAt: REQUESTED_AT,
        overrides: [
          {
            kind: SCENARIO_OVERRIDE_KIND.REMOVE,
            recordSet: SCENARIO_RECORD_SET.PERMITS,
            recordId: 'no-such-permit-row',
            by: REQUESTED_BY,
            at: REQUESTED_AT,
            reason: 'this record does not exist',
          },
        ],
      })
    );
    expect(codesOf(missing.findings)).toContain(SCENARIO_REASON.SCENARIO_OVERRIDE_TARGET_MISSING);
    expect(missing.status).toBe('rejected');

    const collides = materialiseScenario(
      inputs,
      makeScenario({
        id: 'collides',
        name: 'add a record that already exists',
        baselineId: inputs.id,
        rationale: 'the positive control for an id collision',
        requestedBy: REQUESTED_BY,
        createdAt: REQUESTED_AT,
        overrides: [
          {
            kind: SCENARIO_OVERRIDE_KIND.ADD,
            recordSet: SCENARIO_RECORD_SET.PERMITS,
            record: { ...inputs.permits[0] },
            by: REQUESTED_BY,
            at: REQUESTED_AT,
            reason: 'an id the baseline already holds',
          },
        ],
      })
    );
    expect(codesOf(collides.findings)).toContain(SCENARIO_REASON.SCENARIO_OVERRIDE_ID_COLLIDES);
  });

  it('writes a retype through retypeConstraint(), so the history is the one existing kind', () => {
    // A record with no history of its own, so "the history grew by exactly one"
    // is a statement about this branch rather than about the corpus's own
    // recorded type changes.
    const soft = registry.constraints.find(
      (record) =>
        record.type === CONSTRAINT_TYPE.HARD &&
        record.enforcement === 'reason-codes' &&
        record.history.length === 0
    );
    expect(soft).toBeDefined();
    const retyped = materialiseScenario(
      inputs,
      makeScenario({
        id: 'softened',
        name: 'what if this were a preference?',
        baselineId: inputs.id,
        rationale: 'the branch that asks what a hard rule costs',
        requestedBy: REQUESTED_BY,
        createdAt: REQUESTED_AT,
        overrides: [
          {
            kind: SCENARIO_OVERRIDE_KIND.RETYPE,
            recordSet: SCENARIO_RECORD_SET.CONSTRAINTS,
            recordId: /** @type {any} */ (soft).id,
            type: CONSTRAINT_TYPE.SOFT,
            weight: 5,
            by: REQUESTED_BY,
            at: REQUESTED_AT,
            reason: 'the board asked what this rule costs as a soft constraint',
          },
        ],
      })
    );
    const record = retyped.engines.registry.byId[/** @type {any} */ (soft).id];
    expect(record.type).toBe(CONSTRAINT_TYPE.SOFT);
    expect(record.weight).toBe(5);
    // The history `retypeConstraint()` writes, not a second one.
    expect(record.history).toHaveLength(1);
    expect(record.history[0]).toMatchObject({
      from: CONSTRAINT_TYPE.HARD,
      to: CONSTRAINT_TYPE.SOFT,
      by: REQUESTED_BY,
      // The constraint model stamps a type change with the calendar date the
      // decision was taken; the override carries the naive timestamp the rest
      // of this package uses, and the date is its leading ten characters.
      at: REQUESTED_AT.slice(0, 10),
    });
    // The baseline is untouched: a branch edits nothing a sibling can see.
    expect(registry.byId[/** @type {any} */ (soft).id].type).toBe(CONSTRAINT_TYPE.HARD);
    expect(retyped.meta.recordsRetyped).toBe(1);
  });

  it('composes a branch of a branch, parent first', () => {
    const child = season2026VenueUnavailableScenario({
      venueId: WITHDRAWN.venueId,
      baselineId: inputs.id,
      requestedBy: REQUESTED_BY,
      at: REQUESTED_AT,
      id: 'child-branch',
      parentScenarioId: scenario.id,
      dates: [WITHDRAWN.dates[0]],
    });
    // A child materialised without its ancestry is a branch missing half its
    // edits, and is refused rather than silently answered.
    expect(() => materialiseScenario(inputs, child)).toThrow(/options\.ancestry/);
    const materialised = materialiseScenario(inputs, child, { ancestry: [scenario] });
    expect(codesOf(materialised.findings)).toContain(
      SCENARIO_REASON.SCENARIO_BRANCHED_FROM_SCENARIO
    );
    expect(materialised.meta.overridesDeclared).toBe(2);
    // The parent already withdrew every row for the venue, so the child's
    // date-scoped withdrawal collides with the parent's blanket blackout rather
    // than quietly re-applying: a conflict, reported.
    expect(materialised.overrides).toHaveLength(2);
    expect(materialised.overrides[0]).toBe(scenario.overrides[0]);
  });

  it('refuses a scenario that overrides nothing, or branches from the wrong baseline', () => {
    expect(() =>
      makeScenario({
        id: 'empty',
        name: 'the baseline under a second name',
        baselineId: inputs.id,
        rationale: 'nothing',
        requestedBy: REQUESTED_BY,
        overrides: [],
      })
    ).toThrow();
    expect(() =>
      materialiseScenario(makeSeasonInputs({ ...inputs, id: 'another-baseline' }), scenario)
    ).toThrow(/branches from baseline/);
  });
});

describe('the memo :: lazily derived, fingerprinted, never stored on the scenario', () => {
  it('holds no schedule and no records on the scenario record itself', () => {
    // The source project's failure, refused structurally: a scenario is an id,
    // a baseline, a parent, a list of edits and a reason.
    expect(Object.keys(scenario).sort()).toEqual([
      'baselineId',
      'createdAt',
      'id',
      'name',
      'overrides',
      'parentScenarioId',
      'rationale',
      'requestedBy',
    ]);
    expect(Object.isFrozen(scenario)).toBe(true);
  });

  it('re-derives rather than serving a result whose fingerprint has moved', () => {
    const owned = SEASON_2026_CONSTRAINTS.map((record) => ({ ...record }));
    const bundle = season2026SeasonInputs({
      schedule,
      facilityInput,
      timingInput,
      calendarInput,
      constraints: owned,
      venueComplexes,
      id: 'memo-baseline',
    });
    const branch = season2026VenueUnavailableScenario({
      venueId: WITHDRAWN.venueId,
      baselineId: bundle.id,
      requestedBy: REQUESTED_BY,
      at: REQUESTED_AT,
      dates: [WITHDRAWN.dates[0]],
    });
    const memo = new ScenarioMemo();
    const first = memo.resolve(bundle, branch, runOptions);
    const second = memo.resolve(bundle, branch, runOptions);
    expect(second).toBe(first);
    expect(memo.hits).toBe(1);
    expect(memo.misses).toBe(1);
    expect(memo.check(bundle, branch)).toEqual([]);

    // **The fingerprint moves when the records do.** A bundle rebuilt over the
    // edited records digests differently, and the cached result is refused.
    /** @type {any} */ (owned[0]).rationale = 'edited after the branch was derived';
    const rebuilt = season2026SeasonInputs({
      schedule,
      facilityInput,
      timingInput,
      calendarInput,
      constraints: owned,
      venueComplexes,
      id: 'memo-baseline',
    });
    expect(rebuilt.digest).not.toBe(bundle.digest);
    const stale = memo.check(rebuilt, branch);
    expect(codesOf(stale)).toEqual([SCENARIO_REASON.SCENARIO_RESULT_STALE]);
    expect(stale[0].severity).toBe(CONSTRAINT_SEVERITY.BLOCKING);
    memo.resolve(rebuilt, branch, runOptions);
    expect(memo.misses).toBe(2);
  });

  it('fingerprints the records and the overrides, and nothing else', () => {
    // A fingerprint that read scenario metadata would derive a check's subject
    // from data the corruption it detects would also change.
    const renamed = makeScenario({
      ...scenario,
      name: 'the same branch under a different name',
      rationale: 'a different rationale entirely',
      requestedBy: 'somebody-else@club.example',
      createdAt: '2027-01-01T00:00:00',
    });
    expect(scenarioFingerprint(inputs, renamed.overrides)).toBe(
      scenarioFingerprint(inputs, scenario.overrides)
    );
    const different = season2026VenueUnavailableScenario({
      venueId: WITHDRAWN.venueId,
      baselineId: inputs.id,
      requestedBy: REQUESTED_BY,
      at: REQUESTED_AT,
      dates: [WITHDRAWN.dates[0]],
    });
    expect(scenarioFingerprint(inputs, different.overrides)).not.toBe(
      scenarioFingerprint(inputs, scenario.overrides)
    );
  });
});

describe('promotion :: a new primary plus the recorded diff', () => {
  const promotion = promoteScenario({
    result,
    diff,
    promotionId: 'promotion-no-venue',
    promotedAt: '2026-08-05T12:00:00',
    promotedBy: 'board@club.example',
    rationale: 'the board accepted the reduced-venue plan at its August meeting',
  });

  it('records the diff on the promotion, in an immutable digest-stamped artifact', () => {
    expect(codesOf(promotion.findings)).toEqual([SCENARIO_REASON.SCENARIO_PROMOTED]);
    expect(promotion.diff).toBe(diff);
    expect(promotion.snapshot.rowCount).toBe(
      diff.games.changed.length + diff.games.added.length + diff.games.removed.length
    );
    expect(verifySnapshotDigest(promotion.snapshot)).toEqual([]);
    expect(promotion.durability).toBe('in-memory');
    // Nothing read a clock: both stamps are the caller's.
    expect(promotion.snapshot.publishedAt).toBe('2026-08-05T12:00:00');
    expect(promotion.snapshot.publishedBy).toBe('board@club.example');
    // A shelved game records as a removal carrying both TBD tokens.
    const removed = promotion.snapshot.rows.filter((row) => row.bucket === 'removed');
    expect(removed.length).toBe(diff.games.removed.length);
    for (const row of removed) {
      expect(row.after).toContain(PUBLICATION_TBD.TIME);
      expect(row.after).toContain(PUBLICATION_TBD.LOCATION);
    }
  });

  it('makes the branch primary while preserving the sharing', () => {
    expect(promotion.primary.id).toBe('promotion-no-venue');
    expect(promotion.primary.schedule).toBe(result.schedule);
    // The permit rows changed…
    expect(promotion.primary.permits).not.toBe(inputs.permits);
    expect(promotion.primary.digest).not.toBe(inputs.digest);
    // …and every set the branch did not touch is still the baseline's own
    // array, so a fix applied to the old bundle is still one fix.
    for (const set of result.materialised.sharedRecordSets) {
      expect(promotion.primary[set], set).toBe(inputs[set]);
    }
    expect(result.materialised.sharedRecordSets.length).toBeGreaterThan(0);
    expect(promotion.meta.scenariosPromoted).toBe(1);
  });

  it('refuses to promote over a blocking finding nobody accepted', () => {
    const broken = {
      ...result,
      findings: [
        ...result.findings,
        {
          code: SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT,
          severity: CONSTRAINT_SEVERITY.BLOCKING,
          message: 'a constructed blocking finding',
          details: {},
        },
      ],
    };
    expect(() =>
      promoteScenario({
        result: /** @type {any} */ (broken),
        diff,
        promotionId: 'promotion-refused',
        promotedAt: '2026-08-05T12:00:00',
        promotedBy: 'board@club.example',
        rationale: 'this must not go through',
      })
    ).toThrow(/refusing to promote/);
    // …and it does go through when the objection is accepted by code, which is
    // the same contract `commitResolve()` keeps.
    const forced = promoteScenario({
      result: /** @type {any} */ (broken),
      diff,
      promotionId: 'promotion-accepted',
      promotedAt: '2026-08-05T12:00:00',
      promotedBy: 'board@club.example',
      rationale: 'the conflict was reviewed and accepted',
      acceptFindingCodes: [SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT],
    });
    expect(forced.acceptedFindingCodes).toEqual([SCENARIO_REASON.SCENARIO_OVERRIDE_CONFLICT]);
  });
});

describe('the diff refuses to fabricate', () => {
  it('reports no capacity at all when no subject is stated', () => {
    const unstated = diffAgainstBaselineScenario(result, {
      baselineEngines,
      baselineVerification,
    });
    expect(unstated.capacity).toEqual([]);
    expect(codesOf(unstated.findings)).toContain(
      SCENARIO_REASON.SCENARIO_CAPACITY_SUBJECT_UNSTATED
    );
    expect(unstated.status).toBe('compromised');
  });

  it('reports a comparison nobody measured as vacuous rather than clean', () => {
    const unmeasured = diffScenarios({
      subject: 'two branches nobody ran the rule engine over',
      left: { label: 'left', schedule, verification: null },
      right: { label: 'right', schedule: result.schedule, verification: null },
      weights: RESOLVE_OBJECTIVE_WEIGHTS,
    });
    expect(codesOf(unmeasured.findings)).toContain(SCENARIO_REASON.SCENARIO_DIFF_VACUOUS);
    expect(unmeasured.constraints.measured).toBe(false);
    expect(unmeasured.quality.measured).toBe(false);
    expect(diff.findings.map((f) => f.code)).not.toContain(SCENARIO_REASON.SCENARIO_DIFF_VACUOUS);
  });

  it('refuses a diff that does not say what it is a comparison of', () => {
    expect(() =>
      diffScenarios({
        subject: '',
        left: { label: 'left', schedule, verification: null },
        right: { label: 'right', schedule, verification: null },
        weights: RESOLVE_OBJECTIVE_WEIGHTS,
      })
    ).toThrow(/what it is a comparison of/);
  });

  it('refuses a proposer with no stated candidate ground and no stated anchor', () => {
    const engines = result.materialised.engines;
    expect(() =>
      proposeRelocations(engines, {
        displaced: result.displaced,
        survivors: [],
        gamesById: {},
        policy: { ...policy, surfaceIds: [] },
        requirement,
      })
    ).toThrow();
    expect(() =>
      proposeRelocations(engines, {
        displaced: result.displaced,
        survivors: [],
        gamesById: {},
        policy: { ...policy, earliestKickoffMinutes: undefined },
        requirement,
      })
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Structural guarantees: no parallel version of anything                      */
/* -------------------------------------------------------------------------- */

describe('structural guarantees', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const CORE = path.join(ROOT, 'packages', 'core', 'src');

  /**
   * @param {string} dir
   * @returns {string[]}
   */
  function filesUnder(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) files.push(...filesUnder(full));
      else if (entry.endsWith('.js')) files.push(full);
    }
    return files;
  }

  const coreFiles = filesUnder(CORE);
  const sources = coreFiles.map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
    /** Prose quotes the rules it explains, so the checks below read code only. */
    code: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }));
  const scenarioSources = sources.filter((source) =>
    source.file.startsWith(path.join(CORE, 'scenario'))
  );

  it('scans a plausible number of files', () => {
    expect(coreFiles.length).toBeGreaterThan(80);
    expect(scenarioSources.length).toBeGreaterThanOrEqual(7);
  });

  it("computes a Schedule slot's changed fields in exactly one file", () => {
    // `publication/parity.js` also builds a `changedFields` list, over the
    // export column vocabulary; it names no surface. `placement/replaceGames.js`
    // builds one too, over `PlacementChange` — the Prompt 2.1 demonstration
    // harness, which is date-less by construction (`surfaceId` and
    // `kickoffMinutes`, no date) and is deliberately not superseded.
    //
    // The computation this phase must not duplicate is the one over a
    // `Schedule` slot — date, surface, kickoff — and both the re-solver's diff
    // and the scenario diff ask it of the same exported function.
    const computing = sources.filter(
      (source) => /changedFields\.push\(/.test(source.code) && /surfaceId/.test(source.code)
    );
    expect(computing.map((source) => path.basename(source.file)).sort()).toEqual([
      'replaceGames.js',
      'state.js',
    ]);
    const overSlots = computing.filter((source) =>
      /changedFields\.push\('startMinutes'\)/.test(source.code)
    );
    expect(overSlots.map((source) => path.basename(source.file))).toEqual(['state.js']);
    for (const source of scenarioSources) {
      if (!/slotChangedFields/.test(source.code)) continue;
      expect(/from '.*resolve\/state\.js'/.test(source.code), source.file).toBe(true);
    }
  });

  it('adds no fitness function and reaches for neither existing one', () => {
    for (const source of scenarioSources) {
      expect(/\*\s*weight\b/.test(source.code), source.file).toBe(false);
      expect(/\bweight\s*\*/.test(source.code), source.file).toBe(false);
      expect(/computeFitness/.test(source.code), source.file).toBe(false);
      expect(/fitness/i.test(source.code), source.file).toBe(false);
    }
    // Everything quality goes through the one scorer.
    const scoring = scenarioSources.filter((source) =>
      /scoreSchedule|scoreObjective/.test(source.code)
    );
    expect(scoring.map((source) => path.basename(source.file))).toEqual(['diff.js']);
  });

  it('reads no clock and constructs no Date', () => {
    for (const source of scenarioSources) {
      expect(/new Date\(/.test(source.code), source.file).toBe(false);
      expect(/Date\.now\(/.test(source.code), source.file).toBe(false);
    }
  });

  it('leaves the two shipping solvers alone and writes no SQL', () => {
    for (const source of scenarioSources) {
      expect(/from '.*autoScheduler\.js'/.test(source.code), source.file).toBe(false);
      expect(/from '.*gameMetrics\.js'/.test(source.code), source.file).toBe(false);
      expect(/from '.*gameScheduling\.js'/.test(source.code), source.file).toBe(false);
      expect(/supabase/i.test(source.code), source.file).toBe(false);
    }
  });

  it('forks none of the three specificity ladders', () => {
    // Overrides are set operations applied before anything is built, so none of
    // the three existing precedence ladders applies and a fourth would be the
    // parallel machinery this phase exists to avoid.
    for (const source of scenarioSources) {
      expect(/SPECIFICITY\s*=/.test(source.code), source.file).toBe(false);
      expect(/TIE_BREAK\s*=/.test(source.code), source.file).toBe(false);
    }
  });

  it('registers every export in the package barrel', () => {
    const barrel = readFileSync(path.join(CORE, 'scenario', 'index.js'), 'utf8');
    /** @type {string[]} */
    const exported = [];
    for (const source of scenarioSources) {
      if (source.file.endsWith(path.join('scenario', 'index.js'))) continue;
      if (source.file.endsWith('types.js')) continue;
      for (const match of source.code.matchAll(/export (?:function|const|class) (\w+)/g)) {
        exported.push(match[1]);
      }
    }
    expect(exported.length).toBeGreaterThan(25);
    for (const name of exported) {
      expect(barrel, name).toContain(name);
    }
  });

  it('does not unify with the orphaned SQL scenario table or the teaming snapshot', () => {
    for (const source of scenarioSources) {
      expect(/field_availability_scenarios/.test(source.code), source.file).toBe(false);
      expect(/from '.*teamSnapshot\.js'/.test(source.code), source.file).toBe(false);
      expect(/SnapshotStatus/.test(source.code), source.file).toBe(false);
    }
    // Both are named in prose, once each, so the distinction is recorded rather
    // than merely observed.
    const prose = scenarioSources.map((source) => source.text).join('\n');
    expect(prose).toContain('field_availability_scenarios');
    expect(prose).toContain('teamSnapshot.js');
  });
});

/* -------------------------------------------------------------------------- */
/* The eleven defects the pre-PR review found, each with its failing case      */
/* -------------------------------------------------------------------------- */

describe('the memo answers the question it was asked, not merely the branch', () => {
  it('never serves the negative control as the searched answer', () => {
    // **The defect this exists to catch.** The memo keyed on the scenario id and
    // a digest of inputs and overrides alone, so two runs that differ only by a
    // run option were one entry. The negative control differs from the
    // acceptance run by exactly one run option, so the memo could serve the
    // control — nought proposals, seventy-two shelved — as the evidence the
    // whole prompt rests on.
    const memo = new ScenarioMemo();
    const viaMemoControl = memo.resolve(inputs, scenario, { ...runOptions, relocations: false });
    const viaMemoSearched = memo.resolve(inputs, scenario, runOptions);

    expect(viaMemoSearched).not.toBe(viaMemoControl);
    expect(memo.misses).toBe(2);
    expect(memo.hits).toBe(0);
    expect(viaMemoControl.relocations.proposals).toEqual([]);
    expect(viaMemoSearched.relocations.proposals.length).toBeGreaterThan(0);

    // …and the same question asked twice is still one derivation.
    expect(memo.resolve(inputs, scenario, runOptions)).toBe(viaMemoSearched);
    expect(memo.hits).toBe(1);
    expect(memo.misses).toBe(2);
  });

  it('separates two runs that differ only by the stated relocation policy', () => {
    const memo = new ScenarioMemo();
    const nearest = memo.resolve(inputs, scenario, runOptions);
    const preferClean = memo.resolve(inputs, scenario, {
      ...runOptions,
      relocationPolicy: { ...policy, policy: RELOCATION_POLICY.PREFER_CLEAN },
    });
    expect(preferClean).not.toBe(nearest);
    expect(nearest.relocations.policy).toBe(RELOCATION_POLICY.NEAREST_KICKOFF);
    expect(preferClean.relocations.policy).toBe(RELOCATION_POLICY.PREFER_CLEAN);
  });

  it('re-establishes the acceptance and the control figures through the memo path', () => {
    // The acceptance numbers in `docs/SCENARIOS.md` were read off direct
    // `runScenario()` calls. Under the defect above the memo path could have
    // produced different ones, so both paths are asserted to agree here rather
    // than one being assumed from the other.
    const memo = new ScenarioMemo();
    const viaMemoSearched = memo.resolve(inputs, scenario, runOptions);
    const viaMemoControl = memo.resolve(inputs, scenario, { ...runOptions, relocations: false });
    const gradeCount = (plan, grade) => plan.proposals.filter((p) => p.grade === grade).length;

    expect(viaMemoSearched.displaced.length).toBe(result.displaced.length);
    expect(gradeCount(viaMemoSearched.relocations, REPLACEMENT_GRADE.CLEAN)).toBe(
      gradeCount(result.relocations, REPLACEMENT_GRADE.CLEAN)
    );
    expect(gradeCount(viaMemoSearched.relocations, REPLACEMENT_GRADE.COMPROMISED)).toBe(
      gradeCount(result.relocations, REPLACEMENT_GRADE.COMPROMISED)
    );
    expect(viaMemoSearched.unplaced.length).toBe(result.unplaced.length);
    expect(viaMemoSearched.schedule.games.length).toBe(result.schedule.games.length);

    expect(viaMemoControl.displaced.length).toBe(control.displaced.length);
    expect(viaMemoControl.relocations.proposals.length).toBe(0);
    expect(viaMemoControl.unplaced.length).toBe(control.unplaced.length);
  });
});

describe('nothing a branch loses is answered by silence', () => {
  it('carries the fixture accounting’s verdict into the findings and the status', () => {
    // `accountForFixtures()` exists to catch a fixture that disappears — the
    // whole of incident 10 — and its verdict was being computed, stored on
    // `result.accounting`, and then dropped before `result.status` was derived.
    // A branch that lost a game read `ok`, and `promoteScenario()` would have
    // promoted it.
    expect(result.accounting.findings.length).toBeGreaterThan(0);
    const carried = codesOf(result.findings);
    for (const finding of result.accounting.findings) {
      expect(carried, finding.code).toContain(finding.code);
    }

    // The consequence, on the run that shows it most plainly: the negative
    // control shelves every displaced game and must not read as a clean branch.
    expect(control.unplaced.length).toBe(control.displaced.length);
    expect(control.unplaced.length).toBeGreaterThan(0);
    expect(control.status).not.toBe('allowed');
  });

  it('carries the re-solve’s own findings into the result', () => {
    // The `applyChangeRequest()` run's findings were discarded wholesale, so
    // every verdict the re-solver reached about the branch's own changes —
    // including the new violations it verified into existence — was invisible
    // to `result.status` and to anything reading `result.findings`.
    const run = /** @type {any} */ (result.run);
    expect(run).not.toBeNull();
    expect(run.findings.length).toBeGreaterThan(0);
    const carried = new Set(codesOf(result.findings));
    for (const code of new Set(run.findings.map((finding) => finding.code))) {
      expect(carried, code).toContain(code);
    }
  });

  it('reports an unrelocatable game the schedule no longer holds rather than skipping it', () => {
    // The second mechanism in the same sequence. `shelveUnrelocatable()` walked
    // past an entry naming a game the schedule does not hold — `continue`, no
    // finding, no counter — so a game the re-solve had already dropped was
    // dropped a second time here and never reached `result.unplaced`.
    const shelving = shelveUnrelocatable(
      result.schedule,
      [
        {
          gameId: 'a-game-the-schedule-no-longer-holds',
          label: 'gone v vanished',
          reason: 'the re-solve left it nowhere to stand',
          codes: Object.freeze(['PERMIT_BLACKOUT']),
          constraintIds: Object.freeze(['permit-window']),
          candidatesConsidered: 0,
        },
      ],
      { name: 'the falsification for the silent skip', registry }
    );
    expect(shelving.shelved).toEqual([]);
    expect(shelving.unshelvable).toEqual(['a-game-the-schedule-no-longer-holds']);
  });

  it('accounts for the re-solve’s unplaced fixtures as well as its own shelving', () => {
    const run = /** @type {any} */ (result.run);
    expect(result.unplaced.length).toBe(
      result.relocations.unrelocatable.length + run.unplaced.length
    );
    expect(result.accounting.missingFixtureIds).toEqual([]);
  });
});

describe('the two record sets a branch may override are load-bearing', () => {
  /**
   * A violation the branch's own registry says may be waived, and the person it
   * is about. Derived from the corpus, never named: a waiver has to be an
   * exception *to* something, and only two of this season's constraints admit
   * one at all.
   */
  const waivable = baselineVerification.violations.find(
    (violation) =>
      violation.constraintId &&
      registry.byId[violation.constraintId]?.waivable === true &&
      violation.details?.personId
  );

  /**
   * A branch that moves nothing, so the waiver is the only thing under test.
   *
   * The same shape the vacuity control uses: ground the schedule never stands
   * on. A branch that displaced games would change which violations exist and
   * make "the waiver did it" impossible to claim.
   */
  const quietBranch = (() => {
    const used = new Set(schedule.games.map((game) => game.venueId));
    const venueId =
      Object.values(graph.venues)
        .map((venue) => venue.id)
        .find((id) => !used.has(id)) ?? 'a-venue-this-corpus-does-not-have';
    return (baselineId) =>
      makeScenario({
        id: 'a-branch-that-moves-nothing',
        name: 'ground the schedule never stands on',
        baselineId,
        rationale: 'so the record set under test is the only thing that differs',
        requestedBy: REQUESTED_BY,
        createdAt: REQUESTED_AT,
        overrides: [
          {
            kind: SCENARIO_OVERRIDE_KIND.ADD,
            recordSet: SCENARIO_RECORD_SET.PERMITS,
            record: {
              id: 'a-blackout-nobody-notices',
              venueId,
              scopeKind: 'weekday-default',
              weekday: 'SAT',
              date: null,
              hasPermit: false,
              openMinutes: null,
              closeMinutes: null,
              lit: null,
              lightsOffMinutes: null,
              note: 'a venue this schedule never uses',
              source: 'the regression',
            },
            by: REQUESTED_BY,
            at: REQUESTED_AT,
            reason: 'withdraw ground the schedule never stands on',
          },
        ],
      });
  })();

  const bundleWith = (extra) =>
    season2026SeasonInputs({
      schedule,
      facilityInput,
      timingInput,
      calendarInput,
      constraints: SEASON_2026_CONSTRAINTS,
      venueComplexes,
      ...extra,
    });

  it('honours a waiver the branch’s own record set carries', () => {
    // Meta-assertion: with no waivable violation in the corpus there would be
    // nothing for a waiver to excuse, and everything below would pass on air.
    expect(waivable, 'a violation of a constraint this season says may be waived').toBeDefined();
    const constraintId = /** @type {any} */ (waivable).constraintId;
    const personId = /** @type {any} */ (waivable).details.personId;

    const waived = bundleWith({
      waivers: [
        {
          id: 'waiver-the-branch-carries',
          constraintId,
          name: 'the exception the board granted',
          scope: { personId },
          reason: 'the board granted this coach an exception, and the branch must see it',
          approval: {
            approvedBy: REQUESTED_BY,
            approvedAt: '2026-07-01',
            reference: 'board minutes 2026-07',
          },
        },
      ],
    });
    const plain = bundleWith({});

    const withWaiver = runScenario(waived, quietBranch(waived.id), {
      ...runOptions,
      baselineVerification: null,
    });
    const without = runScenario(plain, quietBranch(plain.id), {
      ...runOptions,
      baselineVerification: null,
    });

    // Waiver-free, this is nought — and it was nought *with* the waiver too,
    // because no ledger was ever built from a record set the type says a branch
    // may override.
    expect(withWaiver.verification.meta.violationsWaived).toBeGreaterThan(0);
    expect(without.verification.meta.violationsWaived).toBe(0);
    expect(withWaiver.verification.violations.filter((v) => v.waived === true).length).toBe(
      withWaiver.verification.meta.violationsWaived
    );
  });

  it('honours a reserved slot standing on replacement ground', () => {
    const [taken] = result.relocations.proposals;
    expect(taken).toBeDefined();
    const held = season2026SeasonInputs({
      schedule,
      facilityInput,
      timingInput,
      calendarInput,
      constraints: SEASON_2026_CONSTRAINTS,
      venueComplexes,
      reservedSlots: [
        {
          id: 'ground-the-club-is-holding',
          kind: 'reservation',
          label: 'held for the league',
          date: taken.to.date,
          venueId: taken.toVenueId,
          surfaceId: taken.to.surfaceId,
          startMinutes: taken.to.startMinutes,
          endMinutes: taken.to.startMinutes + 60,
          format: AFFECTED_FORMAT,
          homeSide: 'tbd',
          awaySide: 'tbd',
          source: 'the regression for an inert record set',
        },
      ],
    });
    const run = runScenario(
      held,
      season2026VenueUnavailableScenario({
        venueId: WITHDRAWN.venueId,
        baselineId: held.id,
        requestedBy: REQUESTED_BY,
        at: REQUESTED_AT,
      }),
      runOptions
    );
    const standing = run.relocations.proposals.filter(
      (proposal) =>
        proposal.to.date === taken.to.date &&
        proposal.to.surfaceId === taken.to.surfaceId &&
        proposal.to.startMinutes === taken.to.startMinutes
    );
    expect(standing).toEqual([]);
  });
});

describe('a withdrawal sees the branch as it stands, not as it started', () => {
  it('withdraws a permit an earlier override of the same branch added', () => {
    // `venue-unavailable` expanded against the *original* permits, so a row an
    // earlier override had already added for that venue survived the
    // withdrawal — and an open window standing beside a blackout is
    // `PERMIT_PRECEDENCE_AMBIGUOUS` on every consultation, which is the exact
    // noise `remove` exists to prevent.
    const date = WITHDRAWN.dates[0];
    const branch = makeScenario({
      id: 'add-then-withdraw',
      name: 'a permit added, then the venue withdrawn',
      baselineId: inputs.id,
      rationale: 'the regression for a withdrawal that misses its own working copy',
      requestedBy: REQUESTED_BY,
      createdAt: REQUESTED_AT,
      overrides: [
        {
          kind: SCENARIO_OVERRIDE_KIND.ADD,
          recordSet: SCENARIO_RECORD_SET.PERMITS,
          record: {
            id: 'an-extra-window-nobody-withdrew',
            venueId: WITHDRAWN.venueId,
            scopeKind: 'weekday-default',
            weekday: weekdayCodeOf(date),
            date: null,
            hasPermit: true,
            openMinutes: 480,
            closeMinutes: 1200,
            lit: null,
            lightsOffMinutes: null,
            note: 'an extra window opened before the venue was withdrawn',
            source: 'the regression',
          },
          by: REQUESTED_BY,
          at: REQUESTED_AT,
          reason: 'open an extra window at the venue',
        },
        {
          kind: SCENARIO_OVERRIDE_KIND.VENUE_UNAVAILABLE,
          venueId: WITHDRAWN.venueId,
          by: REQUESTED_BY,
          at: REQUESTED_AT,
          reason: 'and then the whole venue goes',
        },
      ],
    });
    const materialised = materialiseScenario(inputs, branch);
    const surviving = materialised.records.permits.filter(
      (row) => row.venueId === WITHDRAWN.venueId && row.hasPermit === true
    );
    expect(surviving).toEqual([]);
    const resolved = resolvePermitWindow(materialised.engines.calendar, {
      venueId: WITHDRAWN.venueId,
      date,
    });
    expect(resolved.window?.hasPermit).toBe(false);
    expect(resolved.ambiguous).toBe(false);
  });
});

describe('a replacement slot is checked for legality before it is graded', () => {
  it('refuses to put a team in two places at once', () => {
    // Candidates were validated by `checkKickoffAvailability()` alone, which is
    // a statement about *ground*: it knows nothing about who is playing. Two
    // displaced games sharing a team could therefore be proposed onto two
    // replacement surfaces at the same minute and both be reported `clean`.
    const withFootprint = result.displaced.filter(
      (game) => gamesById[game.gameId]?.endMinutes !== null
    );
    const pair = (() => {
      for (let i = 0; i < withFootprint.length; i += 1) {
        for (let j = i + 1; j < withFootprint.length; j += 1) {
          const a = withFootprint[i];
          const b = withFootprint[j];
          if (a.date === b.date && a.startMinutes === b.startMinutes) return [a, b];
        }
      }
      return null;
    })();
    // Meta-assertion: a corpus with no such pair would make everything below
    // pass while proposing nothing.
    expect(pair, 'two displaced games on one date and one kickoff').not.toBeNull();
    const [first, second] = /** @type {any} */ (pair);

    const sharedTeam = 'one-team-cannot-be-in-two-places';
    const doctored = {
      ...gamesById,
      [first.gameId]: { ...gamesById[first.gameId], homeTeamId: sharedTeam },
      [second.gameId]: { ...gamesById[second.gameId], homeTeamId: sharedTeam },
    };
    const plan = proposeRelocations(result.materialised.engines, {
      displaced: [first, second],
      survivors: schedule.games.filter(
        (game) => !result.displaced.some((d) => d.gameId === String(game.id))
      ),
      gamesById: doctored,
      policy,
      requirement,
    });

    // Meta-assertion: a plan that proposed nothing would satisfy the clash
    // check vacuously.
    expect(plan.proposals.length + plan.unrelocatable.length).toBe(2);
    expect(plan.proposals.length).toBeGreaterThan(0);

    const footprint = (proposal) => {
      const row = doctored[proposal.gameId];
      return {
        start: proposal.to.startMinutes,
        end: proposal.to.startMinutes + (row.endMinutes - row.startMinutes),
      };
    };
    for (let i = 0; i < plan.proposals.length; i += 1) {
      for (let j = i + 1; j < plan.proposals.length; j += 1) {
        const a = plan.proposals[i];
        const b = plan.proposals[j];
        if (a.to.date !== b.to.date) continue;
        const left = footprint(a);
        const right = footprint(b);
        const overlap = left.start < right.end && right.start < left.end;
        expect(overlap, `${a.gameId} and ${b.gameId} share a team`).toBe(false);
      }
    }
  });
});

describe('vacuity is a statement about composition, not about a total', () => {
  it('does not call a retype vacuous when it changed exactly what it named', () => {
    // A count is not an identity. Hardening a constraint moves its violations
    // from one severity to another without moving the total, and the branch was
    // being stamped `SCENARIO_OVERRIDE_VACUOUS` — "every question asked of it is
    // answered by the baseline" — for a change that did exactly what was asked.
    const softened = registry.constraints.find((record) => record.type === CONSTRAINT_TYPE.SOFT);
    expect(softened).toBeDefined();
    const branch = makeScenario({
      id: 'harden-one-constraint',
      name: 'one constraint hardened, nothing else',
      baselineId: inputs.id,
      rationale: 'the regression for vacuity decided on a count',
      requestedBy: REQUESTED_BY,
      createdAt: REQUESTED_AT,
      overrides: [
        {
          kind: SCENARIO_OVERRIDE_KIND.RETYPE,
          recordSet: SCENARIO_RECORD_SET.CONSTRAINTS,
          recordId: /** @type {any} */ (softened).id,
          type: CONSTRAINT_TYPE.HARD,
          by: REQUESTED_BY,
          at: REQUESTED_AT,
          reason: 'the board made this one binding',
        },
      ],
    });
    const hardened = runScenario(inputs, branch, runOptions);

    // Meta-assertion: the retype has to have changed something, or "not
    // vacuous" would be the wrong answer rather than the right one.
    const shape = (verification) =>
      verification.violations
        .map((violation) => `${violation.code}|${violation.severity}|${violation.subjectId}`)
        .sort();
    expect(hardened.verification.violations.length).toBe(baselineVerification.violations.length);
    expect(shape(hardened.verification)).not.toEqual(shape(baselineVerification));

    expect(codesOf(hardened.findings)).not.toContain(SCENARIO_REASON.SCENARIO_OVERRIDE_VACUOUS);
  });
});

describe('an ancestry is checked against the parent it claims to be', () => {
  const child = season2026VenueUnavailableScenario({
    venueId: WITHDRAWN.venueId,
    baselineId: inputs.id,
    requestedBy: REQUESTED_BY,
    at: REQUESTED_AT,
    id: 'the-child',
    parentScenarioId: scenario.id,
    dates: [WITHDRAWN.dates[0]],
  });

  it('refuses an ancestry that is not the parent the branch names', () => {
    // Any non-empty array passed, so the wrong parent's overrides composed
    // under a fingerprint that looked entirely legitimate.
    const stranger = makeScenario({
      id: 'not-the-parent',
      name: 'a branch that is not this one’s parent',
      baselineId: inputs.id,
      rationale: 'the regression for an unchecked ancestry',
      requestedBy: REQUESTED_BY,
      createdAt: REQUESTED_AT,
      overrides: [
        {
          kind: SCENARIO_OVERRIDE_KIND.REMOVE,
          recordSet: SCENARIO_RECORD_SET.PERMITS,
          recordId: String(inputs.permits[0].id),
          by: REQUESTED_BY,
          at: REQUESTED_AT,
          reason: 'a stranger’s edit',
        },
      ],
    });
    expect(() => materialiseScenario(inputs, child, { ancestry: [stranger] })).toThrow(/parent/);
    // …and the real parent still composes.
    expect(() => materialiseScenario(inputs, child, { ancestry: [scenario] })).not.toThrow();
  });

  it('reports rather than throws when the memo is checked without the ancestry', () => {
    // `check()` is a reporting entry point: every other answer it gives is a
    // finding, and this one threw, so a caller reconciling a cache had to catch
    // an exception to learn that it had not passed enough.
    const memo = new ScenarioMemo();
    memo.resolve(inputs, child, { ...runOptions, ancestry: [scenario] });
    const findings = memo.check(inputs, child);
    expect(codesOf(findings)).toContain(SCENARIO_REASON.SCENARIO_ANCESTRY_UNRESOLVED);
    expect(findings[0].severity).toBe(CONSTRAINT_SEVERITY.BLOCKING);
  });
});

describe('the fingerprint covers everything that reaches a record', () => {
  it('separates two branches whose provenance differs', () => {
    // `by`, `at` and `reason` are written into the expanded permit rows' `note`
    // and `source`, and into a retyped constraint's own history, so two
    // branches carrying different ones produce genuinely different records —
    // and shared one fingerprint.
    const overridesOf = (by, reason) => [
      {
        kind: SCENARIO_OVERRIDE_KIND.VENUE_UNAVAILABLE,
        recordSet: null,
        record: null,
        recordId: null,
        type: null,
        weight: null,
        venueId: WITHDRAWN.venueId,
        dates: null,
        by,
        at: REQUESTED_AT,
        reason,
      },
    ];
    const first = overridesOf('grounds@club.example', 'the pitch is being re-turfed');
    const second = overridesOf('grounds@club.example', 'the lease was not renewed');
    const third = overridesOf('board@club.example', 'the pitch is being re-turfed');

    expect(scenarioFingerprint(inputs, first)).not.toBe(scenarioFingerprint(inputs, second));
    expect(scenarioFingerprint(inputs, first)).not.toBe(scenarioFingerprint(inputs, third));
    // The records really do differ, so this is not a digest of decoration.
    const notesOf = (overrides) =>
      expandVenueUnavailable(overrides[0], inputs.permits).added.map(
        (row) => `${row.note}|${row.source}`
      );
    expect(notesOf(first)).not.toEqual(notesOf(second));
    expect(notesOf(first)).not.toEqual(notesOf(third));
  });
});

describe('the counters count what they are named for', () => {
  it('counts overrides applied, not the primitive edits one override expands into', () => {
    // One `venue-unavailable` is one override. It expands into every permit row
    // the venue holds plus seven blackouts, and `overridesApplied` was counting
    // those — so the vacuity finding's own details reported seventeen applied
    // against one declared.
    const meta = result.materialised.meta;
    expect(meta.overridesDeclared).toBe(scenario.overrides.length);
    expect(meta.overridesApplied).toBe(scenario.overrides.length);
    // The primitive count is still kept, under its own name, and is the number
    // that made the confusion possible in the first place.
    expect(meta.recordEditsApplied).toBeGreaterThan(meta.overridesApplied);
    expect(meta.recordEditsApplied).toBe(
      meta.recordsAdded + meta.recordsRemoved + meta.recordsRetyped
    );
  });
});
