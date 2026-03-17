import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Then('I should visually see links for {string}, {string}, and {string}', async ({ page }, link1: string, link2: string, link3: string) => {
    await expect(page.getByRole('link', { name: link1 })).toBeVisible();
    await expect(page.getByRole('link', { name: link2 })).toBeVisible();
    await expect(page.getByRole('link', { name: link3 })).toBeVisible();
});

Then('the {string}, {string}, {string}, and {string} links should be completely absent from the UI', async ({ page }, link1: string, link2: string, link3: string, link4: string) => {
    // Using .toBeHidden() ensures the element is either not in the DOM, or has display:none/visibility:hidden
    await expect(page.getByRole('link', { name: link1 })).toBeHidden();
    await expect(page.getByRole('link', { name: link2 })).toBeHidden();
    await expect(page.getByRole('link', { name: link3 })).toBeHidden();
    await expect(page.getByRole('link', { name: link4 })).toBeHidden();
});

When('I view the {string} section', async ({ page }, sectionName: string) => {
    await expect(page.getByRole('heading', { name: sectionName })).toBeVisible();
});

Then('I should see the final scores of past games', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible();
});

Then('the score input fields and {string} buttons should be completely hidden', async ({ page }, btnName: string) => {
    // Verify the input fields used for score entry are not rendered
    const scoreInputs = page.locator('input[type="number"]');
    await expect(scoreInputs).toHaveCount(0);

    // Verify the save button is not rendered
    await expect(page.getByRole('button', { name: btnName })).toBeHidden();
});

When('I view the main navigation Sidebar', async ({ page }) => {
    await expect(page.locator('aside')).toBeVisible();
});