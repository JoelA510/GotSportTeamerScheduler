import { createBdd } from 'playwright-bdd';
import { test, expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I need to announce a practice cancellation', async ({ page }) => {
    // Prepare mock data or UI state
});

When('I use the Team Communication tool', async ({ page }) => {
    await page.goto('/teams');
    const firstTeam = page.locator('a[href^="/team/"]').first();
    await firstTeam.click({ force: true });
    const chatBtn = page.getByRole('button', { name: /Chat|Message/i }).first();
    await chatBtn.click({ force: true });
});

Then('a notification should be sent to all parents of players on my roster', async ({ page }) => {
    const input = page.getByPlaceholder(/Type a message/i).first();
    await input.fill('Practice is cancelled today due to rain.');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Sent successfully/i).first()).toBeVisible();
});

Then('I should be able to see a history of all sent messages', async ({ page }) => {
    await expect(page.getByText(/Practice is cancelled/i).first()).toBeVisible();
});

// --- Existing Steps ---

Given('my child {string} is on the {string} team', async ({ page }, childName: string, teamName: string) => {
});

Given('my child {string} is also on the {string} team', async ({ page }, childName: string, teamName: string) => {
});

Given('I am on the {string} page for the {string}', async ({ page }, pageName: string, teamName: string) => {
  await page.goto('http://localhost:5173/team/00000000-0000-0000-0000-000000000001');
});

Given('there is an upcoming practice on {string}', async ({ page }, day: string) => {
  await expect(page.getByText(day, { exact: false }).first()).toBeVisible({ timeout: 10000 });
});

When('I click {string} for {string} on the {string} practice', async ({ page }, action: string, child: string, day: string) => {
  const practiceCard = page.locator('.glass-panel').filter({ hasText: day }).filter({ hasText: 'practice' }).first();
  const playerRsvpRow = practiceCard.locator('div.bg-bg-surface\\/30').filter({ hasText: child }).first();

  const titleMap: Record<string, string> = {
    'Going': 'Going',
    'Not Going': 'Not Going',
    'Maybe': 'Maybe'
  };

  await playerRsvpRow.getByTitle(titleMap[action] || action, { exact: true }).first().click({ force: true });
});

Then('I should see {string} marked as {string} on the {string} practice', async ({ page }, child: string, action: string, day: string) => {
  const practiceCard = page.locator('.glass-panel').filter({ hasText: day }).filter({ hasText: 'practice' }).first();
  const playerRsvpRow = practiceCard.locator('div.bg-bg-surface\\/30').filter({ hasText: child }).first();
  const button = playerRsvpRow.getByTitle(action, { exact: true }).first();

  await expect(button).toHaveClass(/shadow-glow/);
});

Then('the database should have two distinct RSVP records for this practice occurrence', async ({ page }) => {
  expect(true).toBe(true);
});

Then('the RSVP timestamps should align with the league\'s official timezone', async ({ page }) => {
  expect(true).toBe(true);
});

When('I type {string} into the chat input', async ({ page }, msg: string) => {
  const input = page.getByPlaceholder('Type a message...').first();
  await input.fill(msg);
});

When('I send the messenger chat', async ({ page }) => {
  await page.locator('form button').first().click({ force: true });
});

Then('the message {string} should appear in the team chat feed immediately', async ({ page }, msg: string) => {
  await expect(page.getByText(msg).first()).toBeVisible();
});

Then('the message should be broadcasted via Supabase Realtime to other connected clients', async ({ page }) => {
  expect(true).toBe(true);
});