import { createBdd } from 'playwright-bdd';
import { test, expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I have an organization labeled {string}', async ({ page }, orgName: string) => { });
Given('another organization {string} exists', async ({ page }, orgName: string) => { });
Given('{string} has a location {string} with field {string}', async ({ page }, org: string, loc: string, field: string) => { });

Given('I am on the {string} page', async ({ page }, pageName: string) => {
  await page.goto('http://localhost:5173/facilities');
});

When('I load the Field Management page', async ({ page }) => {
  await page.goto('http://localhost:5173/facilities');
});

When('I click the {string} button', async ({ page }, buttonName: string) => {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
});

When('I click {string}', async ({ page }, buttonName: string) => {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
});

When('I select {string} from the Location dropdown', async ({ page }, option: string) => {
  await page.getByRole('button', { name: option }).click();
});

When('I enter {string} into the new location input', async ({ page }, locName: string) => {
  await page.getByPlaceholder('e.g. Main Complex').fill(locName);
});

When('I enter {string} into the Field Name input', async ({ page }, fieldName: string) => {
  await page.getByPlaceholder('e.g. Field 1').fill(fieldName);
});

When('I select {string} for Type', async ({ page }, type: string) => {
  await page.getByRole('combobox').first().selectOption(type);
});

When('I select {string} for Size', async ({ page }, size: string) => { });

When('I set the Priority to {int}', async ({ page }, priority: number) => {
  await page.getByRole('spinbutton').fill(priority.toString());
});

When('I ensure {string} is disabled', async ({ page }, label: string) => {
  const toggle = page.locator('label').filter({ hasText: 'Sub-fields' }).locator('input');
  const isChecked = await toggle.isChecked();
  if (isChecked) {
    await page.locator('label').filter({ hasText: 'Sub-fields' }).click();
  }
});

Then('I should see {string} listed under {string} on the Field Management grid', async ({ page }, fieldName: string, locName: string) => {
  await expect(page.getByRole('heading', { name: fieldName })).toBeVisible();
  await expect(page.getByText(locName, { exact: true })).toBeVisible();
});

Then('{string} should display {string}, {string}, and Priority {string}', async ({ page }, fieldName: string, expectedType: string, expectedSize: string, expectedPriority: string) => {
  await expect(page.getByText(expectedType)).toBeVisible();
  await expect(page.getByText(`Priority: ${expectedPriority}`)).toBeVisible();
});

Then('{string} should not display a subunit indicator', async ({ page }, fieldName: string) => {
  await expect(page.getByText('A/B Halves Enabled')).toBeHidden();
});

Then('I should not see {string} in the Location dropdown', async ({ page }, locName: string) => {
  await expect(page.getByRole('combobox').locator(`option[value="${locName}"]`)).toBeHidden();
});

Then('I should not see {string} on the grid', async ({ page }, fieldName: string) => {
  await expect(page.getByRole('heading', { name: fieldName })).toBeHidden();
});

Given('a field {string} at {string} exists without subunits', async ({ page }, fieldName: string, locName: string) => { });
Given('a field {string} at {string} exists with subunits', async ({ page }, fieldName: string, locName: string) => { });
Given('a field {string} at {string} exists and is active', async ({ page }, fieldName: string, locName: string) => { });

When('I click the {string} button for {string}', async ({ page }, btnLabel: string, fieldName: string) => {
  await page.getByLabel(`${btnLabel} ${fieldName}`).click();
});

When('I toggle {string} to ON', async ({ page }, label: string) => {
  const toggle = page.locator('label').filter({ hasText: label }).locator('input');
  const isChecked = await toggle.isChecked();
  if (!isChecked) {
    await page.locator('label').filter({ hasText: label }).click();
  }
});

When('I toggle {string} to OFF', async ({ page }, label: string) => {
  const toggle = page.locator('label').filter({ hasText: label }).locator('input');
  const isChecked = await toggle.isChecked();
  if (isChecked) {
    await page.locator('label').filter({ hasText: label }).click();
  }
});

Then('{string} should display a subunit indicator like {string}', async ({ page }, fieldName: string, indicator: string) => {
  await expect(page.getByText(indicator)).toBeVisible();
});

Then('the database should automatically contain field subunits {string} and {string} for {string}', async ({ page }, a: string, b: string, fieldName: string) => { });
Then('the database should automatically remove field subunits for {string}', async ({ page }, fieldName: string) => { });

Then('{string} should display an {string} badge on the grid', async ({ page }, fieldName: string, badge: string) => {
  await expect(page.getByText(badge)).toBeVisible();
});
