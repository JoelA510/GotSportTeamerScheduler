/**
 * The check two layers share: **declared, and the declaration is checked.**
 *
 * Phase 8.3 shipped two layers with no production consumer — the closure
 * evaluator (`availability/closures.js`) and the alias map
 * (`facility/aliases.js`). Each says so on every result it builds, in the idiom
 * `fairness/objectives.js` established with `FAIRNESS_OBJECTIVE_UNWIRED`. A
 * declaration nothing checks is prose, so both are held to the same
 * biconditional, written once here rather than twice:
 *
 * > a layer declares itself unwired **exactly** while nothing claims one of its
 * > reason codes.
 *
 * Both directions matter. Removing a declaration while the layer is still
 * unwired makes the gap invisible again; wiring an evaluator while the
 * declaration stands makes the result lie the other way. {@link
 * assertLayerUnwired} rejects both, and its own positive control re-runs the
 * biconditional against a claimed-code set widened by each of the layer's codes
 * in turn, so the assertion is shown to be one that can fail.
 *
 * @module tests/helpers/unwiredLayer
 */

import { expect } from 'vitest';

import { SEASON_2026_CONSTRAINTS } from '@squadlogic/core/constraints/index.js';
import { STANDING_RULES } from '@squadlogic/core/ruleEngine/index.js';

/**
 * Every reason code some enforcement path claims.
 *
 * Two paths exist and both are read: a standing rule's `reasonCodes` (the rule
 * engine evaluates it) and a registry constraint's (`constraints/severity.js`
 * re-severities Phase 1 findings through it). Derived from the definitions, so
 * a rule or constraint that starts claiming a code is seen without anyone
 * remembering to come here.
 *
 * @returns {Set<string>}
 */
export function claimedReasonCodes() {
  return new Set([
    ...STANDING_RULES.flatMap((rule) => rule.reasonCodes ?? []),
    ...SEASON_2026_CONSTRAINTS.flatMap((constraint) => constraint.reasonCodes ?? []),
  ]);
}

/**
 * Assert the biconditional for one layer.
 *
 * @param {Object} input
 * @param {string} input.layer - a name, for the failure message
 * @param {ReadonlyArray<{ code: string }>} input.findings - the built object's findings
 * @param {ReadonlyArray<string>} input.codes - the layer's whole reason-code vocabulary
 * @param {string} input.declarationCode - the code that says "nothing consumes this"
 * @param {Set<string>} [input.claimed] - what claims codes today; defaults to {@link claimedReasonCodes}
 * @returns {{ enforced: string[], declares: boolean }}
 */
export function assertLayerUnwired({ layer, findings, codes, declarationCode, claimed }) {
  const claimedCodes = claimed ?? claimedReasonCodes();

  // Meta-assertions first: a vocabulary of one code, or an empty claimed set,
  // would make everything below pass while proving nothing.
  expect(codes.length, `${layer}: vocabulary`).toBeGreaterThan(3);
  expect(codes, `${layer}: declaration code is in the vocabulary`).toContain(declarationCode);
  expect(claimedCodes.size, `${layer}: nothing claims any code at all`).toBeGreaterThan(10);

  const enforcedUnder = (set) => codes.filter((code) => set.has(code)).sort();
  const declares = findings.some((finding) => finding.code === declarationCode);
  const enforced = enforcedUnder(claimedCodes);

  // The biconditional.
  expect(declares, `${layer}: declared unwired but ${enforced.join(', ')} is claimed`).toBe(
    enforced.length === 0
  );

  // Its own positive control: widen the claimed set by each of the layer's
  // codes in turn and the biconditional must reject every one of them, so the
  // assertion above is one that can fail rather than one that always holds.
  let rejected = 0;
  for (const code of codes) {
    if (code === declarationCode) continue;
    const wired = new Set([...claimedCodes, code]);
    expect(enforcedUnder(wired), `${layer}: ${code}`).toContain(code);
    expect(
      declares === (enforcedUnder(wired).length === 0),
      `${layer}: the biconditional accepts a run in which ${code} is claimed and the declaration stands`
    ).toBe(false);
    rejected += 1;
  }
  expect(rejected, `${layer}: nothing to control with`).toBeGreaterThan(2);

  return { enforced, declares };
}
