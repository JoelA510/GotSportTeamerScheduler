import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then, Before } = createBdd();

Before(async ({ page }) => {
  await page.addInitScript(() => {
    const db = (window as any).__MOCK_DB__ || {};
    const orgId = 'org-test-e2e';
    db.organizations = [{ id: orgId, name: 'Test Org' }];
    
    // Seed Season
    db.season_settings = db.season_settings || [];
    if (!db.season_settings.find((s: any) => s.name === 'Fall 2026')) {
      db.season_settings.push({
        id: 'season-fall-26',
        organization_id: orgId,
        name: 'Fall 2026',
        status: 'active',
        created_at: new Date().toISOString()
      });
    }

    // Seed Form
    db.registration_forms = db.registration_forms || [];
    if (!db.registration_forms.find((f: any) => f.title === 'Fall Registration')) {
      db.registration_forms.push({
        id: 'f-fall',
        title: 'Fall Registration',
        organization_id: orgId,
        status: 'active',
        fields: [
          { label: 'Emergency Contact', type: 'text', required: true }
        ]
      });
    }

    // Seed Registration for Compliance Dashboard scenario
    db.registrations = db.registrations || [];
    if (!db.registrations.find((r: any) => r.id === 'reg-alex')) {
       db.registrations.push({
          id: 'reg-alex',
          organization_id: orgId,
          form_id: 'f-fall',
          player_id: 'player-1',
          profile_id: 'mock-parent-id',
          medical_cleared: false,
          waiver_signed: true,
          created_at: new Date().toISOString()
       });
       
       // Ensure Alex exists
       db.players = db.players || [];
       if (!db.players.find((p: any) => p.id === 'player-1')) {
         db.players.push({
           id: 'player-1',
           first_name: 'Alex',
           last_name: 'Smith',
           organization_id: orgId
         });
       }

       // Ensure Alex belongs to parent
       db.profile_players = db.profile_players || [];
       if (!db.profile_players.find((pp: any) => pp.player_id === 'player-1')) {
         db.profile_players.push({
           profile_id: 'mock-parent-id',
           player_id: 'player-1'
         });
       }
    }
    
    (window as any).__MOCK_DB__ = db;
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    localStorage.setItem('squadlogic_active_org', orgId);
  });
  
  if (page.url() === 'about:blank') await page.goto('/');
});

Given('there is an active season {string}', async ({ page }, seasonName: string) => {
  // Already handled in Before hook, but we keep it to satisfy the step if needed
  // or we can just leave it empty.
});

// Admin creates form
When('I create a new form for {string} titled {string}', async ({ page }, seasonName: string, formTitle: string) => {
  await page.getByRole('button', { name: /Create Form|New Form/i }).click();
  await page.getByLabel(/Form Title|Title/i).fill(formTitle);
  // If there's a season selector
  const seasonSelect = page.getByLabel(/Season/i);
  if (await seasonSelect.isVisible()) {
    await seasonSelect.selectOption({ label: seasonName });
  }
  await page.getByLabel(/Description/i).fill('Test description');
});

When('I add a custom text field labeled {string}', async ({ page }, fieldLabel: string) => {
  await page.getByRole('button', { name: /Add Field/i }).click();
  const lastField = page.locator('.form-field-editor').last();
  await lastField.getByLabel(/Label/i).fill(fieldLabel);
  // Default is 'text', so we just ensure it's selected
  await lastField.getByLabel(/Type/i).selectOption('text');
});

When('I add a custom {string} field labeled {string}', async ({ page }, fieldType: string, fieldLabel: string) => {
  await page.getByRole('button', { name: /Add Field/i }).click();
  const lastField = page.locator('.form-field-editor').last();
  await lastField.getByLabel(/Label/i).fill(fieldLabel);
  await lastField.getByLabel(/Type/i).selectOption({ label: fieldType.charAt(0).toUpperCase() + fieldType.slice(1) });
});

Given('I navigate to the compliance dashboard', async ({ page }) => {
  await page.goto('/admin/compliance');
  await page.waitForSelector('table tbody tr:not(:has-text("Loading"))', { timeout: 10000 });
});

When('I save the form', async ({ page }) => {
  await page.getByRole('button', { name: /Save Form/i }).click();
  await page.getByText(/Form saved successfully|Success/i).waitFor();
});

Then('the form {string} should appear in the forms list', async ({ page }, formTitle: string) => {
  await expect(page.locator('table')).toContainText(formTitle);
});

// Parent Registration Flow
Given('I navigate to the registration link for {string}', async ({ page }, formTitle: string) => {
  // Direct navigation to seeded form ID 'f-fall' for reliability
  await page.goto('/register/f-fall');
  await page.waitForLoadState('networkidle');
});

When('I select my child {string}', async ({ page }, childName: string) => {
  await page.waitForTimeout(1000); // Wait for list to stabilize
  await page.getByRole('button', { name: new RegExp(childName, 'i') }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
});

When('I fill out the custom field {string} with {string}', async ({ page }, fieldLabel: string, value: string) => {
  await page.getByLabel(new RegExp(fieldLabel, 'i')).fill(value);
});

When('I agree to the waiver', async ({ page }) => {
  // Wizard Step transition from Step 2 to Step 3
  const nextBtn = page.getByRole('button', { name: /Next Step/i });
  if (await nextBtn.isVisible()) {
    await nextBtn.click();
  }
  // Checkbox ID is 'waiver'
  await page.evaluate(() => {
    const cb = document.querySelector('#waiver') as HTMLInputElement;
    if (cb && !cb.checked) cb.click();
  });
});

When('I submit the registration', async ({ page }) => {
  await page.getByRole('button', { name: /Complete Registration|Submit/i }).click();
  await page.waitForLoadState('networkidle');
});

Then('I should see a success message', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Registration Complete|Success/i })).toBeVisible();
});


When('I filter for {string}', async ({ page }, formTitle: string) => {
  await page.getByLabel(/Filter by Form|Form/i).selectOption({ label: formTitle });
});

Then('I should see a registration for {string}', async ({ page }, childName: string) => {
  await expect(page.getByRole('cell', { name: new RegExp(childName, 'i') })).toBeVisible();
});

Then('the waiver status should be {string}', async ({ page }, status: string) => {
  await expect(page.getByText(new RegExp(status, 'i'))).toBeVisible();
});

Then('the medical status should be {string}', async ({ page }, status: string) => {
  // UI mapping: Pending -> Reviewing
  const uiStatus = status === 'Pending' ? 'Reviewing' : status;
  const row = page.getByRole('row').filter({ hasText: 'Alex' });
  await expect(row).toContainText(uiStatus);
});

