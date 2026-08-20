/**
 * **The smallest set of constraints that together make a placement impossible.**
 *
 * > *Infeasibility must produce a minimal explanation: the smallest set of
 * > constraints that together make placement impossible. Do not dump the whole
 * > registry.*
 *
 * ## Minimal means minimal, and it is proved rather than claimed
 *
 * A set of three constraints is not minimal because it is short. It is minimal
 * when relaxing the whole set frees the placement **and** relaxing any proper
 * subset of it does not — that is, when every member is doing work no other
 * member does. This module establishes exactly that, by evaluation, and hands
 * back the evaluations:
 *
 * 1. **Sufficiency.** Relax *every* candidate at once. The placement must become
 *    legal. If it does not, the candidates are not the reason it is blocked and
 *    the answer says so (`ATTRIBUTION_MINIMAL_SET_UNCERTIFIED`, blocking) rather
 *    than reporting a set that would be a minimality claim resting on nothing.
 * 2. **The deletion filter.** For each candidate `c`, relax everything in the
 *    working set *except* `c`. If the placement is legal anyway, `c` was not
 *    needed and is dropped.
 * 3. **The witnesses.** For every surviving member, relax the other members and
 *    record the result. Each row is one member's proof: the placement is still
 *    illegal without it, and these are the codes that survive. The rows are on
 *    the result, so a reader — or a test — checks the property instead of
 *    trusting a boolean. `certified` is derived from the rows, never set
 *    directly.
 *
 * The reason relaxation works this way is that hardness is **data**
 * (`docs/MODEL_GAPS.md` GAP-12): a constraint is relaxed by projecting it to a
 * `preference` through `constraints/whatIf.js`'s `whatIfConstraintType()`, which
 * is the existing owner of "what would change if this went back to being a
 * preference". Its `projectedRegistry` is then handed to the ordinary
 * `checkPlacement()`. No branch anywhere asks "is adjacency hard right now?",
 * here or in Phase 1, and nothing is mutated: each projection is a new registry.
 *
 * ## Where the candidates come from, and what they cannot cover
 *
 * From the blocking reason codes, through `registryConstraintIdsFor()` — the
 * same single lookup `resolve/errors.js` uses for the error an operator reads.
 * Relaxing a constraint that governs none of those codes cannot change a
 * severity, so the search does not consider one; the whole registry is still
 * reported as the denominator (`proof.registryConstraintsHeld`) so that "three
 * constraints" is legible as "three of fourteen".
 *
 * A blocking code **no** registry constraint claims — `SIZE_UNKNOWN_FORMAT` on
 * the corpus's four `Scrimmage` rows, say — cannot be relaxed at all. It is
 * reported as `ungovernedBlockingCodes` with
 * `ATTRIBUTION_BLOCKER_UNGOVERNED` at `compromise`, and the set is left
 * uncertified. A minimal explanation that quietly omitted an unliftable blocker
 * would be the most confident kind of wrong.
 *
 * @module attribution/minimal
 */

import { CONSTRAINT_TYPE } from '../constraints/reasonCodes.js';
import { whatIfConstraintType } from '../constraints/whatIf.js';
import { registryConstraintIdsFor } from '../resolve/errors.js';
import { checkPlacement } from '../resolve/legality.js';
import { slotKey } from '../resolve/state.js';

import {
  categoryOnlyClaimFindings,
  claimFromConstraintFindings,
  entitiesOf,
  groupFindingsByConstraintKind,
  makeClaim,
  mergeClaimsByTightness,
} from './claims.js';
import {
  ATTRIBUTION_REASON,
  ATTRIBUTION_SEVERITY,
  ATTRIBUTION_SOURCE,
  createAttributionMeta,
  deriveAttributionStatus,
  makeAttributionFinding,
} from './reasonCodes.js';
import { MinimalBlockingSetQuerySchema } from './schemas.js';

/**
 * A registry with these constraints projected to `preference`.
 *
 * Chained through `whatIfConstraintType()` one constraint at a time, so each
 * projection carries its own history entry saying it was projected and never
 * adopted. Nothing is mutated: `registry` is unchanged when this returns.
 *
 * @param {Object} registry
 * @param {ReadonlyArray<string>} constraintIds
 * @returns {Object}
 */
function relaxed(registry, constraintIds) {
  let projected = registry;
  for (const constraintId of constraintIds) {
    projected = whatIfConstraintType(
      projected,
      constraintId,
      CONSTRAINT_TYPE.PREFERENCE
    ).projectedRegistry;
  }
  return projected;
}

/**
 * Is the placement legal with these constraints relaxed?
 *
 * @param {import('./types.js').AttributionContext} context
 * @param {string} gameId
 * @param {import('../resolve/types.js').Slot} slot
 * @param {ReadonlyArray<string>} relaxedIds
 * @param {import('./types.js').AttributionMeta} meta
 * @returns {{ legal: boolean, blockingCodes: string[] }}
 */
function legalWith(context, gameId, slot, relaxedIds, meta) {
  const registry =
    relaxedIds.length === 0
      ? context.engines.registry
      : relaxed(context.engines.registry, relaxedIds);
  if (relaxedIds.length > 0) meta.relaxationsTested += 1;
  const placement = checkPlacement({ ...context.engines, registry }, context.state, gameId, slot);
  meta.placementChecksRun += 1;
  return { legal: placement.legal, blockingCodes: [...placement.blockingCodes] };
}

/**
 * The minimal set of registry constraints that together block a placement.
 *
 * @param {import('./types.js').AttributionContext} context
 * @param {Object} rawQuery - see `MinimalBlockingSetQuerySchema`
 * @returns {import('./types.js').MinimalBlockingSet}
 */
export function minimalBlockingSet(context, rawQuery) {
  const query = MinimalBlockingSetQuerySchema.parse(rawQuery);
  const meta = createAttributionMeta();
  /** @type {import('./types.js').AttributionFinding[]} */
  const findings = [...context.findings];
  const registry = context.engines.registry;
  const game = context.state.baseline[query.gameId] ?? null;

  /** @type {import('./types.js').MinimalBlockingSet} */
  const answer = {
    gameId: query.gameId,
    slot: query.slot ?? { date: '', surfaceId: '', startMinutes: 0 },
    blocked: false,
    constraintIds: [],
    claims: [],
    candidateConstraintIds: [],
    droppedConstraintIds: [],
    ungovernedBlockingCodes: [],
    witnesses: [],
    proof: {
      legalWhenAllRelaxed: false,
      registryConstraintsHeld: registry.constraintIds.length,
      candidatesConsidered: 0,
      membersReported: 0,
    },
    certified: false,
    findings,
    meta,
    status: '',
  };

  if (game === null) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_GAME_UNKNOWN,
        `no game "${query.gameId}" is in this schedule, so there is no placement to explain`,
        { gameId: query.gameId, gameCount: context.state.gameIds.length }
      )
    );
    return { ...answer, status: deriveAttributionStatus(findings) };
  }

  const slot = query.slot ?? {
    date: game.date,
    surfaceId: game.surfaceId,
    startMinutes: game.startMinutes,
  };
  meta.gamesExamined += 1;

  const placement = checkPlacement(context.engines, context.state, query.gameId, slot);
  meta.placementChecksRun += 1;

  if (placement.legal) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_PLACEMENT_NOT_BLOCKED,
        `game "${query.gameId}" is legal at ${slotKey(slot)}, so no set of constraints blocks it; the question has no answer rather than an empty one`,
        { gameId: query.gameId, slot: slotKey(slot) }
      )
    );
    return { ...answer, slot, status: deriveAttributionStatus(findings) };
  }

  const candidates = registryConstraintIdsFor(registry, placement.blockingCodes);
  const ungoverned = placement.blockingCodes.filter(
    (code) => (registry.idsByReasonCode[code] ?? []).length === 0
  );
  meta.gamesAttributed += 1;

  for (const code of ungoverned) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_BLOCKER_UNGOVERNED,
        `"${code}" blocks game "${query.gameId}" at ${slotKey(slot)} and no constraint in this registry claims it, so no change of hardness can lift it and the set below cannot be the whole reason`,
        { gameId: query.gameId, code, slot: slotKey(slot) }
      )
    );
  }

  const sufficiency = legalWith(context, query.gameId, slot, candidates, meta);

  /** @type {string[]} */
  let working = [...candidates];
  /** @type {string[]} */
  const dropped = [];
  if (sufficiency.legal) {
    // The deletion filter. Relaxation is monotone — relaxing more constraints
    // never turns a legal placement illegal — so a candidate whose absence from
    // the relaxed set still leaves the placement legal is one nothing depends
    // on, and dropping it cannot make an earlier decision wrong.
    for (const candidate of candidates) {
      const without = working.filter((id) => id !== candidate);
      const verdict = legalWith(context, query.gameId, slot, without, meta);
      if (!verdict.legal) continue;
      working = without;
      dropped.push(candidate);
      meta.membersDropped += 1;
    }
  }

  /** @type {import('./types.js').MinimalBlockingSet['witnesses']} */
  const witnesses = [];
  if (sufficiency.legal) {
    for (const member of working) {
      const others = working.filter((id) => id !== member);
      const verdict = legalWith(context, query.gameId, slot, others, meta);
      witnesses.push({
        constraintId: member,
        relaxedConstraintIds: others,
        legal: verdict.legal,
        blockingCodes: verdict.blockingCodes,
      });
      if (!verdict.legal) meta.membersProvenNecessary += 1;
    }
  }

  const everyMemberNecessary =
    witnesses.length === working.length && witnesses.every((witness) => !witness.legal);
  const certified =
    sufficiency.legal && everyMemberNecessary && ungoverned.length === 0 && working.length > 0;

  if (!sufficiency.legal) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_MINIMAL_SET_UNCERTIFIED,
        `relaxing all ${candidates.length} candidate constraint(s) left game "${query.gameId}" illegal at ${slotKey(slot)} (${sufficiency.blockingCodes.join(', ') || 'no code survived, which is worse'}); the set on offer is not a blocking set and is not reported as one`,
        {
          gameId: query.gameId,
          slot: slotKey(slot),
          candidateCount: candidates.length,
          survivingCodes: sufficiency.blockingCodes,
        }
      )
    );
  } else if (certified) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_MINIMAL_SET_PROVEN,
        `${working.length} of the registry's ${registry.constraintIds.length} constraints block game "${query.gameId}" at ${slotKey(slot)} (${working.join(', ')}); relaxing all of them makes it legal and relaxing any ${working.length - 1} of them does not, which was checked ${witnesses.length} time(s) rather than argued`,
        {
          gameId: query.gameId,
          slot: slotKey(slot),
          constraintIds: working,
          constraintId: working[0] ?? null,
          memberCount: working.length,
          registryConstraintsHeld: registry.constraintIds.length,
          witnessCount: witnesses.length,
        }
      )
    );
  }

  // **One claim per member**, each carrying what that member's constraint
  // actually raised — so the set is not a list of ids but a list of instances
  // with their numbers, and counting the claims counts the set.
  //
  // A member can raise more than one finding here (two spatial overlaps against
  // two different games are one `field-overlap-adjacency` record twice), so the
  // findings for a member are collapsed into its single claim rather than
  // reported as several. It cannot raise *none* — every candidate governs one of
  // the blocking codes, and every blocking code is a finding — but the invariant
  // is held structurally rather than argued, because a later change to how
  // candidates are derived is exactly what would break it quietly.
  const consequentialFindings = placement.findings.filter(
    (finding) => finding.severity !== ATTRIBUTION_SEVERITY.INFO
  );
  const grouped = groupFindingsByConstraintKind(consequentialFindings);
  /** @type {Map<string, import('./types.js').AttributionFinding[]>} */
  const byConstraint = new Map(working.map((id) => [id, []]));
  for (const finding of [...Object.values(grouped.byKind).flat(), ...grouped.ungrouped]) {
    for (const id of registryConstraintIdsFor(registry, [finding.code])) {
      const bucket = byConstraint.get(id);
      if (bucket) bucket.push(finding);
    }
  }
  const where = {
    registry,
    gameId: query.gameId,
    surfaceId: slot.surfaceId,
    venueId: game.venueId,
    date: slot.date,
  };
  const claims = mergeClaimsByTightness(
    working.map((id) => {
      const raised = byConstraint.get(id) ?? [];
      if (raised.length === 0) {
        // The member is in the set because relaxing it changed the answer, and
        // nothing it governs spoke. Reported as the constraint it is, naming the
        // blocking codes it claims here, rather than left out of a list whose
        // length is the answer.
        return [
          makeClaim({
            source: ATTRIBUTION_SOURCE.FACILITY,
            kind: id,
            constraintId: id,
            constraintIds: [id],
            codes: placement.blockingCodes.filter((code) =>
              (registry.idsByReasonCode[code] ?? []).includes(id)
            ),
            severity: ATTRIBUTION_SEVERITY.BLOCKING,
            binding: true,
            entities: entitiesOf(where),
          }),
        ];
      }
      return [
        claimFromConstraintFindings(id, raised, {
          ...where,
          source: ATTRIBUTION_SOURCE.FACILITY,
        }),
      ];
    })
  );
  findings.push(
    ...categoryOnlyClaimFindings(claims, { gameId: query.gameId, slot: slotKey(slot) }, meta)
  );

  return {
    ...answer,
    slot,
    blocked: true,
    constraintIds: working,
    claims,
    candidateConstraintIds: candidates,
    droppedConstraintIds: dropped,
    ungovernedBlockingCodes: ungoverned,
    witnesses,
    proof: {
      legalWhenAllRelaxed: sufficiency.legal,
      registryConstraintsHeld: registry.constraintIds.length,
      candidatesConsidered: candidates.length,
      membersReported: working.length,
    },
    certified,
    findings,
    status: deriveAttributionStatus(findings),
  };
}
