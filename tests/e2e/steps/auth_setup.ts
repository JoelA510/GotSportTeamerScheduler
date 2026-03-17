import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given } = createBdd();

// Centralized Auth Step for all scenarios
Given('I am logged into SquadLogic as an {string}', async ({ page }, role: string) => {
    await page.goto('/login');

    // Wait for the login form to be visible
    await expect(page.getByRole('heading', { name: /Sign in|Create an account/i })).toBeVisible();

    // Use environment variables for test accounts, or fallback to standard test credentials
    const email = role.toLowerCase() === 'admin'
        ? (process.env.TEST_ADMIN_EMAIL || 'admin@squadlogic.app')
        : (process.env.TEST_COACH_EMAIL || 'coach@squadlogic.app');

    const password = process.env.TEST_PASSWORD || 'test-password-123';

    // Fill out the Supabase Auth form
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);

    // Click Sign In
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Verify successful redirect to the dashboard
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });
});

// Alias for variations in Gherkin phrasing
Given('I am logged into SquadLogic as a {string}', async ({ page }, role: string) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(role.toLowerCase() === 'admin' ? 'admin@squadlogic.app' : 'coach@squadlogic.app');
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });
});

Given('I am logged into the SquadLogic dashboard as {string}', async ({ page }, userString: string) => {
    // Extract role from string like "Coach Alice" or "Admin Bob"
    const role = userString.toLowerCase().includes('admin') ? 'admin' : 'coach';
    await page.goto('/login');
    await page.getByLabel('Email').fill(`${role}@squadlogic.app`);
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });
});

Given('I am logged into SquadLogic', async ({ page }) => {
    // Default to admin if no role specified
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@squadlogic.app');
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });
});