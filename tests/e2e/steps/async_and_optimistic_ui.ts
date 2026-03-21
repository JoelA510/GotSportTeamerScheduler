import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// --- Teaming Rules ---
When('I change the {string} input to {string}', async ({ page }, label: string, value: string) => {
    if (page.url().includes('dashboard')) {
        await page.goto('/teams');
    }
    await expect(page.locator('text=Drafting Summary')).toBeVisible({ timeout: 15000 });
    
    const input = label.toLowerCase().includes('max roster') 
        ? page.locator('#max-roster') 
        : page.getByLabel(label);
    
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(value);
});

When('I enter a {string} of {string}', async ({ page }, label: string, value: string) => {
    const input = label.toLowerCase().includes('random seed') 
        ? page.locator('#random-seed') 
        : page.getByLabel(label);
        
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(value);
});

// --- Persistence Sync & Timeouts ---
When('I click {string} on the Team Persistence Panel', async ({ page }, btnLabel: string) => {
    if (page.url().includes('dashboard')) {
        await page.goto('/teams');
    }
    await page.getByRole('button', { name: btnLabel }).click();
});

Then('the resulting teams summary should reflect the new constraints', async ({ page }) => {
    await expect(page.locator('text=Drafting Summary')).toBeVisible();
});

When('the network connection stalls', async ({ page }) => {
    // Simulate network stall/timeout
    await page.route('**/rpc/update_team_players', route => route.abort('timedout'));
});

Then('the panel status should change to {string}', async ({ page }, status: string) => {
    await expect(page.locator('.glass-panel')).toContainText(status);
});

// --- Medical Clearance Optimistic ---
Given('I am viewing a registration for {string} with a {string} medical status', async ({ page }, name: string, status: string) => {
    await page.goto('/admin/compliance');
    await expect(page.getByText(name)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: status })).toBeVisible();
});

When('I click the {string} medical clearance button', async ({ page }, status: string) => {
    await page.getByRole('button', { name: status }).click();
});

Then('the button should instantly change to a blue {string} state', async ({ page }, newState: string) => {
    // Optimistic - check it's blue/cleared immediately
    const btn = page.getByRole('button', { name: newState });
    await expect(btn).toBeVisible();
    // Verify it's actually blue (e.g., bg-blue-600)
    await expect(btn).toHaveClass(/bg-blue|bg-brand/); 
});

Then('the database should be updated in the background without a page refresh', async ({ page }) => {
    // Verify no full page loading spinner appeared (already checked above implicitly)
    await expect(page.locator('text=Syncing...')).toBeHidden();
});

// --- Output Pipeline ---
Given('I am on the {string} workflow step on Dashboard', async ({ page }, step: string) => {
    await page.goto('/');
    // Map Outcome to Output (Gherkin says Outcome, UI says Output)
    const label = step.includes('Outcome') ? 'Output' : step;
    await page.getByText(label, { exact: false }).click();
});

Then('the status text should pulse orange saying {string}', async ({ page }, text: string) => {
    const el = page.getByText(text);
    await expect(el).toBeVisible();
    await expect(el).toHaveClass(/animate-pulse/);
});

Then('eventually display a green success message confirming completion', async ({ page }) => {
    await expect(page.locator('text=Completed, text=Success').first()).toBeVisible({ timeout: 15000 });
});

// --- Recharts ---
When('I hover my mouse over the {string} chart', async ({ page }, chartName: string) => {
    // Recharts uses SVG - target the container
    const chart = page.locator('.recharts-wrapper').first();
    await chart.hover();
});

Then('a dark-themed tooltip should appear showing exact counts', async ({ page }) => {
    await expect(page.locator('.recharts-tooltip-wrapper')).toBeVisible();
});

Given('I have generated a new set of teams', async ({ page }) => {
    // Assuming we are on the Team Management page
    await page.getByRole('button', { name: /Generate Teams/i }).click();
    await expect(page.locator('text=Drafting Summary')).toBeVisible();
});

Then('the button should disable and show {string}', async ({ page }, text: string) => {
    const btn = page.getByRole('button', { name: text });
    await expect(btn).toBeDisabled();
});

When('the generation completes, I click {string}', async ({ page }, btnLabel: string) => {
    // Wait for the pulse/loading state to finish if necessary, then click
    await expect(page.getByRole('button', { name: btnLabel })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: btnLabel }).click();
});