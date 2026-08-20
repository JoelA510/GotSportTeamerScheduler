/**
 * **The downstream sync registry: who else is serving this schedule?**
 *
 * The public site auto-synced daily from a master file. When that pointer went
 * stale it kept publishing — plausible-looking, internally consistent, wrong
 * data, with no error anywhere, because nothing in the pipeline knew what the
 * current publication was. This module is the list of every destination that
 * consumes the schedule and when each last took a copy, checked against the
 * active snapshot.
 *
 * ## Three refusals
 *
 * - **A missing `destinationSyncedAt` is never "assume fresh".** It is
 *   `DESTINATION_NEVER_SYNCED` at **blocking**. Defaulting an unknown sync time
 *   to now is the failure above, written deliberately.
 * - **`kind` travels with every finding.** A `pull` destination fetches on its
 *   own schedule and cannot be told from here that it is stale; the remedy is
 *   at the other end of the pipe, and a report that says "stale" without saying
 *   which way the data flows sends an operator to the wrong place.
 * - **Nothing here observes anything.** Every timestamp in this registry is an
 *   operator's assertion that a sync happened. No code polls a destination, no
 *   webhook updates a row, and there is no persistence
 *   ({@link import('./snapshot.js').makePublicationSnapshot} is in-memory too).
 *   So every report carries `DESTINATION_SYNC_UNOBSERVED` at `compromise` and
 *   can never read as monitoring. It is a notebook that does arithmetic, and it
 *   says so in its own findings as well as in `docs/PUBLICATION_PARITY.md` and
 *   `docs/MODEL_GAPS.md`.
 *
 * ## Comparing two stamps
 *
 * Naive `YYYY-MM-DDTHH:MM:SS` text, ordered lexicographically. No `Date` is
 * constructed (GAP-30). The consequence is stated rather than hidden: every
 * stamp in one report must come from one clock, because a naive stamp carries
 * no zone to reconcile against another.
 *
 * @module publication/registry
 */

import {
  PUBLICATION_REASON,
  createPublicationMeta,
  derivePublicationStatus,
  makePublicationFinding,
} from './reasonCodes.js';
import { SyncDestinationSchema } from './schemas.js';

/**
 * What a destination's last sync says about it, relative to a snapshot.
 *
 * @readonly
 * @enum {string}
 */
export const DESTINATION_STATE = Object.freeze({
  /** No sync has ever been recorded. */
  NEVER: 'never',
  /** Its last sync predates the active snapshot. */
  STALE: 'stale',
  /** It synced at or after the active snapshot. */
  CURRENT: 'current',
});

/**
 * Check every destination against the active publication snapshot.
 *
 * @param {Object} input
 * @param {{ snapshotId: string, publishedAt: string, label: string }} input.snapshot - the active snapshot
 * @param {ReadonlyArray<Object>} input.destinations
 * @returns {import('./types.js').SyncRegistryReport}
 */
export function buildSyncRegistryReport(input) {
  const destinations = (input.destinations ?? []).map((destination) =>
    SyncDestinationSchema.parse(destination)
  );
  const snapshot = input.snapshot;
  const meta = createPublicationMeta();
  /** @type {import('./types.js').PublicationFinding[]} */
  const findings = [];
  /** @type {import('./types.js').SyncDestinationStatus[]} */
  const statuses = [];

  for (const destination of destinations) {
    meta.destinationsExamined += 1;
    const syncedAt = destination.destinationSyncedAt;

    /** @type {string} */
    let state = DESTINATION_STATE.CURRENT;
    if (syncedAt === null) state = DESTINATION_STATE.NEVER;
    else if (syncedAt < snapshot.publishedAt) state = DESTINATION_STATE.STALE;

    statuses.push({
      destinationId: destination.destinationId,
      name: destination.name,
      kind: destination.kind,
      consumes: destination.consumes,
      owner: destination.owner,
      destinationSyncedAt: syncedAt,
      snapshotPublishedAt: snapshot.publishedAt,
      state,
    });

    if (state === DESTINATION_STATE.NEVER) {
      meta.destinationsNeverSynced += 1;
      findings.push(
        makePublicationFinding(
          PUBLICATION_REASON.DESTINATION_NEVER_SYNCED,
          `destination "${destination.name}" (${destination.kind}, consumes ${destination.consumes}) has no recorded sync, so nothing here can say whether it is serving "${snapshot.label}" or something older`,
          {
            destinationId: destination.destinationId,
            kind: destination.kind,
            consumes: destination.consumes,
            snapshotId: snapshot.snapshotId,
          }
        )
      );
      continue;
    }

    if (state === DESTINATION_STATE.STALE) {
      meta.destinationsStale += 1;
      findings.push(
        makePublicationFinding(
          PUBLICATION_REASON.DESTINATION_STALE,
          `destination "${destination.name}" last synced ${syncedAt}, before "${snapshot.label}" was published at ${snapshot.publishedAt}, so it is serving an older schedule${
            destination.kind === 'pull'
              ? ' — and it pulls on its own schedule, so it cannot be corrected from here'
              : ''
          }`,
          {
            destinationId: destination.destinationId,
            kind: destination.kind,
            consumes: destination.consumes,
            destinationSyncedAt: syncedAt,
            snapshotPublishedAt: snapshot.publishedAt,
            snapshotId: snapshot.snapshotId,
          }
        )
      );
      continue;
    }

    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.DESTINATION_CURRENT,
        `destination "${destination.name}" synced ${syncedAt}, at or after "${snapshot.label}" (${snapshot.publishedAt})`,
        {
          destinationId: destination.destinationId,
          kind: destination.kind,
          destinationSyncedAt: syncedAt,
          snapshotPublishedAt: snapshot.publishedAt,
        }
      )
    );
  }

  if (meta.destinationsExamined === 0) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.SYNC_REGISTRY_VACUOUS,
        `the registry covered zero destinations against "${snapshot.label}", so "every destination is current" is a statement about an empty list`,
        { snapshotId: snapshot.snapshotId }
      )
    );
  } else {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.DESTINATION_SYNC_UNOBSERVED,
        `every one of the ${meta.destinationsExamined} sync time(s) in this registry is an operator-supplied assertion; nothing in this system polls a destination or observes a sync`,
        {
          destinations: meta.destinationsExamined,
          snapshotId: snapshot.snapshotId,
        }
      )
    );
  }

  return {
    snapshotId: snapshot.snapshotId,
    snapshotPublishedAt: snapshot.publishedAt,
    destinations: statuses,
    findings,
    status: derivePublicationStatus(findings),
    meta,
  };
}
