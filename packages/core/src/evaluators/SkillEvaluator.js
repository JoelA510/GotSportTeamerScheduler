import { BaseEvaluator } from './BaseEvaluator.js';

/**
 * SkillEvaluator (Phase 1.2)
 * Ensures teams have balanced skill levels.
 */
export class SkillEvaluator extends BaseEvaluator {
  constructor() {
    super('Skill Balance', 'skill_evaluator');
  }

  /**
   * Evaluates how the assignment affects the team's average skill compared 
   * to the current state of other teams.
   * 
   * @param {Object} context
   * @returns {number} Score from 0 to 100.
   */
  evaluate(context) {
    const { player, team, allTeams, featureFlags } = context;
    
    // 1. Calculate player's skill
    const playerSkill = typeof player.skillRating === 'number' ? player.skillRating : 0;
    
    // 2. Calculate potential new average for this team
    const currentCount = team.players.length;
    const currentSkillTotal = team.skillTotal || 0;
    const newAverage = (currentSkillTotal + playerSkill) / (currentCount + 1);

    // 3. Calculate target average (average of all players assigned so far or pending)
    // For simplicity in Phase 1.2, we compare against the current average of other teams.
    const activeTeams = allTeams.filter(t => t.players.length > 0);
    if (activeTeams.length === 0) return 100; // First player is always a perfect fit

    const totalSystemSkill = activeTeams.reduce((sum, t) => sum + (t.skillTotal || 0), 0) + playerSkill;
    const totalSystemPlayers = activeTeams.reduce((sum, t) => sum + t.players.length, 0) + 1;
    const systemAverage = totalSystemSkill / totalSystemPlayers;

    // 4. Scoring: Higher score if newAverage is close to systemAverage
    const deviation = Math.abs(newAverage - systemAverage);
    
    // Assuming skill is on a 1-5 or 1-10 scale. If deviation is 0, score is 100.
    // If deviation is high (e.g. 2 points), score drops.
    const maxExpectedDeviation = 2; 
    const score = Math.max(0, 100 * (1 - deviation / maxExpectedDeviation));

    return Math.round(score);
  }

  getDiagnostics(context) {
    const score = this.evaluate(context);
    const { player, team } = context;
    const skill = player.skillRating || 0;
    
    return {
      id: this.id,
      name: this.name,
      score,
      reasons: [`Player skill: ${skill}`, `Team average would become: ${((team.skillTotal + skill) / (team.players.length + 1)).toFixed(2)}`],
      warnings: score < 40 ? ['Assignment significantly unbalances the team average.'] : []
    };
  }
}
