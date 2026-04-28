import { describe, it, expect } from 'vitest';
import { generateTeams } from '../packages/core/src/teamGeneration.js';

describe('Core Engine Performance Benchmarks', () => {
  const createMockPlayers = (count) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `player_${i}`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      ageGroup: 'U10',
      skillRating: Math.floor(Math.random() * 5) + 1,
      buddyRequest: i % 10 === 0 ? `player_${i + 1}` : null,
    }));
  };

  const getPerformanceBudgetMs = () => {
    const override = Number(process.env.PERF_TEAM_GEN_MAX_MS);
    if (Number.isFinite(override) && override > 0) return override;

    // Shared runners and coverage instrumentation can be much slower.
    const isCoverageRun = process.env.npm_lifecycle_event === 'test:coverage';
    return process.env.CI || isCoverageRun ? 15000 : 3000;
  };

  it(
    'Team generation engine processes 1500 players within the configured budget',
    { timeout: 20000 },
    () => {
      const massivePlayerPool = createMockPlayers(1500);

      const config = {
        maxRosterSize: 12,
        minRosterSize: 10,
        targetTeams: 125,
      };

      const startTime = performance.now();

      const result = generateTeams({
        players: massivePlayerPool.map((p) => ({ ...p, division: 'U10' })),
        divisionConfigs: {
          U10: {
            id: 'U10',
            teamsCount: config.targetTeams,
            slotsPerWeek: config.targetTeams * 2,
            maxRosterSize: config.maxRosterSize,
            teamCountOverride: config.targetTeams,
          },
        },
      });

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      console.log(`Execution time for 1500 players: ${executionTime}ms`);

      expect(executionTime).toBeLessThan(getPerformanceBudgetMs());
      expect(result.teamsByDivision['U10'].length).toBeGreaterThan(0);
    }
  );
});
