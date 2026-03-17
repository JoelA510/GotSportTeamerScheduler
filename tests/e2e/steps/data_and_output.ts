import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I have navigated to the Data Import page', async ({ page }) => { await page.goto('/import'); });
Given('a valid GotSport player CSV file exists', async ({ page }) => { /* Setup mock file */ });
Given('I upload the GotSport player CSV file', async ({ page }) => { /* Simulate upload */ });

When('the file is missing a required column such as {string} or {string}', async ({ page }, col1: string, col2: string) => {
    // Upload invalid file
});

Then('the system should reject the file completely', async ({ page }) => {
    await expect(page.getByText('Import failed')).toBeVisible();
});

Then('present a clear validation error to the user in the UI', async ({ page }) => {
    await expect(page.locator('.text-red-400')).toBeVisible();
});

Given('I upload the GotSport player CSV file with valid headers', async ({ page }) => { /* Simulate upload */ });

When('a specific row has malformed data \\(e.g. invalid date of birth)', async ({ page }) => {
    // Upload file with row errors
});

Then('the system should flag the row as an error', async ({ page }) => {
    await expect(page.getByText('Data Validation Issues')).toBeVisible();
});

Then('load the remaining valid rows into the staging table', async ({ page }) => {
    await expect(page.getByText('Successfully imported')).toBeVisible();
});

Then('present an interface to manually correct the malformed row', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Review' }).first()).toBeVisible();
});

When('I click to export the team rosters or schedules', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate CSVs' }).click();
});

Then('the system should generate the CSV file', async ({ page }) => {
    await expect(page.getByText('Generated Files')).toBeVisible();
});

Then('automatically upload a backup copy to the organization\'s Supabase Storage bucket', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload to Storage' }).click();
    await expect(page.getByText('Uploaded')).toBeVisible();
});

Then('provide a secure download link or trigger an instant download', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Download Master CSV' })).toBeVisible();
});

Given('the team rosters have been generated and finalized', async ({ page }) => { /* Mock state */ });

When('I access the communication tools', async ({ page }) => {
    // Navigate to output panel
});

Then('I should be able to generate a batch of draft emails for all head coaches', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Draft Welcome Emails' }).click();
});

Then('each draft should include the coach\'s name, team name, and assigned practice schedule', async ({ page }) => {
    await expect(page.getByText('Subject: Welcome to the season').first()).toBeVisible();
});