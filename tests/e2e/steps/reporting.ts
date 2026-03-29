import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

const seedDatabase = async (page: any) => {
  // Wait for the DOM to settle to ensure React has initialized active org in localStorage
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';

    // Clear and push fresh metric records scoped to this org ID
    db.view_org_metrics = [];
    db.view_org_metrics.push({
      organization_id: orgId,
      total_players: 7,
      total_teams: 5,
      total_users: 10
    });

    db.view_compliance_stats = [];
    db.view_compliance_stats.push({
      organization_id: orgId,
      form_title: 'Fall Registration',
      total_registrations: 45,
      medical_cleared: 38
    });

    db.view_league_standings = [];
    db.view_league_standings.push(
      {
        organization_id: orgId,
        team_id: 'team-home',
        team_name: 'Home Team',
        division: 'U10',
        wins: 1, losses: 1, draws: 0, games_played: 2,
        goals_for: 5, goals_against: 4, goal_differential: 1, points: 3
      },
      {
        organization_id: orgId,
        team_id: 'team-away',
        team_name: 'Away Team',
        division: 'U10',
        wins: 1, losses: 1, draws: 0, games_played: 2,
        goals_for: 4, goals_against: 5, goal_differential: -1, points: 3
      }
    );

    const seasonId = localStorage.getItem('squadlogic-current-season') || 'season-1';

    db.teams = db.teams || [];
    if (!db.teams.find((t: any) => t.id === 'team-home')) {
        db.teams.push(
          { id: 'team-home', name: 'Home Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' },
          { id: 'team-away', name: 'Away Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' }
        );
    }

    db.games = db.games || [];
    if (!db.games.find((g: any) => g.id === 'game-1')) {
        db.games.push({
            id: 'game-1',
            organization_id: orgId,
            season_id: seasonId,
            home_team_id: 'team-home',
            away_team_id: 'team-away',
            start_time: new Date(Date.now() - 3600000).toISOString(),
            score_home: null,
            score_away: null
        });
    }

    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
};

Given('I navigate to the reporting dashboard', async ({ page }) => {
  await seedDatabase(page);
  await page.goto('/admin/reports');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.text-4xl', { timeout: 10000 });
});

Then('I should see the {string} metric', async ({ page }, metricName: string) => {
  // Ensure data is seeded for this isolated tenant (now safe to call because we are already on the page)
  await seedDatabase(page);
  
  // Force a reload on the first metric check so the components fetch the newly seeded data
  if (metricName.toLowerCase() === 'total players') {
      await page.reload();
      await page.waitForLoadState('networkidle');
  }

  if (metricName.toLowerCase() === 'registrations') {
    await expect(page.getByText(/Form Compliance Status/i).first()).toBeVisible();
    
    // CRITICAL FIX: Wait for Recharts animation to complete before asserting visibility
    await page.waitForTimeout(1000);
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15000 });
  } else {
    const normalizedName = metricName.toLowerCase().replace(/\s+/g, '-').replace('total-teams', 'active-teams');
    const card = page.locator(`[data-testid="metric-card-${normalizedName}"]`).first();
    await expect(card).toBeVisible();

    const valSpan = card.locator(`[data-testid="metric-value-${normalizedName}"]`).first();
    await expect(valSpan).toBeVisible();

    await expect(async () => {
      const val = await valSpan.textContent();
      expect(Number(val)).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
  }
});

Then('a CSV file containing player and team data should be downloaded client-side', async ({ page }) => {
  // Ensure we are on the reporting page before seeding
  if (!page.url().includes('/reports')) {
    await page.goto('/admin/reports');
    await page.waitForLoadState('networkidle');
  }
  
  await seedDatabase(page);
  await page.reload();
  
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Rosters CSV/i }).first().click({ force: true });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('squadlogic-rosters');
  expect(download.suggestedFilename()).toContain('.csv');
});

When('I input a score of {string} to {string} for a completed game', async ({ page }, scoreHome: string, scoreAway: string) => {
  if (!page.url().includes('/standings')) {
    await page.goto('/standings');
    await page.waitForLoadState('networkidle');
  }
  
  // Ensure data is seeded for this isolated tenant AFTER navigation
  await seedDatabase(page);
  
  await page.reload();
  await page.waitForLoadState('networkidle');

  const gameCard = page.locator('[data-testid="game-score-card"]').filter({ hasText: /Home Team/i }).first();
  await expect(gameCard).toBeVisible({ timeout: 10000 });
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