import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// --- Teaming Rules ---
When('I change the {string} input to {string}', async ({ page }, label: string, value: string) => {
    // CRITICAL FIX: Go to root first to set origin, then clear scheduler runs
    await page.goto('/');
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        db.scheduler_runs = [
            { id: 'run-1', status: 'deleted' } // Override initialMockData team run
        ];
        // Ensure imports has totalRows and validRows so the UI considers it valid
        db.imports = [{ 
            id: 'imp-1', 
            user_id: 'mock-admin-id',
            import_type: 'players', 
            data: { 
                totalRows: 1, 
                validRows: 1, 
                data: [{ 'First Name': 'A', 'Last Name': 'B', 'Birthdate': '2015-01-01', 'Gender': 'm' }] 
            } 
        }];
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });

    await page.goto('/teams');
    await expect(page.getByRole('heading', { name: /Teaming & Analysis/i }).first()).toBeVisible({ timeout: 15000 });

    const input = label.toLowerCase().includes('max roster')
        ? page.locator('#max-roster')
        : page.getByLabel(label).first();

    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(value);
});

When('I enter a {string} of {string}', async ({ page }, label: string, value: string) => {
    const input = label.toLowerCase().includes('random seed')
        ? page.locator('#random-seed')
        : page.getByLabel(label).first();

    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(value);
});

// --- Persistence Sync & Timeouts ---
When('I click {string} on the Team Persistence Panel', async ({ page }, btnLabel: string) => {
    if (page.url().includes('dashboard')) {
        await page.goto('/teams');
    }
    await page.getByRole('button', { name: btnLabel }).first().click({ force: true });
});

Then('the resulting teams summary should reflect the new constraints', async ({ page }) => {
    await expect(page.locator('text=Drafting Summary').first()).toBeVisible();
});

When('the network connection stalls', async ({ page }) => {
    // CRITICAL FIX: Match the actual Edge Function endpoint used by the app
    await page.route('**/team-persistence', route => route.abort('timedout'));
});

Then('the panel status should change to {string}', async ({ page }, status: string) => {
    await expect(page.locator('.glass-panel').first()).toContainText(status);
});

// --- Medical Clearance Optimistic ---
Given('I am viewing a registration for {string} with a {string} medical status', async ({ page }, name: string, status: string) => {
    await page.goto('/');
    await page.evaluate((playerName) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        
        db.registration_forms = [{ id: 'f1', title: 'Fall Registration', organization_id: orgId, status: 'active' }];
        db.players = [{ id: 'p1', first_name: playerName, last_name: 'Test', organization_id: orgId }];
        db.profiles = [{ id: 'mock-parent-id', first_name: 'Parent', last_name: 'Test', email: 'parent@test.com' }];
        db.registrations = [{
            id: 'reg-1',
            organization_id: orgId,
            form_id: 'f1',
            player_id: 'p1',
            profile_id: 'mock-parent-id',
            medical_cleared: false,
            waiver_signed: true,
            created_at: new Date().toISOString()
        }];
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, name);

    await page.goto('/admin/compliance');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: status }).first()).toBeVisible();
});

When('I click the {string} medical clearance button', async ({ page }, status: string) => {
    await page.getByRole('button', { name: status }).first().click({ force: true });
});

Then('the button should instantly change to a blue {string} state', async ({ page }, newState: string) => {
    const btn = page.getByRole('button', { name: newState }).first();
    await expect(btn).toBeVisible();
    await expect(btn).toHaveClass(/bg-blue|bg-brand/);
});

Then('the database should be updated in the background without a page refresh', async ({ page }) => {
    await expect(page.locator('text=Syncing...').first()).toBeHidden();
});

// --- Output Pipeline ---
Given('I am on the {string} workflow step on Dashboard', async ({ page }, step: string) => {
    // CRITICAL FIX: Go to root first to set origin, then set localStorage, then reload
    await page.goto('/');
    await page.evaluate((s) => {
        const map: any = { 'Outcome': '6', 'Teaming': '2' };
        localStorage.setItem('dashboardActiveStep', map[s] || '6');
        
        // Seed data so the Output Generation panel has something to export
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        db.teams = [{ id: 't1', name: 'Tigers', division: 'U10', organization_id: orgId }];
        
        // Ensure all previous steps are marked completed by seeding runs
        const now = new Date().toISOString();
        db.imports = [{ id: 'imp-1', status: 'completed', data: { totalRows: 10 } }];
        db.scheduler_runs = [
            { id: 'run-t', run_type: 'team', status: 'completed', created_at: now, completed_at: now, results: { teamsByDivision: { 'U10': [] } } },
            { id: 'run-p', run_type: 'practice', status: 'completed', created_at: now, completed_at: now, results: { summary: {} } },
            { id: 'run-g', run_type: 'game', status: 'completed', created_at: now, completed_at: now, results: { summary: {} } }
        ];
        
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, step);
    await page.reload();
    const label = step.includes('Outcome') ? 'output' : step.toLowerCase().replace(/\s+/g, '-');
    await page.locator(`[data-testid*="workflow-step-"]`).filter({ hasText: '6. Output & Communication' }).first().click({ force: true });
});

Then('the status text should pulse orange saying {string}', async ({ page }, text: string) => {
    const el = page.getByText(text).first();
    await expect(el).toBeVisible();
    await expect(el).toHaveClass(/animate-pulse/);
});

Then('eventually display a green success message confirming completion', async ({ page }) => {
    await expect(page.locator('text=Completed, text=Success').first()).toBeVisible({ timeout: 15000 });
});

// --- Recharts ---
When('I hover my mouse over the {string} chart', async ({ page }, chartName: string) => {
    await page.goto('/');
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        
        db.view_compliance_stats = [{
            organization_id: orgId,
            form_title: 'Fall Registration',
            total_registrations: 45,
            medical_cleared: 38
        }];
        
        db.view_league_standings = [
            { organization_id: orgId, team_id: 't1', division: 'U10', value: 1 },
            { organization_id: orgId, team_id: 't2', division: 'U12', value: 1 }
        ];
        
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    
    await page.goto('/admin/reports');
    // Wait for the Recharts canvas/SVG to mount
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 15000 });
    
    // Hover over the first bar in the chart to trigger the tooltip
    const firstBar = page.locator('.recharts-bar-rectangle').first();
    await firstBar.hover({ force: true });
});

Then('a dark-themed tooltip should appear showing exact counts', async ({ page }) => {
    await expect(page.locator('.recharts-tooltip-wrapper').first()).toBeVisible();
});

Given('I have generated a new set of teams', async ({ page }) => {
    // Seed the DB with a completed team run so the persistence panel is visible
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        db.scheduler_runs = db.scheduler_runs || [];
        db.scheduler_runs.push({
            id: 'mock-run-team-sync',
            organization_id: orgId,
            run_type: 'team',
            status: 'completed',
            results: {
                teamsByDivision: { 'U10': [{ id: 't1', name: 'Tigers' }] },
                rosterBalanceByDivision: { 'U10': { summary: { totalPlayers: 10, totalCapacity: 12 } } }
            },
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
        });
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    await page.reload();
    await expect(page.locator('text=Drafting Summary').first()).toBeVisible({ timeout: 15000 });
});

Then('the button should disable and show {string}', async ({ page }, text: string) => {
    const btn = page.getByRole('button', { name: text }).first();
    await expect(btn).toBeDisabled();
});

When('the generation completes, I click {string}', async ({ page }, btnLabel: string) => {
    const btn = page.getByRole('button', { name: btnLabel }).first();
    await expect(btn).toBeEnabled({ timeout: 15000 });
    await btn.click({ force: true });
});