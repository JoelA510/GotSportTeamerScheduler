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
 * assertLayerUnwired} rejects both, and it carries two positive controls of its
 * own: it re-runs the biconditional against a claimed-code set widened by each
 * of the layer's codes in turn, and again **once per enforcement path**,
 * through a definition of that path's own shape — so a reader that silently
 * stopped contributing is caught rather than hidden inside a union.
 *
 * @module tests/helpers/unwiredLayer
 */

import { expect } from 'vitest';

import { SEASON_2026_CONSTRAINTS } from '@squadlogic/core/constraints/index.js';
import { STANDING_RULES } from '@squadlogic/core/ruleEngine/index.js';

/**
 * The enforcement paths this check reads, each as its own claimed-code set.
 *
 * Two exist and both are read: a standing rule's `reasonCodes` (the rule engine
 * evaluates it) and a registry constraint's (`constraints/severity.js`
 * re-severities Phase 1 findings through it). Kept apart rather than unioned at
 * source, because a union is exactly what let one half go quietly empty: `size
 * > 10` was satisfied by the 43 rule codes alone, so emptying the constraint
 * half would have reverted the check to its round-3 strength with the whole
 * suite still green. Each path is asserted to contribute a code no other path
 * supplies, and each is separately shown to break the biconditional.
 *
 * Definitions are parameters so a control can simulate a wiring made through
 * one path specifically.
 *
 * @param {{ rules?: ReadonlyArray<Object>, constraints?: ReadonlyArray<Object> }} [sources]
 * @returns {Record<string, Set<string>>} path name -> the codes it claims
 */
export function claimedReasonCodesByPath(sources = {}) {
  const rules = sources.rules ?? STANDING_RULES;
  const constraints = sources.constraints ?? SEASON_2026_CONSTRAINTS;
  return {
    'standing rule': new Set(rules.flatMap((rule) => rule.reasonCodes ?? [])),
    'registry constraint': new Set(
      constraints.flatMap((constraint) => constraint.reasonCodes ?? [])
    ),
  };
}

/**
 * Every reason code some enforcement path claims, over all paths.
 *
 * @param {{ rules?: ReadonlyArray<Object>, constraints?: ReadonlyArray<Object> }} [sources]
 * @returns {Set<string>}
 */
export function claimedReasonCodes(sources = {}) {
  return new Set(Object.values(claimedReasonCodesByPath(sources)).flatMap((codes) => [...codes]));
}

/**
 * Assert that every enforcement path the check reads actually contributes.
 *
 * A path that silently stopped contributing would weaken every biconditional
 * below it without failing anything, so each is required to supply at least one
 * code no other path does. Both really do on this corpus: the rules supply
 * dozens, and the registry supplies the three `WARMUP_OCCUPIED_*` codes that no
 * rule claims.
 *
 * @returns {Record<string, string[]>} path name -> the codes only it supplies
 */
export function assertEveryClaimPathContributes() {
  const byPath = claimedReasonCodesByPath();
  const names = Object.keys(byPath);
  expect(names.length, 'claimed-code paths').toBeGreaterThan(1);
  /** @type {Record<string, string[]>} */
  const unique = {};
  for (const name of names) {
    const others = new Set(
      names.filter((other) => other !== name).flatMap((other) => [...byPath[other]])
    );
    unique[name] = [...byPath[name]].filter((code) => !others.has(code)).sort();
    expect(
      unique[name].length,
      `the "${name}" path supplies no code the others do not, so emptying it would go unnoticed`
    ).toBeGreaterThan(0);
  }
  return unique;
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

  // ... and once **per path**, through a definition of that path's own shape.
  // The loop above widens the set directly, which proves the arithmetic; this
  // proves each reader. A `?? []` that emptied one half would pass the first
  // and fail here.
  if (!claimed) {
    const sample = codes.find((code) => code !== declarationCode);
    const perPath = {
      'standing rule': { rules: [...STANDING_RULES, { reasonCodes: [sample] }] },
      'registry constraint': {
        constraints: [...SEASON_2026_CONSTRAINTS, { reasonCodes: [sample] }],
      },
    };
    for (const [name, sources] of Object.entries(perPath)) {
      const through = claimedReasonCodes(sources);
      expect(through.has(sample), `${layer}: the "${name}" path did not carry ${sample}`).toBe(
        true
      );
      expect(
        declares === (codes.filter((code) => through.has(code)).length === 0),
        `${layer}: a wiring made through the "${name}" path leaves the declaration standing`
      ).toBe(false);
    }
    // ... and every path is one the union really depends on.
    assertEveryClaimPathContributes();
  }

  return { enforced, declares };
}
