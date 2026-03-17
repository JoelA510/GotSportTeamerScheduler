import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// --- Global State Setup ---
Given('the season {string} is active and schedules are published', async ({ page }, seasonName: string) => {
    // In our UI-driven BDD philosophy, we rely on the dynamic tenant seed data 
    // having this active by default. We just assert the UI is ready.
    await page.waitForLoadState('networkidle');
    const header = page.locator('header');
    if (await header.isVisible()) {
        await expect(header).toContainText(seasonName, { ignoreCase: true });
    }
});

Given('the season {string} is active', async ({ page }, seasonName: string) => {
    await page.waitForLoadState('networkidle');
});

// --- Global Navigation ---
When('I navigate to the {string} page', async ({ page }, pageName: string) => {
    await page.getByRole('link', { name: pageName, exact: true }).click();
    await page.waitForLoadState('networkidle');
});

When('I attempt to navigate to the {string} page', async ({ page }, pageName: string) => {
    // Used for RBAC testing where the link might not exist, so we force URL routing
    const routeMap: Record<string, string> = {
        'Data Import': '/import',
        'Field Management': '/fields',
        'Practice Schedule': '/schedule/practice',
        'Settings': '/settings'
    };
    
    const targetUrl = routeMap[pageName];
    if (!targetUrl) throw new Error(`Route mapping not defined for: ${pageName}`);
    
    await page.goto(targetUrl);
});

// --- Global Assertions ---
Then('I should be redirected to the Dashboard', async ({ page }) => {
    // Wait for React Router to complete the redirect
    await page.waitForURL('**/');
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible();
});

Then('I should see an {string} warning', async ({ page }, warningText: string) => {
    const toastOrBanner = page.getByText(warningText, { exact: false });
    await expect(toastOrBanner).toBeVisible();
});
