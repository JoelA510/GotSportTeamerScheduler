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
  // Pin to org-1 so OrganizationContext resolves (coach is in initialMockData's org_members).
  // All standings, teams, and games data is in initialMockData — no seeding needed.
  await pinToOrg1(page);
  await page.goto('/standings');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: /League Standings/i }).first()).toBeVisible({ timeout: 15000 });
});

When('I input a score of {string} to {string} for a completed game', async ({ page }, scoreHome: string, scoreAway: string) => {
  // initialMockData has game-2 (unscored, Team A vs Team B).
  // The mock JOIN resolver populates home_team.name = 'Team A'.
  // Find the unscored game card (the one without existing scores).
  // Both game cards show Team A vs Team B, so we target the one with empty score inputs.
  const gameCards = page.locator('[data-testid="game-score-card"]');
  await expect(gameCards.first()).toBeVisible({ timeout: 15000 });

  // Find the card that has an empty Home Score input (game-2 has score_home: null)
  const unscoredCard = gameCards.filter({
    has: page.getByLabel('Home Score').first()
  }).filter({
    has: page.getByLabel('Away Score').first()
  }).first();

  await expect(unscoredCard).toBeVisible({ timeout: 10000 });

  await unscoredCard.getByLabel('Home Score').first().fill(scoreHome);
  // Wait for React to process the first handleScoreUpdate + setGames state update
  // before filling the away score, so the second onChange receives the updated score_home.
  await page.waitForTimeout(500);
  await unscoredCard.getByLabel('Away Score').first().fill(scoreAway);
  // Wait for the final standings update to complete
  await page.waitForTimeout(1500);
});

Then('the {string} table should reflect a win for the home team', async ({ page }, tableName: string) => {
  // After score entry (3-1 for Team A), Team A should now have 2 wins.
  // The standings table row for Team A should show the updated win count.
  const row = page.getByRole('row').filter({ hasText: 'Team A' }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  // The wins column (text-status-success) should show 2 (original 1 + new win)
  await expect(row.locator('td.text-status-success').first()).toHaveText('2', { timeout: 10000 });
});

Then('the points and goal differential should update accordingly', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'Team A' }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  // Points: original 3 + 3 (new win) = 6
  await expect(row.locator('td.text-color-primary').last()).toHaveText('6', { timeout: 10000 });
  // Goal differential: original +1, new game +2 (3-1) = +3
  await expect(row.getByText('+3').first()).toBeVisible({ timeout: 10000 });
});