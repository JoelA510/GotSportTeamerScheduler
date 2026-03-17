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

    it('Team generation engine processes 1500 players in under 500ms', () => {
        const massivePlayerPool = createMockPlayers(1500);

        const config = {
            maxRosterSize: 12,
            minRosterSize: 10,
            targetTeams: 125
        };

        const startTime = performance.now();

        const result = generateTeams({
            players: massivePlayerPool.map(p => ({ ...p, division: 'U10' })),
            divisionConfigs: {
                U10: {
                    maxRosterSize: config.maxRosterSize,
                    minRosterSize: config.minRosterSize,
                    teamCountOverride: config.targetTeams
                }
            }
        });

        const endTime = performance.now();
        const executionTime = endTime - startTime;

        console.log(`Execution time for 1500 players: ${executionTime}ms`);

        // Fail the CI build if the algorithm degrades in performance
        expect(executionTime).toBeLessThan(500);
        expect(result.teamsByDivision['U10'].length).toBeGreaterThan(0);
    });
});