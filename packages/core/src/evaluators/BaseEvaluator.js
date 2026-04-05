/**
 * Base class for all Team Evaluators in Phase 1.2.
 * Provides a standardized interface for modular teaming logic.
 */
export class BaseEvaluator {
  /**
   * @param {string} name - Human-readable name of the evaluator.
   * @param {string} id - Unique identifier for the evaluator.
   */
  constructor(name, id) {
    this.name = name;
    this.id = id;
  }

  /**
   * Evaluates a potential player-team assignment.
   * @param {Object} context - The evaluation context.
   * @param {Object} context.player - The player being assigned.
   * @param {Object} context.team - The target team.
   * @param {Object} context.allTeams - Current state of all teams.
   * @param {Object} [context.featureFlags] - Active feature flags for the organization.
   * @param {Record<string, number>} [context.customWeights] - Custom weight mappings
   * @param {Object} [context.globalStats] - Normalized globals & mins/maxes
   * @returns {number} A score representing the "fit" (0 to 100, where 100 is perfect).
   */
  evaluate(context) {
    throw new Error('Method "evaluate" must be implemented by subclasses.');
  }

  /**
   * Provides detailed diagnostics for a specific assignment.
   * Useful for the "Team Diagnostics" view and debugging.
   * @param {Object} context 
   * @returns {Object} { score: number, reasons: string[], warnings: string[] }
   */
  getDiagnostics(context) {
    const score = this.evaluate(context);
    return {
      id: this.id,
      name: this.name,
      score,
      reasons: [],
      warnings: []
    };
  }
}
