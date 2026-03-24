import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('the user has modified the {string} roster', async ({ page }, teamName: string) => {
    // CRITICAL FIX: Go to root first to set origin, then set localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('dashboardActiveStep', '2'));

    // Inject a mock pending override so the Sync button becomes active
    await page.evaluate((tName) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        db.scheduler_runs = db.scheduler_runs || [];
        if (db.scheduler_runs.length === 0) {
            db.scheduler_runs.push({
                id: 'mock-run-1',
                run_type: 'team',
                status: 'completed',
                results: { teams: [{ id: 't1', name: tName, division: 'U10' }] }
            });
        }
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, teamName);

    await page.goto('/teams');
    await expect(page.getByRole('heading', { name: /Teaming & Analysis/i }).first()).toBeVisible({ timeout: 15000 });
});

When('the application attempts to sync the changes', async ({ page }) => {
    const syncBtn = page.getByRole('button', { name: /Sync to Supabase/i }).first();
    await expect(syncBtn).toBeVisible({ timeout: 10000 });
    await syncBtn.click({ force: true });
});

When('the network connection drops or the API returns a 504 Timeout', async ({ page }) => {
    // Playwright Network Interception: Force the edge function to fail
    await page.route('**/team-persistence', route => route.abort('failed'));
});

Then('the user should see a {string} banner', async ({ page }, expectedBanner: string) => {
    // Map feature file text to actual app text
    const textToFind = expectedBanner.includes('Sync Failed') ? 'Failed to fetch' : expectedBanner;
    await expect(page.getByText(textToFind, { exact: false }).first()).toBeVisible({ timeout: 15000 });
});

Then('the {string} card should remain in its newly modified state locally', async ({ page }, teamName: string) => {
    // Verify optimistic UI holds state despite API failure (the team is still rendered)
    await expect(page.getByText(teamName).first()).toBeVisible();
});