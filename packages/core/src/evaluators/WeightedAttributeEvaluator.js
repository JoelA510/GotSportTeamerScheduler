import { BaseEvaluator } from './BaseEvaluator.js';

/**
 * WeightedAttributeEvaluator (Phase 6)
 * Ensures teams have balanced compositions based on dynamically weighted custom attributes.
 * Replaces SkillEvaluator.
 */
export class WeightedAttributeEvaluator extends BaseEvaluator {
  constructor() {
    super('Weighted Predictive Balance', 'weighted_attribute_evaluator');
  }

  /**
   * Generates a composite score based on divergence of the team's new mean vs system mean for weighted attributes.
   * 
   * @param {Object} context
   * @param {Object} context.player
   * @param {Object} context.team
   * @param {Array<Object>} context.allTeams
   * @param {Object} context.customWeights - { [attr]: weight_0_to_1 }
   * @param {Object} context.globalStats - { orgMeans: {}, minMax: { attr: { min, max } } }
   * @returns {number} Score from 0 to 100.
   */
  evaluate(context) {
    const { player, team, allTeams, customWeights = { skill_rating: 1.0 }, globalStats = {} } = context;
    
    // Default or empty weights handling
    let weights = customWeights;
    if (!weights || Object.keys(weights).length === 0) {
      weights = { skill_rating: 1.0 };
    }

    const { orgMeans = {}, minMax = {} } = globalStats;
    const currentCount = team.players.length;

    // Helper to get normalized value for a player
    const getNormalizedValue = (p, attr) => {
      let val = undefined;
      if (attr === 'skill_rating' || attr === 'skillRating') {
        val = p.skillRating !== undefined ? p.skillRating : p.custom_attributes?.skill_rating;
      } else {
        val = p.custom_attributes?.[attr];
      }

      if (val === undefined || val === null || isNaN(Number(val))) {
        val = orgMeans[attr] ?? 0;
      } else {
        val = Number(val);
      }

      const bounds = minMax[attr];
      if (!bounds || bounds.max === bounds.min) {
        return 0.5; // Everyone is equal if min == max
      }

      return Math.max(0, Math.min(1, (val - bounds.min) / (bounds.max - bounds.min)));
    };

    // Calculate team's potential new normalized average for each weighted attribute
    let totalDivergence = 0;
    let totalWeight = 0;

    const activeTeams = allTeams.filter(t => t.players.length > 0);
    const systemPlayersCount = activeTeams.reduce((sum, t) => sum + t.players.length, 0) + 1;

    for (const [attr, weightStr] of Object.entries(weights)) {
      const weight = Number(weightStr);
      if (isNaN(weight) || weight <= 0) continue;

      totalWeight += weight;

      // Player's normalized value
      const playerNormVal = getNormalizedValue(player, attr);

      // Team's current normalized sum
      let currentTeamSum = 0;
      for (const tPlayer of team.players) {
        currentTeamSum += getNormalizedValue(tPlayer, attr);
      }

      const teamNewAverage = (currentTeamSum + playerNormVal) / (currentCount + 1);

      // System average
      let totalSystemSum = 0;
      for (const t of activeTeams) {
        for (const tPlayer of t.players) {
          totalSystemSum += getNormalizedValue(tPlayer, attr);
        }
      }
      totalSystemSum += playerNormVal;
      
      const systemAverage = systemPlayersCount > 0 ? totalSystemSum / systemPlayersCount : 0.5;

      // Max possible deviation is 1 for normalized attributes
      const deviation = Math.abs(teamNewAverage - systemAverage);
      totalDivergence += (deviation * weight);
    }

    if (totalWeight === 0) return 100;

    const weightedAvgDivergence = totalDivergence / totalWeight;
    
    // Normalize into a 0-100 score. Divergence represents percentage absolute difference.
    // E.g., a divergence of 0.2 means on average, it deviates by 20% of the entire scale.
    // If deviation is 0, score is 100.
    // A reasonable maximum expected deviation for acceptable teams is ~0.4 (40%)
    const maxExpectedDeviation = 0.4;
    const score = Math.max(0, 100 * (1 - weightedAvgDivergence / maxExpectedDeviation));

    return Math.round(score);
  }

  getDiagnostics(context) {
    const score = this.evaluate(context);
    return {
      id: this.id,
      name: this.name,
      score,
      reasons: [`Composite divergence evaluated.`],
      warnings: score < 40 ? ['Assignment significantly shifts multidimensional team balance.'] : []
    };
  }
}
