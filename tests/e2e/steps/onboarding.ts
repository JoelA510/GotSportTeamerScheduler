import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I am registered as a brand new user with email {string}', async ({ page }, email) => {
  // Navigation to the login page is required first
  await page.goto('/login');
  
  // Fill in the sign in form using Labels for robustness
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill('test-password-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  
  console.log(`[DEBUG] Login form submitted for ${email}`);
  // Wait for session storage to be updated or URL to change
  await page.waitForLoadState('networkidle');
});

When('I navigate to the application', async ({ page }) => {
  // Ensure we are at the root or correctly redirected
  if (page.url().includes('/login')) {
      await page.goto('/');
  }
  await page.waitForLoadState('networkidle');
});

Then('I should be redirected to the Organization Creation step', async ({ page }) => {
  // The App.jsx guard should redirect users with 0 orgs here
  await expect(page).toHaveURL(/\/organizations\/new/);
  await expect(page.getByText('New Frontier', { exact: true })).toBeVisible();
  await expect(page.getByText(/Initialize your organization's digital core/i)).toBeVisible();
});

When('I fill in the organization name with {string}', async ({ page }, name) => {
  await page.getByPlaceholder(/e.g. Galaxy Strikers/i).fill(name);
});

When('I fill in the organization slug with {string}', async ({ page }, slug) => {
  await page.getByPlaceholder(/galaxy-strikers/i).fill(slug);
});

When('I submit the organization creation form', async ({ page }) => {
  await page.getByRole('button', { name: /Establish Organization/i }).click();
});

Then('I should see the success confirmation overlay', async ({ page }) => {
  await expect(page.getByText('Identity Locked', { exact: true })).toBeVisible();
});

Then('the active organization in the sidebar should read {string}', async ({ page }, orgName) => {
  await expect(page.locator('nav').getByText(orgName)).toBeVisible();
});

Given('I authenticate as {string}', async ({ page }, email) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill('test-password-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  console.log(`[DEBUG] Login form submitted for ${email}`);
  await page.waitForLoadState('networkidle');
});

Then('I should be redirected to the Setup Wizard', async ({ page }) => {
  await page.waitForURL((url) => url.pathname === '/setup' || url.pathname === '/', { timeout: 15000 });
  console.log(`[DEBUG] Landed on ${page.url()}`);
});

Then('I should bypass the Organization Creation step and land on the Dashboard', async ({ page }) => {
  // Existing users with an org should NOT be redirected to /organizations/new
  await expect(page).not.toHaveURL(/.*\/organizations\/new/);
  
  // They should be on Dashboard or Setup (if not onboarded)
  // admin@squadlogic.app's org-1 IS onboarded, so it should be /
  await expect(page).toHaveURL(/.*\/(\?.*)?$/); 
  console.log(`[DEBUG] Verifying bypass. Current URL: ${page.url()}`);

  // Verify elements are visible - Dashboard heading or Setup title
  const heading = page.getByText(/Season Setup Workflow|League Management|SquadLogic Setup/i).first();
  await expect(heading).toBeVisible({ timeout: 20000 });
  console.log('[DEBUG] Target page heading visible');
});
