import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('there is an active season {string}', async ({ page }, seasonName: string) => {
  // Setup season
});

// Admin creates form
When('I create a new form for {string} titled {string}', async ({ page }, seasonName: string, formTitle: string) => {
  // Click create form
});

When('I add a custom text field labeled {string}', async ({ page }, fieldLabel: string) => {
  // Add field
});

When('I save the form', async ({ page }) => {
  // Save form
});

Then('the form {string} should appear in the forms list', async ({ page }, formTitle: string) => {
  // Assert form exists
});

// Parent registers
Given('I navigate to the registration link for {string}', async ({ page }, formTitle: string) => {
  // Navigate to /register/formId
});

When('I select my child {string}', async ({ page }, childName: string) => {
  // Click child name
});

When('I fill out the custom field {string} with {string}', async ({ page }, fieldLabel: string, value: string) => {
  // Fill input
});

When('I agree to the waiver', async ({ page }) => {
  // Check waiver checkbox
});

When('I submit the registration', async ({ page }) => {
  // Click submit
});

Then('I should see a success message', async ({ page }) => {
  // Assert "Registration Complete"
});

// Admin checks dashboard
Given('I navigate to the {string} page', async ({ page }, destination: string) => {
  if (destination === 'Compliance Dashboard') {
    await page.goto('/admin/compliance');
  } else if (destination === 'Registration Forms') {
    await page.goto('/admin/forms');
  }
});

Given('I navigate to the {string}', async ({ page }, destination: string) => {
  if (destination === 'Compliance Dashboard') {
    await page.goto('/admin/compliance');
  } else if (destination === 'Registration Forms') {
    await page.goto('/admin/forms');
  }
});

When('I filter for {string}', async ({ page }, formTitle: string) => {
  // Select form from dropdown
});

Then('I should see a registration for {string}', async ({ page }, playerName: string) => {
  // Assert player in table
});

Then('the waiver status should be {string}', async ({ page }, status: string) => {
  // Assert Confirmed string
});

Then('the medical status should be {string}', async ({ page }, status: string) => {
  // Assert Pending string
});
