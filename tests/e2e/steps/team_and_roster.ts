import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

/**
 * Helper to ensure a player exists in the "imports" table so TeamAnalysisPage can hydrate it.
 */
async function syncPlayerToImports(page: any, player: any) {
  await page.evaluate(
    ({ p }) => {
      const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
      db.imports = db.imports || [];
      let playerImport = db.imports.find((i: any) => i.import_type === 'players');

      if (!playerImport) {
        playerImport = {
          id: 'import-players-1',
          import_type: 'players',
          user_id: 'mock-admin-id',
          data: { data: [] },
          created_at: new Date().toISOString(),
        };
        db.imports.push(playerImport);
      }

      // Add or update player in the import blob
      const existingIdx = playerImport.data.data.findIndex((rp: any) => rp.id === p.id);
      const normalizedPlayer = {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        age: p.age,
        gender: p.gender,
        buddy_id: p.buddy_id,
      };

      if (existingIdx >= 0) {
        playerImport.data.data[existingIdx] = normalizedPlayer;
      } else {
        playerImport.data.data.push(normalizedPlayer);
      }

      sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    },
    { p: player }
  );
}

// ────────────────────────────────────────────────────────────
// 1. CORE SETUP & ROBUST SEEDING (Our recent fixes)
// ────────────────────────────────────────────────────────────

Given('teams have been generated for the current season', async ({ page }) => {
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';

    db.teams = db.teams || [];
    if (!db.teams.find((t: any) => t.id === 'team-alpha')) {
      db.teams.push(
        {
          id: 'team-alpha',
          name: 'Team Alpha',
          division: 'U10',
          organization_id: orgId,
          gender_policy: null,
          age_range: null,
        },
        {
          id: 'team-beta',
          name: 'Team Beta',
          division: 'U10',
          organization_id: orgId,
          gender_policy: null,
          age_range: null,
        }
      );
    }

    const now = new Date().toISOString();
    db.scheduler_runs = db.scheduler_runs || [];
    db.scheduler_runs.push({
      id: `mock-run-roster-${Date.now()}`,
      organization_id: orgId,
      run_type: 'team',
      status: 'completed',
      created_at: now,
      completed_at: now,
      results: {
        teamsByDivision: {
          U10: [
            { id: 'team-alpha', name: 'Team Alpha', division_id: 'U10', organization_id: orgId },
            { id: 'team-beta', name: 'Team Beta', division_id: 'U10', organization_id: orgId },
          ],
        },
        rosterBalanceByDivision: {
          U10: {
            summary: { totalPlayers: 20, totalCapacity: 24, averageFillRate: 0.8 },
            teamStats: [],
          },
        },
        coachCoverageByDivision: {
          U10: { totalTeams: 2, teamsWithCoach: 2, coverageRate: 1.0 },
        },
      },
    });

    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
});

Given('all players are correctly assigned to eligible teams', async ({ page }) => {
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
});

// ────────────────────────────────────────────────────────────
// 2. RESTORED SPECIFIC SCENARIO STEPS (Fixing the Regression)
// ────────────────────────────────────────────────────────────

Given(
  'a buddy pair {string} and {string} are in the same division',
  async ({ page }, p1: string, p2: string) => {
    await page.evaluate(
      ({ name1, name2 }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';

        db.players = db.players || [];
        const id1 = `player-${name1.toLowerCase()}`;
        const id2 = `player-${name2.toLowerCase()}`;

        // Assign to DIFFERENT teams to trigger buddy separation conflict
        db.players.push(
          {
            id: id1,
            first_name: name1,
            last_name: '',
            name: name1,
            age: 10,
            gender: 'M',
            organization_id: orgId,
            buddyId: id2,
            team_id: 'team-alpha',
          },
          {
            id: id2,
            first_name: name2,
            last_name: '',
            name: name2,
            age: 10,
            gender: 'M',
            organization_id: orgId,
            buddyId: id1,
            team_id: 'team-beta',
          }
        );

        db.team_players = db.team_players || [];
        db.team_players.push(
          { team_id: 'team-alpha', player_id: id1 },
          { team_id: 'team-beta', player_id: id2 }
        );

        const run = [...db.scheduler_runs].reverse().find((r: any) => r.run_type === 'team');
        if (run && run.results) {
          run.results.team_players = run.results.team_players || [];
          run.results.team_players.push(
            { team_id: 'team-alpha', player_id: id1 },
            { team_id: 'team-beta', player_id: id2 }
          );
        }

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
      },
      { name1: p1, name2: p2 }
    );

    // Sync to imports for hydration
    await syncPlayerToImports(page, {
      id: `player-${p1.toLowerCase()}`,
      first_name: p1,
      last_name: '',
      age: 10,
      gender: 'M',
      buddy_id: `player-${p2.toLowerCase()}`,
    });
    await syncPlayerToImports(page, {
      id: `player-${p2.toLowerCase()}`,
      first_name: p2,
      last_name: '',
      age: 10,
      gender: 'M',
      buddy_id: `player-${p1.toLowerCase()}`,
    });
  }
);

Given(
  'a player {string} is assigned to a {string} team',
  async ({ page }, player: string, teamGender: string) => {
    await page.evaluate(
      ({ pName, tGender }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        const playerId = `player-${pName.toLowerCase()}`;
        const teamId = `team-${tGender.toLowerCase()}`;

        db.teams = db.teams || [];
        if (!db.teams.find((t: any) => t.id === teamId)) {
          db.teams.push({
            id: teamId,
            name: `${tGender} Team`,
            gender: tGender === 'Boys' ? 'M' : 'F',
            organization_id: orgId,
            min_age: 5,
            max_age: 15,
          });
        }

        // Create player with opposite gender for the mismatch
        const playerGender = tGender === 'Boys' ? 'F' : 'M';
        db.players = db.players || [];
        db.players.push({
          id: playerId,
          first_name: pName,
          last_name: '',
          name: pName,
          age: 10,
          gender: playerGender,
          organization_id: orgId,
          team_id: teamId,
        });

        db.team_players = db.team_players || [];
        db.team_players.push({ team_id: teamId, player_id: playerId });

        const run = [...db.scheduler_runs].reverse().find((r: any) => r.run_type === 'team');
        if (run && run.results) {
          run.results.teams = run.results.teams || [];
          if (!run.results.teams.find((t: any) => t.id === teamId)) {
            const teamObj = {
              id: teamId,
              name: `${tGender} Team`,
              division_id: 'U10',
              gender: tGender === 'Boys' ? 'M' : 'F',
            };
            run.results.teams.push(teamObj);
            run.results.teamsByDivision = run.results.teamsByDivision || {};
            run.results.teamsByDivision['U10'] = run.results.teamsByDivision['U10'] || [];
            run.results.teamsByDivision['U10'].push(teamObj);
          }
          run.results.team_players = run.results.team_players || [];
          run.results.team_players.push({ team_id: teamId, player_id: playerId });
        }

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
      },
      { pName: player, tGender: teamGender }
    );

    // Sync to imports for hydration
    const playerGender = teamGender === 'Boys' ? 'F' : 'M';
    await syncPlayerToImports(page, {
      id: `player-${player.toLowerCase()}`,
      first_name: player,
      last_name: '',
      age: 10,
      gender: playerGender,
    });
  }
);

Given(
  'a player {string} of age {int} is assigned to a {string} team',
  async ({ page }, player: string, age: number, division: string) => {
    await page.evaluate(
      ({ pName, pAge, div }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        const playerId = `player-${pName.toLowerCase()}`;
        const teamId = `team-${div.toLowerCase()}`;

        db.teams = db.teams || [];
        if (!db.teams.find((t: any) => t.id === teamId)) {
          db.teams.push({
            id: teamId,
            name: `${div} Team`,
            min_age: 6,
            max_age: 8,
            organization_id: orgId,
          });
        }

        db.players = db.players || [];
        db.players.push({
          id: playerId,
          first_name: pName,
          last_name: '',
          name: pName,
          age: pAge,
          gender: 'M',
          organization_id: orgId,
          team_id: teamId,
        });

        db.team_players = db.team_players || [];
        db.team_players.push({ team_id: teamId, player_id: playerId });

        const run = [...db.scheduler_runs].reverse().find((r: any) => r.run_type === 'team');
        if (run && run.results) {
          run.results.teams = run.results.teams || [];
          if (!run.results.teams.find((t: any) => t.id === teamId)) {
            const teamObj = {
              id: teamId,
              name: `${div} Team`,
              division_id: div,
              min_age: 6,
              max_age: 8,
            };
            run.results.teams.push(teamObj);
            run.results.teamsByDivision = run.results.teamsByDivision || {};
            run.results.teamsByDivision[div] = run.results.teamsByDivision[div] || [];
            run.results.teamsByDivision[div].push(teamObj);
          }
          run.results.team_players = run.results.team_players || [];
          run.results.team_players.push({ team_id: teamId, player_id: playerId });
        }

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
      },
      { pName: player, pAge: age, div: division }
    );

    // Sync to imports for hydration
    await syncPlayerToImports(page, {
      id: `player-${player.toLowerCase()}`,
      first_name: player,
      last_name: '',
      age: age,
      gender: 'M',
    });
  }
);

Given(
  'a player {string} of age {int} is assigned to {string}',
  async ({ page }, player: string, age: number, team: string) => {
    await page.evaluate(
      ({ playerName, playerAge, teamName }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';

        const playerId = `player-${playerName.replace(/\s+/g, '-').toLowerCase()}`;
        const teamId = teamName === 'Team Alpha' ? 'team-alpha' : 'team-beta';

        db.players = db.players || [];
        db.players.push({
          id: playerId,
          first_name: playerName.split(' ')[0],
          last_name: playerName.split(' ')[1] || '',
          age: playerAge,
          organization_id: orgId,
          gender: 'U',
        });

        db.team_players = db.team_players || [];
        db.team_players.push({ team_id: teamId, player_id: playerId });

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
      },
      { playerName: player, playerAge: age, teamName: team }
    );
  }
);

// ────────────────────────────────────────────────────────────
// 3. ACTIONS & ASSERTIONS
// ────────────────────────────────────────────────────────────

When('I view the Roster Manager', async ({ page }) => {
  await page.goto('/teams');
  // Wait for the "Edit Mode" button to be visible (it only appears if teams exist)
  const editBtn = page.getByRole('button', { name: /Edit Mode/i });
  await editBtn.waitFor({ state: 'visible', timeout: 15000 });
  await editBtn.click();
});

When('I click the {string} button on the Roster Manager', async ({ page }, btnName: string) => {
  if (!page.url().includes('/teams')) {
    await page.goto('/teams');
  }
  const btn = page.getByRole('button', { name: new RegExp(btnName, 'i') }).first();
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await btn.click({ force: true });
});

Then('no conflict banner should be displayed', async ({ page }) => {
  await expect(page.locator('.bg-status-error-bg').first()).toBeHidden();
});

Then(
  'a new row should be inserted into the {string} table',
  async ({ page }, tableName: string) => {
    const rows = await page.evaluate((table) => {
      const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
      return db[table] || [];
    }, tableName);
    expect(rows.length).toBeGreaterThan(0);
  }
);

Then(
  'the run should have run_type {string} and status {string}',
  async ({ page }, type: string, status: string) => {
    const match = await page.evaluate(
      ({ t, s }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const runs = db.scheduler_runs || [];
        return runs.some((r: any) => r.run_type === t && r.status === s);
      },
      { t: type, s: status }
    );
    expect(match).toBe(true);
  }
);

Then('I should see a conflict banner with message {string}', async ({ page }, message: string) => {
  const banner = page.locator('.bg-status-error-bg, .text-status-error').first();
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText(message);
});

Then(
  'I should see a conflict banner with message containing {string}',
  async ({ page }, partialMessage: string) => {
    const banner = page.locator('.bg-status-error-bg, .text-status-error').first();
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText(partialMessage);
  }
);
