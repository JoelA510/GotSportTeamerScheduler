import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const { Given, After } = createBdd();

// Initialize Supabase client for test data seeding only if credentials are present
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

async function setupIsolatedTenant(page: any) {
    if (!supabaseUrl || !supabaseKey || process.env.VITE_USE_MOCK_SUPABASE === 'true') {
        console.warn('Skipping isolated tenant setup due to missing Supabase credentials or mock mode.');
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

// Unified Auth Step for all scenarios
// Handles: "as an admin", "as a coach", "as a parent", "as admin", "as parent", etc.
Given(/I am logged into (?:the )?SquadLogic(?: dashboard)? as (?:an? )?"?([^"]*)"?/, async ({ page }, role: string) => {
    // @ts-ignore
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.text().includes('[DEBUG]')) {
           console.log(`[BROWSER LOG] [${msg.type()}] ${msg.text()}`);
        }
    });
    
    await page.goto('/login');
    // Force clear any stale session
    await page.evaluate(() => {
        sessionStorage.clear();
        localStorage.clear();
    });
    await page.reload();

    // Wait for the login form to be visible
    await expect(page.getByRole('heading', { name: /Sign in|Create an account/i })).toBeVisible({ timeout: 15000 });

    // Mapping role to email
    const roleMap: Record<string, string> = {
        admin: process.env.TEST_ADMIN_EMAIL || 'admin@squadlogic.app',
        coach: process.env.TEST_COACH_EMAIL || 'coach@squadlogic.app',
        parent: process.env.TEST_PARENT_EMAIL || 'parent@squadlogic.app',
        player: process.env.TEST_PLAYER_EMAIL || 'player@squadlogic.app'
    };

    const cleanRole = role.toLowerCase().replace(/^an? /, '').trim();
    const email = roleMap[cleanRole] || roleMap.admin;
    const password = process.env.TEST_PASSWORD || 'test-password-123';

    console.log(`[DEBUG] [auth_setup] role="${role}", cleanRole="${cleanRole}", email="${email}"`);

    // Fill out the Supabase Auth form
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);

    // Click Sign In
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Verify successful redirect to the dashboard
    await expect(page.getByRole('heading', { name: /League Management|Dashboard|Season Setup Workflow/i }).first()).toBeVisible({ timeout: 30000 });

    // Set up database isolation for concurrent testing
    await setupIsolatedTenant(page);
});

Given('I am logged into SquadLogic', async ({ page }) => {
    // Default to admin if no role specified
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@squadlogic.app');
    await page.getByLabel('Password').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /League Management|Dashboard|Season Setup Workflow/i }).first()).toBeVisible({ timeout: 20000 });

    await setupIsolatedTenant(page);
});

After(async ({ page }) => {
    if (!supabaseUrl || !supabaseKey || process.env.VITE_USE_MOCK_SUPABASE === 'true') return;

    try {
        // Retrieve the exact organization ID bound to this specific test runner
        const activeOrgId = await page.evaluate(() => localStorage.getItem('squadlogic_active_org'));

        if (activeOrgId) {
            console.log(`[Teardown] Purging isolated tenant: ${activeOrgId}`);
            await supabase.from('organizations').delete().eq('id', activeOrgId);
        }
    } catch (error) {
        console.error('Failed to cleanup tenant in After hook:', error);
    }
});