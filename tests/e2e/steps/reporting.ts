import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then, Before } = createBdd();

const seedDatabase = async (page: any) => {
  // CRITICAL FIX: Go to root first to set origin for sessionStorage
  await page.goto('/');
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';

    db.organizations = [{ id: orgId, name: 'Test Org' }];

    db.organization_members = [
      { id: 'mem-admin', organization_id: orgId, profile_id: 'mock-admin-id', role: 'admin' },
      { id: 'mem-coach', organization_id: orgId, profile_id: 'mock-coach-id', role: 'coach' }
    ];

    db.view_org_metrics = db.view_org_metrics || [];
    const metricIdx = db.view_org_metrics.findIndex((m: any) => m.organization_id === orgId);
    const metrics = {
      organization_id: orgId,
      total_players: 150,
      total_teams: 12,
      total_users: 25
    };
    if (metricIdx >= 0) db.view_org_metrics[metricIdx] = metrics;
    else db.view_org_metrics.push(metrics);

    db.view_compliance_stats = [{
      organization_id: orgId,
      form_title: 'Fall Registration',
      total_registrations: 45,
      medical_cleared: 38
    }];

    db.view_league_standings = [
      {
        organization_id: orgId,
        team_id: 'team-home',
        team_name: 'Home Team',
        division: 'U10',
        wins: 1,
        losses: 1,
        draws: 0,
        games_played: 2,
        goals_for: 5,
        goals_against: 4,
        goal_differential: 1,
        points: 3
      },
      {
        organization_id: orgId,
        team_id: 'team-away',
        team_name: 'Away Team',
        division: 'U10',
        wins: 1,
        losses: 1,
        draws: 0,
        games_played: 2,
        goals_for: 4,
        goals_against: 5,
        goal_differential: -1,
        points: 3
      }
    ];

    db.games = [
      {
        id: 'game-1',
        organization_id: orgId,
        home_team_id: 'team-home',
        away_team_id: 'team-away',
        start_time: new Date(Date.now() - 3600000).toISOString(),
        score_home: null,
        score_away: null
      }
    ];

    db.teams = [
      { id: 't1', name: 'Eagles', division: 'U10', organization_id: orgId },
      { id: 't2', name: 'Hawks', division: 'U10', organization_id: orgId },
      { id: 'team-home', name: 'Home Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' },
      { id: 'team-away', name: 'Away Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' }
    ];

    db.players = [
      { id: 'p1', first_name: 'John', last_name: 'Doe', team_id: 't1', organization_id: orgId },
      { id: 'p1', first_name: 'Bob', last_name: 'Builder', team_id: 'team-home', organization_id: orgId },
      { id: 'p2', first_name: 'Alice', last_name: 'Wonder', team_id: 'team-away', organization_id: orgId }
    ];

    db.profile_players = [
      { profile_id: 'mock-parent-id', player_id: 'player-1' }
    ];

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
  if (metricName.toLowerCase() === 'registrations') {
    await expect(page.getByText(/Form Compliance Status/i).first()).toBeVisible();
    await expect(page.getByText(/45/i).first()).toBeVisible();
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