/**
 * **Change notices: the before-and-after a family actually reads.**
 *
 * A parity result says 4 rows differ. A notice says *"14GSelect02 v Visiting
 * Club A — was Saturday 22 August at 10:30, now 10:00, same pitch"*, addressed
 * to the people that game belongs to. This module turns the first into the
 * second, and its two decisions are both refusals.
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
 * ## 2. Contact columns are out unless a caller names the flag
 *
 * `CLAUDE.md` §2 is data minimisation. A family-facing notice needs fixtures,
 * not coaches' names and email addresses, so `includeContacts` is `false` by
 * default and setting it emits `NOTICE_CONTACTS_INCLUDED` at `compromise` — the
 * inclusion is a decision that shows up in the findings rather than a quiet
 * widening of what the artifact carries.
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
 * The participants named on a fixture.
 *
 * @param {import('./types.js').ParityRow} row
 * @returns {string[]}
 */
function participantsOf(row) {
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
  /** Every label a team can be addressed by, mapped to its id. */
  const teamIdByLabel = new Map();
  for (const team of teams) {
    meta.teamsEnumerated += 1;
    changesByTeam.set(team.teamId, []);
    teamIdByLabel.set(team.teamId, team.teamId);
    teamIdByLabel.set(team.teamName, team.teamId);
  }

  /** @type {Map<string, number>} */
  const unknownParticipants = new Map();

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
    for (const participant of participantsOf(identityRow)) {
      if (nonTeamLabels.has(participant)) continue;
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
        { participant, changes: count, subject: parity.subject }
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

  if (meta.teamsEnumerated === 0) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.NOTICE_VACUOUS,
        `no team universe was supplied for "${parity.subject}", so no notice can be addressed to anybody and a silent season would be reported`,
        { subject: parity.subject }
      )
    );
  } else {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.NOTICE_BUILT,
        `${meta.teamsWithChanges} of ${meta.teamsEnumerated} enumerated team(s) have something to be told about "${parity.subject}": ${meta.noticeLinesEmitted} line(s)`,
        {
          subject: parity.subject,
          teamsEnumerated: meta.teamsEnumerated,
          teamsWithChanges: meta.teamsWithChanges,
          noticeLines: meta.noticeLinesEmitted,
          contactsIncluded: includeContacts,
        }
      )
    );
  }

  return {
    subject: parity.subject,
    notices,
    teamsEnumerated: meta.teamsEnumerated,
    includeContacts,
    findings,
    status: derivePublicationStatus(findings),
    meta,
  };
}
