import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I am using a {string} viewport', async ({ page }, viewport: string) => {
  if (viewport === 'Mobile') {
    await page.setViewportSize({ width: 375, height: 667 });
  } else {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

Then('the sidebar should be hidden by default', async ({ page }) => {
  const sidebar = page.locator('aside').first();
  const isMobile = await page.evaluate(() => window.innerWidth < 768);
  if (isMobile) {
    const box = await sidebar.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(5);
  } else {
    await expect(sidebar).toBeVisible();
  }
});

When('I reset error flags and click {string}', async ({ page }, buttonName: string) => {
  await page.evaluate(() => {
    localStorage.removeItem('__FORCE_ERROR__');
    window.__FORCE_ERROR__ = false;
  });
  await page.getByRole('button', { name: buttonName }).first().click({ force: true });
});

Then('the sidebar overlay should slide into view', async ({ page }) => {
  const sidebar = page.locator('aside').first();
  await expect(sidebar).toBeVisible();
  await page.waitForTimeout(500);
  const box = await sidebar.boundingBox();
  expect(box?.x).toBe(0);
});

When('I click the "Hamburger Menu" icon', async ({ page }) => {
  await page.getByRole('button', { name: 'Hamburger Menu' }).first().click({ force: true });
});

When('I click a navigation link like {string}', async ({ page }, linkName: string) => {
  await page.getByRole('link', { name: linkName }).first().click({ force: true });
});

Then('the sidebar overlay should automatically close', async ({ page }) => {
  const sidebar = page.locator('aside').first();
  await expect(sidebar).not.toBeInViewport();
});

When('a React component throws an unexpected rendering error', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('__FORCE_ERROR__', 'true');
  });
  await page.reload();
});

Then('the application should not show a blank white screen', async ({ page }) => {
  await expect(page.locator('body').first()).not.toBeEmpty();
});

Then('I should see the {string} glassmorphism error panel', async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
});

Then('I should be safely redirected to the Dashboard', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Season Setup Workflow' }).first()).toBeVisible();
});
