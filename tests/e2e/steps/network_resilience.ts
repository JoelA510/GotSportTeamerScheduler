import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('the user has modified the {string} roster', async ({ page }, teamName: string) => {
    // Simulate an optimistic UI update
    await page.getByTestId(`edit-roster-${teamName.replace(/\s+/g, '-').toLowerCase()}`).click();
    await page.getByTestId('add-player-override-button').click();
});

When('the application attempts to sync the changes', async ({ page }) => {
    await page.getByRole('button', { name: 'Save Changes' }).click();
});

When('the network connection drops or the API returns a 504 Timeout', async ({ page }) => {
    // Playwright Network Interception: Force the edge function to fail
    await page.route('**/functions/v1/team-persistence', route => route.abort('failed'));
});

Then('the user should see a {string} banner', async ({ page }, expectedBanner: string) => {
    const banner = page.getByText(expectedBanner);
    await expect(banner).toBeVisible();
});

Then('the {string} card should remain in its newly modified state locally', async ({ page }, teamName: string) => {
    // Verify optimistic UI holds state despite API failure
    const teamCard = page.getByTestId(`team-card-${teamName.replace(/\s+/g, '-').toLowerCase()}`);
    await expect(teamCard).toBeVisible();
    await expect(teamCard).toHaveAttribute('data-sync-state', 'error-retained');
});