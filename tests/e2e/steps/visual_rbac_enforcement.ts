import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given: _Given, When, Then } = createBdd();

// --- Sidebar RBAC ---
When('I view the main navigation Sidebar', async ({ page }) => {
  await page.evaluate(() => {
    console.log('[DEBUG] Auth State:', window.localStorage.getItem('supabase.auth.token'));
    console.log('[DEBUG] Mock Session:', sessionStorage.getItem('__MOCK_SESSION__'));
  });
  await expect(page.locator('aside')).toBeVisible();
});

Then(
  'I should see links for {string}, {string}, and {string}',
  async ({ page }, l1: string, l2: string, l3: string) => {
    // Highly resilient filtering for Sidebar links
    await expect(page.locator('aside').getByRole('link').filter({ hasText: l1 })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('aside').getByRole('link').filter({ hasText: l2 })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('aside').getByRole('link').filter({ hasText: l3 })).toBeVisible({
      timeout: 15000,
    });
  }
);

Then(
  'I should NOT see links for {string}, {string}, or {string}',
  async ({ page }, l1: string, l2: string, l3: string) => {
    await expect(page.locator('aside').getByRole('link').filter({ hasText: l1 })).toBeHidden();
    await expect(page.locator('aside').getByRole('link').filter({ hasText: l2 })).toBeHidden();
    await expect(page.locator('aside').getByRole('link').filter({ hasText: l3 })).toBeHidden();
  }
);

// --- Score Entry RBAC ---
When('I view the {string} section', async ({ page }, sectionName: string) => {
  // CRITICAL FIX: Seed games so the score entry fields appear
  await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
    const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
    db.games = [
      {
        id: 'g1',
        organization_id: orgId,
        home_team_id: 't1',
        away_team_id: 't2',
        start_time: new Date(Date.now() - 86400000).toISOString(),
        score_home: null,
        score_away: null,
        home_team: { name: 'Team A' },
        away_team: { name: 'Team B' },
      },
    ];
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  });
  await page.reload();

  await expect(
    page.getByRole('heading', { name: new RegExp(sectionName, 'i') }).first()
  ).toBeVisible({ timeout: 15000 });
});

Then('I should see the final scores of past games', async ({ page }) => {
  await expect(page.locator('.text-text-muted.mx-1').first()).toBeVisible();
});

Then('the score input fields and "Save" buttons should be completely hidden', async ({ page }) => {
  await expect(page.locator('input[type="number"]')).toBeHidden();
  await expect(page.getByRole('button', { name: /Save/i })).toBeHidden();
});
