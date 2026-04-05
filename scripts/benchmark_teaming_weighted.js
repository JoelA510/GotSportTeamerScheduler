import { generateTeams } from '../packages/core/src/teamGeneration.js';

// Setup Mock Players
const MOCK_PLAYERS = Array.from({ length: 60 }, (_, i) => ({
  id: `p_${i + 1}`,
  division: 'U10',
  skillRating: Math.floor(Math.random() * 5) + 1,
  custom_attributes: {
    attendance_score: Math.random() * 100,
    aggressiveness: Math.random() * 10,
  },
}));

const DIVISION_CONFIGS = {
  U10: { id: 'U10', maxRosterSize: 10, teamsCount: 6, slotsPerWeek: 2 },
};

// Test 1: Generate Teams with Default behavior
console.log('--- TEST 1: Default Weights (fallback to skill_rating) ---');
const resultsDefault = generateTeams({
  players: MOCK_PLAYERS,
  divisionConfigs: DIVISION_CONFIGS,
  featureFlags: {}, // Make sure to pass featureFlags even if empty
});
console.dir(
  resultsDefault.teamsByDivision['U10'].map((t) => ({ id: t.id, size: t.players.length })),
  { colors: true }
);

// Test 2: Generate Teams heavily weighted on attendance
console.log('--- TEST 2: Aggressiveness 0.8, Attendance 0.2 Weight ---');
const customWeights = { aggressiveness: 0.8, attendance_score: 0.2 };
const resultsWeighted = generateTeams({
  players: MOCK_PLAYERS,
  divisionConfigs: DIVISION_CONFIGS,
  featureFlags: {},
  customWeights,
});

console.dir(
  resultsWeighted.teamsByDivision['U10'].map((t) => ({ id: t.id, size: t.players.length })),
  { colors: true }
);

console.log('\nPhase 6 Weighed Teaming Benchmark Complete!');
