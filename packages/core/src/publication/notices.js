/**
 * **Change notices: the before-and-after a family actually reads.**
 *
 * A parity result says 4 rows differ. A notice says *"14GSelect02 v Visiting
 * Club A — was Saturday 22 August at 10:30, now 10:00, same pitch"*, addressed
 * to the people that game belongs to. This module turns the first into the
 * second, and every one of its decisions is a refusal: to guess who a change
 * belongs to, to widen what a family-facing artifact carries, or to report a
 * quiet season on a comparison that does not support one.
 *
 * ## 1. Teams are enumerated from the roster, never from the changed rows
 *
 * The temptation is to group the differences by team and emit a notice per
 * group. That is exactly backwards: **a team whose game vanished produces no
 * changed row**, so grouping from rows means the family with the worst news is
 * the one family that gets no notice. The universe comes from the team
 * registry the caller passes in — `Schedule.teams`, a roster, whatever a break
 * in the schedule would leave intact — and the changes are attributed onto it.
 * `docs/LESSONS_LEARNED.md`: never derive a check's subject set from the data a
 * break would corrupt.
 *
 * A participant that is neither a known team nor a declared non-team label
 * (`-`, `Select Game 7`, a visiting club, a Minis session) is
 * `NOTICE_PARTICIPANT_UNKNOWN` at blocking rather than a silent skip. Incident
 * 4's second half is a checker that read a placeholder as a team code; a notice
 * builder that dropped an unrecognised participant would tell nobody.
 *
 * The same code, and the same refusal, covers a label **more than one team
 * answers to** — one team's id spelled the same way as another team's name.
 * The map from label to team is built with collision detection rather than in a
 * single overwriting pass, and an ambiguous label is routed to neither team:
 * misrouting a family's schedule change to a different family is worse than
 * failing to send it, and a silent overwrite is exactly how it would happen.
 *
 * ## 1a. A per-team row is addressed to the participant it names
 *
 * `ParityRow.participant` exists because a per-team artifact names each fixture
 * twice, once per team, and that is who each of the two rows is *for*. When it
 * is set, the change is filed under that team alone; when it is `null` — every
 * row the corpus's schedule CSVs produce — the fixture is not addressed to
 * anybody and both sides are told. Filing a per-team row under both sides
 * regardless gives every family the same change twice.
 *
 * ## 2. Contact columns are out unless a caller names the flag
 *
 * `CLAUDE.md` §2 is data minimisation. A family-facing notice needs fixtures,
 * not coaches' names and email addresses, so `includeContacts` is `false` by
 * default and setting it emits `NOTICE_CONTACTS_INCLUDED` at `compromise` — the
 * inclusion is a decision that shows up in the findings rather than a quiet
 * widening of what the artifact carries.
 *
 * ## 3. A notice run is never sounder than the parity it was built from
 *
 * "0 of 132 enumerated team(s) have something to be told" is the answer
 * families most want and the one this module is least entitled to give by
 * itself. The comparison, not the notice builder, is what knows whether
 * anything was examined — so `parity.status` is read rather than ignored, is
 * carried onto the result as `parityStatus`, and three shapes of an *unfounded*
 * quiet season are `NOTICE_VACUOUS` at blocking:
 *
 * | shape | `details.reason` |
 * | --- | --- |
 * | no team universe, so no notice can be addressed to anybody | `no-team-universe` |
 * | the parity examined nothing — `PARITY_VACUOUS`, no rows partitioned, or no field compared | `parity-examined-nothing` |
 * | the parity was `rejected` and not one team was told anything | `divergence-told-to-nobody` |
 *
 * A parity that is `rejected` *because* families need telling, and whose
 * changes reach them, is not one of these: that is the ordinary case and the
 * run is `allowed`. The parity's own findings are not merged into the notice
 * result — a notice run answers "were the families told", not "is the schedule
 * faithful", and merging would make every honest notice run over a diverged
 * schedule read as rejected — but its status and counters travel on
 * `parityStatus` and in `NOTICE_BUILT`'s details.
 *
 * Times are rendered by `reserve/publication.js` `naiveDateTime()`, the only
 * GAP-30-safe human time renderer in this repository. There is not a second
 * one here.
 *
 * @module publication/notices
 */

import { naiveDateTime } from '../reserve/publication.js';
import { PUBLICATION_TBD } from '../reserve/reasonCodes.js';

import {
  NOTICE_CHANGE_KIND,
  PUBLICATION_REASON,
  PUBLICATION_STATUS,
  createPublicationMeta,
  derivePublicationStatus,
  makePublicationFinding,
} from './reasonCodes.js';
import { PARITY_FIELD_ORDER } from './rows.js';
import { NoticeTeamSchema } from './schemas.js';

/**
 * One fixture as a notice reads it: every parity field, plus the kickoff
 * rendered for a human.
 *
 * @param {import('./types.js').ParityRow|null} row
 * @returns {Record<string, unknown>|null}
 */
function describeRow(row) {
  if (row === null || row === undefined) return null;
  /** @type {Record<string, unknown>} */
  const described = {};
  for (const field of PARITY_FIELD_ORDER) described[field] = row[field] ?? null;
  described.startAt =
    typeof row.date === 'string'
      ? naiveDateTime(row.date, /** @type {number|null} */ (row.startMinutes), PUBLICATION_TBD.TIME)
      : PUBLICATION_TBD.TIME;
  return described;
}

/**
 * Who one changed fixture is addressed to.
 *
 * A per-team row says so itself: `participant` is the team the row was written
 * for, and one fixture in a per-team artifact is two such rows. A row with no
 * participant — every row the corpus's schedule CSVs produce — is a fixture
 * rather than a letter, so both sides are told.
 *
 * @param {import('./types.js').ParityRow} row
 * @returns {string[]}
 */
function addresseesOf(row) {
  if (typeof row.participant === 'string' && row.participant.length > 0) return [row.participant];
  return [row.home, row.away].filter((value) => typeof value === 'string' && value.length > 0);
}

/**
 * Build the family-facing before/after list, grouped by team.
 *
 * @param {Object} input
 * @param {import('./types.js').ParityResult} input.parity
 * @param {ReadonlyArray<Object>} input.teams - the team universe; never derived from the changes
 * @param {ReadonlyArray<string>} [input.nonTeamLabels] - participants that are known not to be teams
 * @param {boolean} [input.includeContacts] - opt in to coach name and email; off by default
 * @returns {import('./types.js').ChangeNoticeResult}
 */
export function buildChangeNotices(input) {
  const teams = (input.teams ?? []).map((team) => NoticeTeamSchema.parse(team));
  const nonTeamLabels = new Set(input.nonTeamLabels ?? []);
  const includeContacts = input.includeContacts === true;
  const parity = input.parity;

  const meta = createPublicationMeta();
  /** @type {import('./types.js').PublicationFinding[]} */
  const findings = [];

  /** @type {Map<string, import('./types.js').ChangeNoticeEntry[]>} */
  const changesByTeam = new Map();
  /** Every label, and every team that answers to it — not the last one to claim it. */
  /** @type {Map<string, Set<string>>} */
  const claimsByLabel = new Map();
  for (const team of teams) {
    meta.teamsEnumerated += 1;
    changesByTeam.set(team.teamId, []);
    for (const label of [team.teamId, team.teamName]) {
      const claims = claimsByLabel.get(label) ?? new Set();
      claims.add(team.teamId);
      claimsByLabel.set(label, claims);
    }
  }

  /** Labels exactly one team answers to, mapped to its id. */
  /** @type {Map<string, string>} */
  const teamIdByLabel = new Map();
  /** Labels more than one team answers to; routing one would misfile a family's news. */
  /** @type {Map<string, string[]>} */
  const ambiguousLabels = new Map();
  for (const [label, claims] of claimsByLabel) {
    if (claims.size === 1) teamIdByLabel.set(label, [...claims][0]);
    else ambiguousLabels.set(label, [...claims].sort());
  }

  /** @type {Map<string, number>} */
  const unknownParticipants = new Map();
  /** @type {Map<string, number>} */
  const ambiguousParticipants = new Map();

  /**
   * File one change under every team it lands on.
   *
   * @param {string} kind
   * @param {{ key: string, label: string }} subject
   * @param {import('./types.js').ParityRow} identityRow
   * @param {string[]} changedFields
   * @param {import('./types.js').ParityRow|null} beforeRow
   * @param {import('./types.js').ParityRow|null} afterRow
   * @returns {void}
   */
  const file = (kind, subject, identityRow, changedFields, beforeRow, afterRow) => {
    /** @type {import('./types.js').ChangeNoticeEntry} */
    const entry = {
      kind,
      key: subject.key,
      label: subject.label,
      changedFields: [...changedFields],
      before: describeRow(beforeRow),
      after: describeRow(afterRow),
    };
    for (const participant of addresseesOf(identityRow)) {
      if (nonTeamLabels.has(participant)) continue;
      if (ambiguousLabels.has(participant)) {
        // Neither team gets it. One of them would be the wrong family.
        ambiguousParticipants.set(participant, (ambiguousParticipants.get(participant) ?? 0) + 1);
        continue;
      }
      const teamId = teamIdByLabel.get(participant);
      if (teamId === undefined) {
        unknownParticipants.set(participant, (unknownParticipants.get(participant) ?? 0) + 1);
        continue;
      }
      /** @type {import('./types.js').ChangeNoticeEntry[]} */ (changesByTeam.get(teamId)).push(
        entry
      );
      meta.noticeLinesEmitted += 1;
    }
  };

  for (const pair of parity.buckets.differing) {
    file(
      NOTICE_CHANGE_KIND.CHANGED,
      pair,
      pair.publishedRow,
      pair.changedFields,
      pair.publishedRow,
      pair.currentRow
    );
  }
  for (const orphan of parity.buckets.added) {
    file(NOTICE_CHANGE_KIND.ADDED, orphan, orphan.row, [], null, orphan.row);
  }
  for (const orphan of parity.buckets.removed) {
    file(NOTICE_CHANGE_KIND.REMOVED, orphan, orphan.row, [], orphan.row, null);
  }

  /** @type {import('./types.js').ChangeNotice[]} */
  const notices = [];
  for (const team of teams) {
    const changes = /** @type {import('./types.js').ChangeNoticeEntry[]} */ (
      changesByTeam.get(team.teamId)
    );
    if (changes.length === 0) continue;
    meta.teamsWithChanges += 1;
    /** @type {import('./types.js').ChangeNotice} */
    const notice = {
      teamId: team.teamId,
      teamName: team.teamName,
      division: team.division,
      changes,
      contact: includeContacts ? { coachName: team.coachName, coachEmail: team.coachEmail } : null,
    };
    notices.push(notice);
  }

  for (const [participant, count] of unknownParticipants) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.NOTICE_PARTICIPANT_UNKNOWN,
        `"${participant}" appears on ${count} changed fixture(s) and is neither a team in the universe nor a declared non-team label, so nobody would be told`,
        { participant, changes: count, reason: 'unrecognised', subject: parity.subject }
      )
    );
  }

  for (const [participant, count] of ambiguousParticipants) {
    const claimants = /** @type {string[]} */ (ambiguousLabels.get(participant));
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.NOTICE_PARTICIPANT_UNKNOWN,
        `"${participant}" appears on ${count} changed fixture(s) and is a label ${claimants.length} teams answer to (${claimants.join(', ')}), so it was routed to none of them rather than filed under whichever claimed it last`,
        {
          participant,
          changes: count,
          reason: 'ambiguous',
          teamIds: claimants.join(','),
          subject: parity.subject,
        }
      )
    );
  }

  if (includeContacts) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.NOTICE_CONTACTS_INCLUDED,
        `notices for "${parity.subject}" carry coach name and email for ${notices.length} team(s); CLAUDE.md §2 excludes contact columns from family-facing output unless a caller asks`,
        { subject: parity.subject, notices: notices.length }
      )
    );
  }

  // The parity's own standing, read rather than assumed. A notice run reports
  // what families are told; whether the comparison behind it was entitled to
  // say "nothing" is the parity's answer, not this module's.
  const parityStatus =
    typeof parity.status === 'string' ? parity.status : PUBLICATION_STATUS.REJECTED;
  const divergentRows =
    parity.buckets.differing.length + parity.buckets.added.length + parity.buckets.removed.length;
  const parityExaminedNothing =
    parity.findings.some((finding) => finding.code === PUBLICATION_REASON.PARITY_VACUOUS) ||
    parity.meta.rowsCompared === 0 ||
    parity.meta.fieldComparisons === 0;

  /** Which shape of unfounded quiet season this run is, if any. */
  let vacuousReason = null;
  let vacuousMessage = '';
  if (meta.teamsEnumerated === 0) {
    vacuousReason = 'no-team-universe';
    vacuousMessage = `no team universe was supplied for "${parity.subject}", so no notice can be addressed to anybody and a silent season would be reported`;
  } else if (parityExaminedNothing) {
    vacuousReason = 'parity-examined-nothing';
    vacuousMessage = `"${parity.subject}" partitioned ${parity.meta.rowsCompared} row(s) and performed ${parity.meta.fieldComparisons} field comparison(s), so telling ${meta.teamsWithChanges} of ${meta.teamsEnumerated} enumerated team(s) something rests on a comparison that examined nothing`;
  } else if (meta.teamsWithChanges === 0 && parityStatus === PUBLICATION_STATUS.REJECTED) {
    vacuousReason = 'divergence-told-to-nobody';
    vacuousMessage = `"${parity.subject}" is ${parityStatus} with ${divergentRows} divergent row(s) and not one of the ${meta.teamsEnumerated} enumerated team(s) was told anything, so this run reports a quiet season the comparison does not support`;
  }

  if (vacuousReason !== null) {
    findings.push(
      makePublicationFinding(PUBLICATION_REASON.NOTICE_VACUOUS, vacuousMessage, {
        subject: parity.subject,
        reason: vacuousReason,
        teamsEnumerated: meta.teamsEnumerated,
        teamsWithChanges: meta.teamsWithChanges,
        parityStatus,
        parityRowsCompared: parity.meta.rowsCompared,
        parityFieldComparisons: parity.meta.fieldComparisons,
        divergentRows,
      })
    );
  }

  if (meta.teamsEnumerated > 0) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.NOTICE_BUILT,
        `${meta.teamsWithChanges} of ${meta.teamsEnumerated} enumerated team(s) have something to be told about "${parity.subject}": ${meta.noticeLinesEmitted} line(s), from a parity that is ${parityStatus} with ${divergentRows} divergent row(s)`,
        {
          subject: parity.subject,
          teamsEnumerated: meta.teamsEnumerated,
          teamsWithChanges: meta.teamsWithChanges,
          noticeLines: meta.noticeLinesEmitted,
          contactsIncluded: includeContacts,
          parityStatus,
          parityRowsCompared: parity.meta.rowsCompared,
          parityFieldComparisons: parity.meta.fieldComparisons,
          divergentRows,
        }
      )
    );
  }

  return {
    subject: parity.subject,
    notices,
    teamsEnumerated: meta.teamsEnumerated,
    includeContacts,
    parityStatus,
    findings,
    status: derivePublicationStatus(findings),
    meta,
  };
}
