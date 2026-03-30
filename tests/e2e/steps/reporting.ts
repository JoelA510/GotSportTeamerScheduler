import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

/**
 * Ensures localStorage points to org-1 so OrganizationContext resolves
 * to the org that has data in initialMockData. Must be called BEFORE
 * any page.goto() / page.reload() so the fresh context picks it up.
 */
const pinToOrg1 = async (page: any) => {
  await page.evaluate(() => {
    localStorage.setItem('squadlogic_active_org', 'org-1');
  });
};

/**
 * Seeds league-specific data (standings, teams, games) into the mock DB.
 * Uses org-1 to align with initialMockData. Writes to both window.__MOCK_DB__
 * and sessionStorage so the data survives page reloads.
 */
const seedLeagueData = async (page: any) => {
  await page.evaluate(() => {
    const db = (window as any).__MOCK_DB__ || JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    const orgId = 'org-1';

    // --- Standings view ---
    db.view_league_standings = [
      {
        organization_id: orgId, team_id: 'team-home', team_name: 'Home Team',
        division: 'U10', wins: 1, losses: 1, draws: 0, games_played: 2,
        goals_for: 5, goals_against: 4, goal_differential: 1, points: 3
      },
      {
        organization_id: orgId, team_id: 'team-away', team_name: 'Away Team',
        division: 'U10', wins: 1, losses: 1, draws: 0, games_played: 2,
        goals_for: 4, goals_against: 5, goal_differential: -1, points: 3
      }
    ];

    // --- Teams for game JOIN resolution ---
    db.teams = db.teams || [];
    if (!db.teams.find((t: any) => t.id === 'team-home')) {
      db.teams.push(
        { id: 'team-home', name: 'Home Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' },
        { id: 'team-away', name: 'Away Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' }
      );
    }

    // --- Games for score entry ---
    db.games = db.games || [];
    if (!db.games.find((g: any) => g.id === 'game-1')) {
      db.games.push({
        id: 'game-1',
        organization_id: orgId,
        season_id: 'season-1',
        home_team_id: 'team-home',
        away_team_id: 'team-away',
        start_time: new Date(Date.now() - 3600000).toISOString(),
        score_home: null,
        score_away: null
      });
    }

    // Write to BOTH persistence layers
    (window as any).__MOCK_DB__ = db;
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    localStorage.setItem('squadlogic_active_org', orgId);
  });
};

// ─── Admin Dashboard Steps ──────────────────────────────────────────

Given('the admin views the reporting dashboard', async ({ page }) => {
  // Pin to org-1 so the next page load resolves to the org with data in initialMockData
  await pinToOrg1(page);
  await page.goto('/admin/reports');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /Reporting Dashboard/i }).first()).toBeVisible({ timeout: 15000 });
});

Then('I should see the {string} metric', async ({ page }, metricName: string) => {
  if (metricName === 'Registrations') {
    // The Recharts chart renders only when view_compliance_stats has data.
    // Since we added it to initialMockData, it should always be present for org-1.
    const chart = page.locator('.recharts-responsive-container').first();
    await expect(chart).toBeVisible({ timeout: 15000 });
  } else if (metricName === 'Active Teams' || metricName === 'Total Teams') {
    const card = page.locator('[data-testid="metric-card-active-teams"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    const valSpan = card.locator('[data-testid="metric-value-active-teams"]').first();
    await expect(valSpan).toBeVisible();
    await expect(async () => {
      const val = await valSpan.textContent();
      expect(Number(val)).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
  } else {
    const normalizedName = metricName.toLowerCase().replace(/\s+/g, '-').replace('total-teams', 'active-teams');
    const card = page.locator(`[data-testid="metric-card-${normalizedName}"]`).first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const valSpan = card.locator(`[data-testid="metric-value-${normalizedName}"]`).first();
    await expect(valSpan).toBeVisible();

    await expect(async () => {
      const val = await valSpan.textContent();
      expect(Number(val)).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
  }
});

// ─── CSV Export ─────────────────────────────────────────────────────

Then('a CSV file containing player and team data should be downloaded client-side', async ({ page }) => {
  await pinToOrg1(page);
  await page.goto('/admin/reports');
  await page.waitForLoadState('networkidle');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Rosters CSV/i }).first().click({ force: true });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('squadlogic-rosters');
  expect(download.suggestedFilename()).toContain('.csv');
});

// ─── Coach League Standings Steps ───────────────────────────────────

Given('the coach views the league standings', async ({ page }) => {
  // Pin to org-1 so OrganizationContext resolves (coach is now in initialMockData's org_members)
  await pinToOrg1(page);

  // Seed league-specific data, then navigate. The page.goto triggers a fresh
  // getDB() which reads sessionStorage (where seedLeagueData wrote the data)
  // and localStorage (which pinToOrg1 set to org-1).
  await seedLeagueData(page);
  await page.goto('/standings');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: /League Standings/i }).first()).toBeVisible({ timeout: 15000 });
});

When('I input a score of {string} to {string} for a completed game', async ({ page }, scoreHome: string, scoreAway: string) => {
  // Data was already seeded by "the coach views the league standings" step.
  // Just interact with the game card.
  const gameCard = page.locator('[data-testid="game-score-card"]').filter({ hasText: /Home Team/i }).first();
  await expect(gameCard).toBeVisible({ timeout: 15000 });
  await gameCard.getByLabel('Home Score').first().fill(scoreHome);
  await gameCard.getByLabel('Away Score').first().fill(scoreAway);
  await page.waitForTimeout(1000);
});

Then('the {string} table should reflect a win for the home team', async ({ page }, tableName: string) => {
  const row = page.getByRole('row').filter({ hasText: 'Home Team' }).first();
  await expect(row.locator('td.text-status-success').first()).toHaveText('2');
});

Then('the points and goal differential should update accordingly', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'Home Team' }).first();
  await expect(row.locator('td.text-color-primary').last()).toHaveText('6');
  await expect(row.getByText('+3').first()).toBeVisible();
});