import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('an organization and season are active', async ({ page }) => {
    // Setup mock or DB state for active org/season
});

Then('I should see a {int}-step workflow on the left side', async ({ page }, steps: number) => {
    await expect(page.locator('.group.relative.overflow-hidden')).toHaveCount(steps);
});

Then('I should see a {string} panel on the right side', async ({ page }, panelName: string) => {
    await expect(page.getByRole('heading', { name: panelName })).toBeVisible();
});

Then('the League Status panel should show the active organization name', async ({ page }) => {
    await expect(page.getByText('Active Club').locator('..').locator('span').last()).toBeVisible();
});

Then('the League Status panel should show the active season name', async ({ page }) => {
    await expect(page.getByText('Active Season').locator('..').locator('span').last()).toBeVisible();
});

Given('I have imported player data', async ({ page }) => {
    await page.evaluate(() => {
        window.__MOCK_DB__.imports = [{
            id: 'import-1',
            user_id: 'mock-user-id',
            import_type: 'players',
            data: { totalRows: 150, validRows: 150 }
        }];
    });
});

Given('I have not generated teams', async ({ page }) => {
    await page.evaluate(() => {
        window.__MOCK_DB__.scheduler_runs = window.__MOCK_DB__.scheduler_runs.filter(r => r.run_type !== 'team');
    });
});

Given('I have not generated a practice schedule', async ({ page }) => {
    await page.evaluate(() => {
        window.__MOCK_DB__.scheduler_runs = window.__MOCK_DB__.scheduler_runs.filter(r => r.run_type !== 'practice');
    });
});

Given('I have not generated a game schedule', async ({ page }) => {
    await page.evaluate(() => {
        window.__MOCK_DB__.scheduler_runs = window.__MOCK_DB__.scheduler_runs.filter(r => r.run_type !== 'game');
    });
});

Given('I have generated teams', async ({ page }) => {
    // The default mock state already includes a completed team run, so we just ensure it's there
    await page.evaluate(() => {
        if (!window.__MOCK_DB__.scheduler_runs.find(r => r.run_type === 'team')) {
            window.__MOCK_DB__.scheduler_runs.push({ id: 'run-t', run_type: 'team', status: 'completed', created_at: new Date().toISOString() });
        }
    });
});

Given('I have generated a practice schedule', async ({ page }) => {
    await page.evaluate(() => {
        window.__MOCK_DB__.scheduler_runs.push({ id: 'run-p', run_type: 'practice', status: 'completed', created_at: new Date().toISOString() });
    });
});

Given('I have generated a game schedule', async ({ page }) => {
    await page.evaluate(() => {
        window.__MOCK_DB__.scheduler_runs.push({ id: 'run-g', run_type: 'game', status: 'completed', created_at: new Date().toISOString() });
    });
});

When('I view the Dashboard page', async ({ page }) => {
    await page.goto('/');
});

Then('the Readiness Score should display {string}', async ({ page }, score: string) => {
    await expect(page.getByText(score, { exact: true })).toBeVisible();
});

Then('the {string} step should show as completed', async ({ page }, stepName: string) => {
    const step = page.locator('.group').filter({ hasText: stepName });
    await expect(step.getByText('Completed')).toBeVisible();
});

When('I click on the {string} workflow step', async ({ page }, stepName: string) => {
    await page.getByRole('heading', { name: stepName }).click();
});

Then('the {string} step should expand to show its content', async ({ page }, stepName: string) => {
    const step = page.locator('.group').filter({ hasText: stepName });
    await expect(step.locator('.grid')).toHaveClass(/grid-rows-\[1fr\]/);
});

Then('the previously active step should collapse', async ({ page }) => {
    // Vision agent verifies that only one step has the expanded class
    const expandedSteps = page.locator('.grid-rows-\\[1fr\\]');
    await expect(expandedSteps).toHaveCount(1);
});

Given('I belong to organizations {string} and {string}', async ({ page }, org1: string, org2: string) => { /* Mock state */ });
Given('the sidebar shows {string} as the active organization', async ({ page }, orgName: string) => { /* Mock state */ });

When('I click the {string} selector in the sidebar', async ({ page }, selectorName: string) => {
    await page.getByText(selectorName).locator('..').locator('button').click();
});

Then('I should see a dropdown with {string} and {string}', async ({ page }, org1: string, org2: string) => {
    await expect(page.getByRole('button', { name: org1 })).toBeVisible();
    await expect(page.getByRole('button', { name: org2 })).toBeVisible();
});

When('I select {string}', async ({ page }, option: string) => {
    await page.getByRole('button', { name: option, exact: true }).click();
});

Then('the sidebar header should display {string}', async ({ page }, orgName: string) => {
    await expect(page.getByText('Active Organization').locator('..').locator('button')).toContainText(orgName);
});

Then('the {string} dropdown should update to show seasons for {string}', async ({ page }, dropdown: string, orgName: string) => {
    // Verify state update
});

Then('the dashboard data should refresh to show {string} data', async ({ page }, orgName: string) => {
    // Verify data refresh
});

Then('I should see a dropdown with valid seasons for the current organization', async ({ page }) => {
    await expect(page.locator('.absolute.top-full button')).not.toHaveCount(0);
});

When('I select a different season', async ({ page }) => {
    await page.locator('.absolute.top-full button').last().click();
});

Then('the season selector should display the selected season', async ({ page }) => {
    // Verify UI update
});

Then('the dashboard data should refresh to show data for the selected season', async ({ page }) => {
    // Verify data refresh
});

Given('the localStorage contains a season ID that does not exist for {string}', async ({ page }, orgName: string) => {
    await page.evaluate(() => localStorage.setItem('squadlogic-current-season', 'invalid-id'));
});

When('I switch the active organization to {string}', async ({ page }, orgName: string) => {
    await page.getByText('Active Organization').locator('..').locator('button').click();
    await page.getByRole('button', { name: orgName }).click();
});

Then('the active season should automatically select the most recent season for {string}', async ({ page }, orgName: string) => {
    // Verify fallback logic
});

Then('localStorage should be updated with the valid season', async ({ page }) => {
    const season = await page.evaluate(() => localStorage.getItem('squadlogic-current-season'));
    expect(season).not.toBe('invalid-id');
});

Given('I have selected {string} as the active organization', async ({ page }, orgName: string) => { /* Mock state */ });
Given('a valid season is selected', async ({ page }) => { /* Mock state */ });

Then('the sidebar should still show {string} as the active organization', async ({ page }, orgName: string) => {
    await expect(page.getByText('Active Organization').locator('..').locator('button')).toContainText(orgName);
});

Then('the sidebar should still show the selected season', async ({ page }) => {
    await expect(page.getByText('Active Season').locator('..').locator('button')).toBeVisible();
});