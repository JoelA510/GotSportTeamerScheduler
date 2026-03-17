import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const { Given, After } = createBdd();

// Initialize Supabase client for test data seeding
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function setupIsolatedTenant(page: any) {
    if (!supabaseUrl || !supabaseKey) {
        console.warn('Skipping isolated tenant setup due to missing Supabase credentials.');
        return;
    }
    const dynamicOrgId = randomUUID();

    // Insert the isolated tenant
    await supabase.from('organizations').insert({
        id: dynamicOrgId,
        name: `E2E-Isolation-${dynamicOrgId}`
    });

    // Bind local storage to the dynamic tenant instead of a hardcoded one
    await page.evaluate((orgId: string) => {
        localStorage.setItem('squadlogic_active_org', orgId);
    }, dynamicOrgId);
}

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

    // Set up database isolation for concurrent testing
    await setupIsolatedTenant(page);
});

// Alias for variations in Gherkin phrasing
Given('I am logged into SquadLogic as a {string}', async ({ page }, role: string) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(role.toLowerCase() === 'admin' ? 'admin@squadlogic.app' : 'coach@squadlogic.app');
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });

    await setupIsolatedTenant(page);
});

Given('I am logged into the SquadLogic dashboard as {string}', async ({ page }, userString: string) => {
    // Extract role from string like "Coach Alice" or "Admin Bob"
    const role = userString.toLowerCase().includes('admin') ? 'admin' : 'coach';
    await page.goto('/login');
    await page.getByLabel('Email').fill(`${role}@squadlogic.app`);
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });

    await setupIsolatedTenant(page);
});

Given('I am logged into SquadLogic', async ({ page }) => {
    // Default to admin if no role specified
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@squadlogic.app');
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard/i })).toBeVisible({ timeout: 10000 });

    await setupIsolatedTenant(page);
});