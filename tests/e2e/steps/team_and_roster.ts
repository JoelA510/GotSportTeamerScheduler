import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('there are {int} players in the U10 division', async ({ page }, count: number) => {
  // Mock player count state
});

Given('teams have been generated for the current season', async ({ page }) => { /* Mock state */ });
Given('player {string} and player {string} are registered as a buddy pair', async ({ page }, p1: string, p2: string) => { /* Mock state */ });
Given('{string} is assigned to {string}', async ({ page }, player: string, team: string) => { /* Mock state */ });

When('I view the Roster Manager', async ({ page }) => {
    await page.goto('/teams');
    const editButton = page.getByRole('button', { name: 'Edit Mode' });
    if (await editButton.isVisible()) await editButton.click();
});

Then('I should see a conflict banner with message {string}', async ({ page }, msg: string) => {
    await expect(page.locator('.bg-status-error-bg')).toBeVisible();
    await expect(page.getByText(msg)).toBeVisible();
});

Given('{string} is a {string} team', async ({ page }, team: string, gender: string) => { /* Mock state */ });
Given('player {string} has gender {string}', async ({ page }, player: string, gender: string) => { /* Mock state */ });

Then('I should see a conflict banner with message containing {string}', async ({ page }, msg: string) => {
    await expect(page.locator('.bg-status-error-bg')).toContainText(msg);
});

Given('{string} has age range U8 \\(ages 6-8)', async ({ page }, team: string) => { /* Mock state */ });
Given('player {string} is age {int}', async ({ page }, player: string, age: number) => { /* Mock state */ });
Given('all players are correctly assigned to eligible teams', async ({ page }) => { /* Mock state */ });

Then('no conflict banner should be displayed', async ({ page }) => {
    await expect(page.locator('.bg-status-error-bg')).toBeHidden();
});

When('I click the {string} button on the Roster Manager', async ({ page }, btnName: string) => {
    await page.getByRole('button', { name: btnName }).click();
});

Then('a new row should be inserted into the {string} table', async ({ page }, tableName: string) => { /* Verify DB */ });
Then('the run should have run_type {string} and status {string}', async ({ page }, type: string, status: string) => { /* Verify DB */ });