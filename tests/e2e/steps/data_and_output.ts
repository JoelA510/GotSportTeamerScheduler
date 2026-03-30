import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I have navigated to the Data Import page', async ({ page }) => { await page.goto('/import'); });
Given('a valid GotSport player CSV file exists', async ({ page }) => {
    (page as any).mockCsv = Buffer.from('First Name,Last Name,Skill Level\nAlex,Smith,advanced');
});
Given('I upload the GotSport player CSV file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
        await fileInput.setInputFiles({
            name: 'players.csv',
            mimeType: 'text/csv',
            buffer: (page as any).mockCsv || Buffer.from('First Name,Last Name\nAlex,Smith')
        });
    }
});

When('the file is missing a required column such as {string} or {string}', async ({ page }, col1: string, col2: string) => {
    const csvContent = 'Skill Level\nadvanced';
    await page.locator('input[type="file"]').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from(csvContent) });
});

Then('the system should reject the file completely', async ({ page }) => {
    await expect(page.getByTestId('import-error-banner').first()).toBeVisible();
});

Then('present a clear validation error to the user in the UI', async ({ page }) => {
    await expect(page.getByTestId('import-error-banner').first()).toContainText('Missing required columns');
});

Given('I upload the GotSport player CSV file with valid headers', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
        await fileInput.setInputFiles({
            name: 'players_valid.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from('First Name,Last Name,Date of Birth\nAlex,Smith,2015-01-01')
        });
    }
});

When('a specific row has malformed data \\(e.g. invalid date of birth)', async ({ page }) => {
    const csvContent = 'First Name,Last Name,Date of Birth\nAlex,Smith,\nSam,Jones,2015-01-01';
    await page.locator('input[type="file"]').setInputFiles({ name: 'row_errors.csv', mimeType: 'text/csv', buffer: Buffer.from(csvContent) });

    // Wait for preview to render
    await expect(page.getByRole('button', { name: 'Start Import' })).toBeVisible();

    // Verify cell error in preview
    await expect(page.locator('.cell-error').first()).toBeVisible();

    // Start import to see the validation panel
    await page.getByRole('button', { name: 'Start Import' }).click();
});

Then('the system should flag the row as an error', async ({ page }) => {
    await expect(page.getByText('Data Validation Issues').first()).toBeVisible();
});

Then('load the remaining valid rows into the staging table', async ({ page }) => {
    await expect(page.getByText('Successfully imported').first()).toBeVisible();
});

Then('present an interface to manually correct the malformed row', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Review' }).first()).toBeVisible();
});

When('I click to export the team rosters or schedules', async ({ page }) => {
    // CRITICAL FIX: Go to root first to set origin, then set localStorage, then reload
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('dashboardActiveStep', '6'));
    await page.reload();
    
    // CRITICAL FIX: Use a more robust locator that matches the actual rendered text
    const step6 = page.locator('[data-testid*="workflow-step-"]').filter({ hasText: '6. Output & Communication' }).first();
    await step6.click({ force: true });
    
    await page.getByTestId('generate-csvs-btn').first().click({ force: true });
});

Then('the system should generate the CSV file', async ({ page }) => {
    await expect(page.getByText('Generated Files').first()).toBeVisible();
});

Then('automatically upload a backup copy to the organization\'s Supabase Storage bucket', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload to Storage' }).first().click({ force: true });
    await expect(page.getByText('Uploaded').first()).toBeVisible();
});

Then('provide a secure download link or trigger an instant download', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Download Master CSV' }).first()).toBeVisible();
});

Given('the team rosters have been generated and finalized', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        
        // Seed a completed team run so the dashboard passes the teams to the Output panel
        db.scheduler_runs = db.scheduler_runs || [];
        db.scheduler_runs.push({
            id: 'mock-run-output',
            organization_id: orgId,
            run_type: 'team',
            status: 'completed',
            results: {
                teamsByDivision: {
                    'U10': [
                        { id: 't1', name: 'Tigers', division: 'U10', headCoach: 'Coach Smith', coachEmail: 'smith@example.com' }
                    ]
                }
            },
            created_at: new Date().toISOString()
        });
        
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
});

When('I access the communication tools', async ({ page }) => {
    // CRITICAL FIX: Go to root first to set origin, then set localStorage, then reload
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('dashboardActiveStep', '6'));
    await page.reload();
    
    // CRITICAL FIX: Use a more robust locator that matches the actual rendered text
    const step6 = page.locator('[data-testid*="workflow-step-"]').filter({ hasText: '6. Output & Communication' }).first();
    await step6.click({ force: true });
});

Then('I should be able to generate a batch of draft emails for all head coaches', async ({ page }) => {
    await page.getByTestId('generate-emails-btn').first().click({ force: true });
});

Then('each draft should include the coach\'s name, team name, and assigned practice schedule', async ({ page }) => {
    await expect(page.getByText('Subject: Welcome to the season').first()).toBeVisible();
});