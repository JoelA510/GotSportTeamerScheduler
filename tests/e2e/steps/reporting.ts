import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

/**
 * Seeds the mock database with reporting-specific data.
 * IMPORTANT: Always uses 'org-1' to align with initialMockData defaults,
 * ensuring the component's currentOrganization.id resolves to a matching org.
 * Also writes directly to window.__MOCK_DB__ so getMockData()->getDB() picks
 * it up without requiring a page reload.
 */
const seedDatabase = async (page: any) => {
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    // Read the live in-memory DB (which getDB() also reads from)
    const db = (window as any).__MOCK_DB__ || JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');

    // Use org-1 to match initialMockData's organizations and org_members
    const orgId = 'org-1';

    // --- Metrics ---
    db.view_org_metrics = [
      { organization_id: orgId, total_players: 7, total_teams: 5, total_users: 10 }
    ];

    // --- Compliance (drives the Recharts BarChart) ---
    db.view_compliance_stats = [
      { organization_id: orgId, form_title: 'Fall Registration', total_registrations: 45, medical_cleared: 38 }
    ];

    // --- Standings ---
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

    // Ensure coach is a member of org-1 so the Standings test can resolve an organization
    db.organization_members = db.organization_members || [];
    if (!db.organization_members.find((m: any) => m.profile_id === 'mock-coach-id' && m.organization_id === orgId)) {
      db.organization_members.push({
        organization_id: orgId,
        profile_id: 'mock-coach-id',
        role: 'coach',
        organizations: db.organizations?.find((o: any) => o.id === orgId) || { id: orgId, name: 'SquadLogic FC' }
      });
    }

    // Write to BOTH persistence layers
    (window as any).__MOCK_DB__ = db;
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));

    // Also ensure localStorage points to org-1
    localStorage.setItem('squadlogic_active_org', orgId);
  });
};

Given('the admin views the reporting dashboard', async ({ page }) => {
  // Navigate to root to establish origin, then seed the DB
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await seedDatabase(page);

  // Reload so the app re-initializes with localStorage.squadlogic_active_org = 'org-1'.
  // This ensures OrganizationContext resolves currentOrganization to org-1,
  // which matches the seeded view_org_metrics and view_compliance_stats data.
  // The seeded data persists in sessionStorage across the reload.
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Now use sidebar click (client-side nav) to navigate to the Reporting Dashboard.
  // This preserves window.__MOCK_DB__ that was built from sessionStorage on reload.
  const reportingLink = page.getByRole('link', { name: 'Reporting Dashboard', exact: true }).first();
  await expect(reportingLink).toBeVisible({ timeout: 10000 });
  await reportingLink.click();
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: /Reporting Dashboard/i }).first()).toBeVisible({ timeout: 15000 });
});

Given('the coach views the league standings', async ({ page }) => {
  // Seed the DB first — this adds coach org-1 membership and game data,
  // and sets localStorage to org-1 so OrganizationContext can resolve correctly.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await seedDatabase(page);

  // Now navigate to standings. Use page.goto so the app re-initializes with
  // the seeded sessionStorage data (seedDatabase writes to both window.__MOCK_DB__
  // and sessionStorage, and localStorage.squadlogic_active_org = 'org-1').
  await page.goto('/standings');
  await page.waitForLoadState('networkidle');

  // Wait for the standings to render (the guard checks currentOrganization?.id)
  await expect(page.getByRole('heading', { name: /League Standings/i }).first()).toBeVisible({ timeout: 15000 });
});

Then('I should see the {string} metric', async ({ page }, metricName: string) => {
  if (metricName === 'Registrations') {
    // The Recharts container only renders when compliance.length > 0
    const chart = page.locator('.recharts-responsive-container').first();
    await expect(chart).toBeVisible({ timeout: 15000 });
  } else if (metricName === 'Active Teams' || metricName === 'Total Teams') {
    // Feature says "Total Teams" but UI says "Active Teams" — handle both
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
  // Navigate to root, seed, then reload to pick up org-1 context
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await seedDatabase(page);

  await page.reload();
  await page.waitForLoadState('networkidle');

  const reportingLink = page.getByRole('link', { name: 'Reporting Dashboard', exact: true }).first();
  await expect(reportingLink).toBeVisible({ timeout: 10000 });
  await reportingLink.click();
  await page.waitForLoadState('networkidle');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Rosters CSV/i }).first().click({ force: true });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('squadlogic-rosters');
  expect(download.suggestedFilename()).toContain('.csv');
});

When('I input a score of {string} to {string} for a completed game', async ({ page }, scoreHome: string, scoreAway: string) => {
  // Seed reporting data including games and coach org membership
  await seedDatabase(page);

  // Force a React remount by navigating away and back via sidebar (client-side)
  // This avoids page.reload() which would wipe window.__MOCK_DB__
  const dashLink = page.getByRole('link', { name: 'Dashboard', exact: true }).first();
  await expect(dashLink).toBeVisible({ timeout: 10000 });
  await dashLink.click();
  await page.waitForLoadState('networkidle');

  const standingsLink = page.getByRole('link', { name: 'League Standings', exact: true }).first();
  await expect(standingsLink).toBeVisible({ timeout: 10000 });
  await standingsLink.click();
  await page.waitForLoadState('networkidle');

  // Wait for components to hydrate
  await page.waitForTimeout(500);

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