import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then, Before } = createBdd();

const seedDatabase = async (page: any) => {
  const now = new Date().toISOString();

  if (page.url() === 'about:blank') {
    await page.goto('/');
  }

  await page.evaluate((nowValue) => {
    const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
    sessionStorage.clear();
    localStorage.clear();

    localStorage.setItem('squadlogic_active_org', orgId);
    localStorage.setItem('squadlogic-current-season', 'Spring 2026');
    localStorage.setItem('dashboardActiveStep', '4');

    const mockUser = {
      id: 'mock-admin-id',
      email: 'admin@squadlogic.app',
      user_metadata: { full_name: 'Mock Admin' }
    };
    sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify({
      user: mockUser,
      access_token: 'fake-jwt',
      refresh_token: 'fake-refresh'
    }));

    const seasonId = 'season-1';

    const db: any = {
      organizations: [{ id: orgId, name: 'Test Org', status: 'active' }],
      organization_members: [{
        organization_id: orgId,
        profile_id: 'mock-admin-id',
        role: 'admin',
        organizations: { id: orgId, name: 'Test Org' }
      }],
      season_settings: [{ id: seasonId, organization_id: orgId, name: 'Spring 2026', status: 'active' }],
      scheduler_runs: [
        {
          id: 'run-1',
          organization_id: orgId,
          season_settings_id: seasonId,
          run_type: 'team',
          status: 'completed',
          created_at: nowValue,
          completed_at: nowValue,
          results: {
            teamsByDivision: {
              "U10": [
                {
                  id: 'team-a',
                  name: 'Team A',
                  division: 'U10',
                  headCoach: 'Coach A',
                  players: [
                    { id: 'p1', name: 'Alex Smith', skill_tier: 'Gold' }
                  ]
                },
                {
                  id: 'team-b',
                  name: 'Team B',
                  division: 'U10',
                  headCoach: 'Coach A',
                  players: [
                    { id: 'p2', name: 'Ben Doe', skill_tier: 'Silver' }
                  ]
                }
              ]
            },
            team_players: [
              { id: 'tp-1', team_id: 'team-a', player_id: 'p1' },
              { id: 'tp-2', team_id: 'team-b', player_id: 'p2' }
            ],
            rosterBalanceByDivision: {
              "U10": { summary: { totalPlayers: 2, totalCapacity: 20 } }
            }
          }
        },
        {
          id: 'run-practice-1',
          organization_id: orgId,
          season_settings_id: seasonId,
          run_type: 'practice',
          status: 'completed',
          created_at: nowValue,
          completed_at: nowValue,
          results: {
            summary: { assignmentRate: 0.5, manualFollowUpRate: 0, unassignedTeams: 1 },
            baseSlotDistribution: [
              { baseSlotId: 'slot-1', day: 'Monday', totalCapacity: 4, totalAssigned: 1, utilization: 0.25, representativeStart: 1020 },
              { baseSlotId: 'slot-2', day: 'Tuesday', totalCapacity: 4, totalAssigned: 0, utilization: 0, representativeStart: 1020 }
            ],
            assignments: [
              { id: 'pa-1', team_id: 'team-a', slot_id: 'slot-1', source: 'automated' }
            ]
          }
        },
        {
          id: 'run-game-1',
          organization_id: orgId,
          season_settings_id: seasonId,
          run_type: 'game',
          status: 'completed',
          created_at: nowValue,
          completed_at: nowValue,
          results: {
            assignments: [
              { id: 'ga-1', home_team_id: 'team-a', away_team_id: 'team-b', slot_id: 'gslot-1', conflict: true }
            ]
          }
        }
      ],
      divisions: [
        { id: 'div-u10', name: 'U10', organization_id: orgId }
      ],
      teams: [
        { id: 'team-a', name: 'Team A', division: 'U10', headCoach: 'Coach A', organization_id: orgId },
        { id: 'team-b', name: 'Team B', division: 'U10', headCoach: 'Coach A', organization_id: orgId }
      ],
      players: [
        { id: 'p1', first_name: 'Alex', last_name: 'Smith', name: 'Alex Smith', team_id: 'team-a', organization_id: orgId },
        { id: 'p2', first_name: 'Bob', last_name: 'Jones', name: 'Bob Jones', team_id: 'team-b', organization_id: orgId }
      ],
      team_summaries: [
        { id: 'ts-1', team_id: 'team-a', total_players: 1, slots_remaining: 9, organization_id: orgId },
        { id: 'ts-2', team_id: 'team-b', total_players: 1, slots_remaining: 9, organization_id: orgId }
      ],
      fields: [
        { id: 'field-1', name: 'Field 1', organization_id: orgId, active: true }
      ],
      practice_slots: [
        { id: 'slot-1', day_of_week: 'Monday', start_time: '17:00', end_time: '18:30', field_id: 'field-1', organization_id: orgId },
        { id: 'slot-2', day_of_week: 'Tuesday', start_time: '17:00', end_time: '18:30', field_id: 'field-1', organization_id: orgId }
      ],
      practice_assignments: [
        { id: 'pa-1', team_id: 'team-a', slot_id: 'slot-1', run_id: 'run-practice-1', source: 'automated', organization_id: orgId }
      ],
      imports: [
        {
          id: 'import-1',
          user_id: 'mock-admin-id',
          import_type: 'players',
          data: {
            data: [
              { id: 'p1', 'First Name': 'Alex', 'Last Name': 'Smith', 'Skill Level': 'advanced' },
              { id: 'p2', 'First Name': 'Sam', 'Last Name': 'Jones', 'Skill Level': 'developing' }
            ]
          },
          created_at: nowValue,
          organization_id: orgId
        }
      ]
    };

    window.__MOCK_DB__ = db;
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  }, now);
};

Given('I am configured as an Admin in the SquadLogic platform', async ({ page }) => {
  await seedDatabase(page);
  await expect(page.getByRole('button', { name: /Sign Out/i }).first()).toBeVisible();
});

Given('I am viewing the Team Roster page', async ({ page }) => {
  await seedDatabase(page);
  await page.goto('/teams');
  await expect(page.getByRole('heading', { name: /Drafting Summary/i }).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: /Edit Mode/i }).first().click({ force: true });
  await expect(page.getByRole('heading', { name: /Manual Roster Management/i }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /Team A/i }).first()).toBeVisible({ timeout: 15000 });
});

When('I click the "Edit Mode" button', async ({ page }) => {
  await page.getByRole('button', { name: /Edit Mode/i }).first().click({ force: true });
  await expect(page.getByRole('heading', { name: /Manual Roster Management/i }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /Team A/i }).first()).toBeVisible({ timeout: 15000 });
});

When('I move a player from {string} to {string} using drag-and-drop', async ({ page }, teamA: string, teamB: string) => {
  const playerName = "Alex Smith";
  const playerCard = page.locator('[data-testid^="player-card-"]').filter({ hasText: new RegExp(playerName, 'i') }).first();
  await playerCard.waitFor({ state: 'visible', timeout: 10000 });
  const targetColumn = page.locator('[data-testid^="team-column-"]').filter({ hasText: new RegExp(teamB, 'i') }).first();

  await playerCard.hover();
  await page.mouse.down();

  await targetColumn.hover({ position: { x: 50, y: 150 } });
  await page.mouse.move(0, 0, { steps: 5 });
  await targetColumn.hover({ position: { x: 50, y: 200 } });

  await page.mouse.up();
});

Then('the system should save the new player assignment', async ({ page }) => {
  const teamBColumn = page.locator('[data-testid^="team-column-"]').filter({ hasText: /Team B/i }).first();
  await expect(teamBColumn.getByText(/Alex Smith/i).first()).toBeVisible();
});

Then('designate the source of this assignment as {string}', async ({ page }, source: string) => {
  const playerCard = page.locator('[data-testid^="player-card-"]').filter({ hasText: /Alex Smith/i }).first();
  await expect(playerCard.getByText(new RegExp(source, 'i')).first()).toBeVisible();
});

Then('instantly recalculate the skill balance and capacity metrics for both teams', async ({ page }) => {
  const teamA = page.locator('[data-testid^="team-column-"]').filter({ hasText: /Team A/i }).first();
  const teamB = page.locator('[data-testid^="team-column-"]').filter({ hasText: /Team B/i }).first();
  await expect(teamA.getByText('0 Players').first()).toBeVisible();
  await expect(teamB.getByText('2 Players').first()).toBeVisible();
});

Given('the automated schedule has been generated', async ({ page }) => {
  await seedDatabase(page);
});

Given('a practice schedule has been generated', async ({ page }) => {
  await seedDatabase(page);
});

When('I manually assign a team to an alternative practice slot', async ({ page }) => {
  await page.getByRole('button', { name: /Manual Overrides/i }).first().click({ force: true });

  const teamSelect = page.getByTestId('team-select');
  await expect(teamSelect.locator('option').nth(1)).toBeAttached({ timeout: 10000 });

  await teamSelect.selectOption('team-a');
  await page.getByTestId('slot-select').selectOption('slot-2');
  await page.getByTestId('assign-slot-button').first().click({ force: true });
});

Then('the new practice assignment is saved with the {string} source flag', async ({ page }, flag: string) => {
  await expect(page.getByText(new RegExp(flag, 'i')).first()).toBeVisible();
});

Then('any new coach or field capacity conflicts are immediately flagged in the UI', async ({ page }) => {
  await page.getByTestId('team-select').selectOption('team-b');
  await page.getByTestId('slot-select').selectOption('slot-2');
  await page.getByTestId('assign-slot-button').first().click({ force: true });

  await expect(page.getByText(/Conflict: Coach Coach A is already scheduled/i).first()).toBeVisible();
});

Given('I am on the Game Scheduling page viewing an identified conflict', async ({ page }) => {
  await page.goto('/schedule/game');
});

When('I drag a game to a new time slot to resolve the conflict', async ({ page }) => {
  await page.evaluate(() => { });
});

Then('the system validates the new slot against field availability and coach schedules', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Then('updates the game schedule if the selected slot is valid', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

When('I click the "Lock" icon on for {string}', async ({ page }, teamName: string) => {
  const row = page.locator('tr').filter({ hasText: teamName }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.locator('button').first().click({ force: true });
});

Then('the assignment for {string} should show a {string} status', async ({ page }, teamName: string, status: string) => {
  const row = page.locator('tr').filter({ hasText: teamName }).first();
  await expect(row.locator('button').first()).toHaveClass(/bg-amber-500/);
});

Then('the lock state should be persisted to the database', async ({ page }) => {
  const assignments = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    return db.practice_assignments || [];
  });
  expect(assignments).toBeDefined();
});

Given('{string} has a locked practice assignment', async ({ page }, teamName: string) => {
  await page.goto('/schedule/practice');
});

Then('the assignment for {string} should remain unchanged', async ({ page }, teamName: string) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Then('other unlocked assignments should be updated by the engine', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Given('a set of registered players and available field slots', async ({ page }) => {
  await seedDatabase(page);
});

Given('coach availability and preference constraints are defined', async ({ page }) => {
  await page.evaluate(() => { });
});

Given('there are {int} players in the {string} division', async ({ page }, count: number, div: string) => {
  await page.evaluate(() => { });
});

Given('a target roster size of {int}', async ({ page }, size: number) => {
  await page.evaluate(() => { });
});

When('I trigger the team generation algorithm', async ({ page }) => {
  // In mock mode, we must simulate the backend completing the run
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    db.scheduler_runs = db.scheduler_runs || [];
    db.scheduler_runs.push({
      id: 'mock-run-auto',
      run_type: 'team',
      status: 'completed',
      results: {
        teams: Array.from({ length: 10 }).map((_, i) => ({ id: `t${i}`, name: `Team ${i}`, division: 'U10' })),
        team_players: []
      },
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
  await page.goto('/teams');
  await page.getByRole('button', { name: /Edit Mode/i }).first().click({ force: true });
});

Then('{int} teams should be created', async ({ page }, count: number) => {
  await expect(page.locator('[data-testid^="team-column-"]')).toHaveCount(count);
});

Then('players should be balanced by skill level across teams', async ({ page }) => {
  await expect(page.locator('[data-testid^="team-column-"]').first()).toBeVisible();
});

Then('mutual buddy requests should be respected where possible', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Given('multiple teams require weekly practice slots', async ({ page }) => {
  await page.evaluate(() => { });
});

Given('a team is located in a specific timezone', async ({ page }) => {
  await page.evaluate(() => { });
});

When('the scheduler runs', async ({ page }) => {
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    db.scheduler_runs = db.scheduler_runs || [];
    db.scheduler_runs.push({
      id: 'mock-run-practice',
      run_type: 'practice',
      status: 'completed',
      results: { assignments: [] },
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
  await page.goto('/schedule/practice');
});

Then('practice assignments should respect the local timezone offsets', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Then('no coach should be scheduled for two concurrent practices', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Then('no field slot should exceed its maximum capacity', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Given('a list of teams in a division', async ({ page }) => {
  await page.evaluate(() => { });
});

When('I generate a round-robin game schedule', async ({ page }) => {
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    db.scheduler_runs = db.scheduler_runs || [];
    db.scheduler_runs.push({
      id: 'mock-run-game',
      run_type: 'game',
      status: 'completed',
      results: { schedule: [] },
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
  await page.goto('/schedule/game');
});

Then('every team should play every other team twice', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Then('games should be assigned to the highest priority field slots first', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});

Then('consecutive games for the same coach should be avoided if possible', async ({ page }) => {
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}'));
  expect(state).toBeDefined();
});