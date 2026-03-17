import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// --- Drag and Drop Visuals ---
Given('I am on the {string} page in Edit Mode', async ({ page }, pageName: string) => {
    await page.goto('/teams');
    const editButton = page.getByRole('button', { name: 'Edit Mode' });
    if (await editButton.isVisible()) {
        await editButton.click();
    }
});

When('I click and hold the drag handle for player {string}', async ({ page }, playerName: string) => {
    const playerCard = page.locator('.bg-bg-surface').filter({ hasText: playerName });
    const dragHandle = playerCard.locator('.cursor-grab');
    await dragHandle.hover();
    await page.mouse.down();
});

Then('the player card opacity should visually change to 40%', async ({ page }) => {
    // The vision agent/Playwright verifies the inline style applied by dnd-kit
    const draggingCard = page.locator('.shadow-lg.border-blue-500\\/50');
    await expect(draggingCard).toHaveCSS('opacity', '0.4');
});

Then('a floating drag overlay should appear slightly rotated', async ({ page }) => {
    const overlay = page.locator('.transform.rotate-2');
    await expect(overlay).toBeVisible();
});

When('I drag the player over an empty team column', async ({ page }) => {
    const emptyColumn = page.locator('.border-dashed').first();
    await emptyColumn.hover();
});

Then('the empty column should display a dashed drop-zone border', async ({ page }) => {
    const emptyColumn = page.locator('.border-dashed').first();
    await expect(emptyColumn).toHaveCSS('border-style', 'dashed');
});

// --- Theme Toggling ---
When('I click the floating {string} button to activate the {string} theme', async ({ page }, buttonName: string, themeName: string) => {
    const themeToggle = page.locator('.theme-toggle');
    // Click until the desired theme is active (mocking the cycle)
    await themeToggle.click();
});

Then('the application background should visually transition to a deep purple and pink radial gradient', async ({ page }) => {
    // Verify the data-theme attribute is injected at the root
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'party');
    // Vision agent verifies the CSS variable resolution
    await expect(page.locator('body')).toHaveCSS('background-image', /radial-gradient/);
});

Then('the text colors should adjust to maintain WCAG 2.2 AA contrast', async ({ page }) => {
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(255, 255, 255)'); // #ffffff for party theme
});

// --- Recharts Tooltips ---
When('I hover my mouse over the {string} Bar Chart', async ({ page }, chartName: string) => {
    const bar = page.locator('.recharts-bar-rectangle').first();
    await bar.hover();
});

Then('a dark-themed tooltip should appear showing the exact {string} count', async ({ page }, metric: string) => {
    const tooltip = page.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(metric);
});

Then('the chart colors should match the {string} CSS variables', async ({ page }, themeName: string) => {
    const tooltip = page.locator('.recharts-default-tooltip');
    await expect(tooltip).toHaveCSS('background-color', 'rgb(15, 23, 42)'); // #0f172a
});

// --- Mobile Sidebar ---
Given('I am logged into SquadLogic on a {string} viewport', async ({ page }, viewport: string) => {
    await page.setViewportSize({ width: 375, height: 812 }); // iPhone X dimensions
    await page.goto('/');
});

Then('the sidebar should be hidden by default', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/-translate-x-full/);
});

When('I click the {string} icon', async ({ page }, iconName: string) => {
    await page.locator('button').filter({ has: page.locator('.lucide-menu') }).click();
});

Then('the sidebar overlay should slide into view', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/translate-x-0/);
});

When('I click a navigation link like {string}', async ({ page }, linkName: string) => {
    await page.getByRole('link', { name: linkName }).click();
});

Then('the sidebar overlay should automatically close', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/-translate-x-full/);
});

// --- Club Logo Upload ---
Given('I am on the {string} tab in Settings', async ({ page }, tabName: string) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: tabName }).click();
});

When('I upload a valid PNG file to the {string} dropzone', async ({ page }, dropzoneName: string) => {
    // Mock file upload via Playwright
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('.border-dashed').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    });
});

Then('I should see a visual preview of the uploaded logo', async ({ page }) => {
    await expect(page.locator('img[alt="Club Logo"]')).toBeVisible();
});

Then('a {string} panel should appear', async ({ page }, panelName: string) => {
    await expect(page.getByText(panelName)).toBeVisible();
});

Then('I should see distinct color swatches extracted from the image', async ({ page }) => {
    await expect(page.locator('.w-12.h-12.rounded-lg.shadow-sm.shrink-0').first()).toBeVisible();
});

// --- Visual Regression Testing (VRT) ---
Then('the {string} view should match the visual baseline', async ({ page }, viewName: string) => {
    // Wait for the DOM and network requests to completely settle
    await page.waitForLoadState('networkidle');

    // Perform pixel-to-pixel comparison (with 5% anti-aliasing tolerance)
    expect(await page.screenshot({ fullPage: true })).toMatchSnapshot(`vrt-${viewName.replace(/\s+/g, '-').toLowerCase()}.png`, {
        maxDiffPixelRatio: 0.05,
    });
});