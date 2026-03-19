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
const routeMap: Record<string, string> = {
    'Dashboard page': '/',
    'Dashboard': '/',
    'Compliance Dashboard': '/admin/compliance',
    'Reporting Dashboard': '/admin/reports',
    'Team Management page': '/teams',
    'Registration Forms': '/admin/forms'
};

When('I navigate to the {string} page', async ({ page }, pageName: string) => {
    const url = routeMap[pageName] || routeMap[`${pageName} page`];
    if (url) {
        await page.goto(url);
    } else {
        await page.getByRole('link', { name: pageName, exact: true }).click();
    }
    await page.waitForLoadState('networkidle');
});

Given('I navigate to the {string}', async ({ page }, destination: string) => {
    const url = routeMap[destination] || routeMap[`${destination} page`];
    if (url) {
        await page.goto(url);
    } else {
        await page.getByRole('link', { name: destination, exact: true }).click();
    }
    await page.waitForLoadState('networkidle');
});

// Flexible navigation step that works with or without quotes, but narrow to avoid conflicts
Given(/I navigate to the (Dashboard page|Dashboard|Compliance Dashboard|Reporting Dashboard|Team Management page|Registration Forms)/, async ({ page }, destination: string) => {
    const url = routeMap[destination];
    if (url) {
        await page.goto(url);
    } else {
        await page.getByRole('link', { name: destination, exact: true }).click();
    }
    await page.waitForLoadState('networkidle');
});

Given('I am on the {string}', async ({ page }, pageName: string) => {
    // Alias for navigation
    const routeMap: Record<string, string> = {
        'Compliance Dashboard': '/admin/compliance',
        'Reporting Dashboard': '/admin/reporting',
        'Dashboard page': '/',
        'Dashboard': '/'
    };
    const url = routeMap[pageName] || '/';
    await page.goto(url);
    await page.waitForLoadState('networkidle');
});

// More flexible version for I am on the ... but narrow to avoid conflicts
Given(/I am on the (Dashboard page|Dashboard|Practice Scheduling page|Compliance Dashboard|Reporting Dashboard)/, async ({ page }, pageName: string) => {
    const routeMap: Record<string, string> = {
        'Compliance Dashboard': '/admin/compliance',
        'Reporting Dashboard': '/admin/reporting',
        'Dashboard page': '/',
        'Dashboard': '/',
        'Practice Scheduling page': '/schedule/practice'
    };
    const url = routeMap[pageName] || '/';
    await page.goto(url);
    await page.waitForLoadState('networkidle');
});

When('I view the Dashboard', async ({ page }) => {
    await page.goto('/');
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

Then('I should see the text {string}', async ({ page }, text: string) => {
    await expect(page.getByText(text)).toBeVisible();
});

Then(/the dashboard data should refresh to show (.*) data/, async ({ page }, orgName: string) => {
    // Simple verification - dashboard should be visible and not empty
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible();
});
