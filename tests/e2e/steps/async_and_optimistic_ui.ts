import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// --- Teaming Rules ---
When('I change the {string} input to {string}', async ({ page }, label: string, value: string) => {
    // Clear scheduler runs so the configuration panel renders instead of the overview panel
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        db.scheduler_runs = (db.scheduler_runs || []).filter((r: any) => r.run_type !== 'team');
        db.imports = [{ id: 'imp-1', import_type: 'players', data: { data: [{ id: 'p1', 'First Name': 'A', 'Last Name': 'B', 'Birthdate': '2015-01-01', 'Gender': 'm' }] } }];
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });

    if (!page.url().includes('/teams')) {
        await page.goto('/teams');
    } else {
        await page.reload();
    }

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
    await page.route('**/rpc/update_team_players', route => route.abort('timedout'));
});

Then('the panel status should change to {string}', async ({ page }, status: string) => {
    await expect(page.locator('.glass-panel').first()).toContainText(status);
});

// --- Medical Clearance Optimistic ---
Given('I am viewing a registration for {string} with a {string} medical status', async ({ page }, name: string, status: string) => {
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
    // Force the active step in localStorage to bypass the "Locked" state
    await page.evaluate((s) => {
        const map: any = { 'Outcome': '6', 'Teaming': '2' };
        localStorage.setItem('dashboardActiveStep', map[s] || '6');
    }, step);
    await page.goto('/');
    const label = step.includes('Outcome') ? 'output' : step.toLowerCase().replace(/\s+/g, '-');
    await page.locator(`[data-testid*="workflow-step-"][data-testid*="${label}"]`).first().click({ force: true });
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
    const chart = page.locator('.recharts-wrapper').first();
    await chart.hover();
});

Then('a dark-themed tooltip should appear showing exact counts', async ({ page }) => {
    await expect(page.locator('.recharts-tooltip-wrapper').first()).toBeVisible();
});

Given('I have generated a new set of teams', async ({ page }) => {
    await page.getByRole('button', { name: /Generate Teams/i }).first().click({ force: true });
    await expect(page.locator('text=Drafting Summary').first()).toBeVisible();
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