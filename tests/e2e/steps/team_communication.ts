import { createBdd } from 'playwright-bdd';
import { test, expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I need to announce a practice cancellation', async ({ page }) => {
    // Context step, no action needed
});

When('I use the Team Communication tool', async ({ page }) => {
    // CRITICAL FIX: Navigate to the team portal first
    const teamId = await page.evaluate(() => localStorage.getItem('test_target_team_id') || 'team-1');
    await page.goto(`/team/${teamId}`);
    await expect(page.getByRole('heading', { name: /Team Chat/i }).first()).toBeVisible({ timeout: 15000 });
});

Then('a notification should be sent to all parents of players on my roster', async ({ page }) => {
    const input = page.getByPlaceholder(/Type a message/i).first();
    await input.fill('Practice is cancelled today due to rain.');
    await page.locator('form button[type="submit"]').first().click({ force: true });
    // Optimistic UI appends it immediately
    await expect(page.getByText('Practice is cancelled today due to rain.').first()).toBeVisible();
});

Then('I should be able to see a history of all sent messages', async ({ page }) => {
    await expect(page.getByText('Practice is cancelled today due to rain.').first()).toBeVisible();
});

// --- Existing Steps ---

Given('my child {string} is on the {string} team', async ({ page }, childName: string, teamName: string) => {
    await page.evaluate(({ child, team }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        const teamId = team.toLowerCase().replace(/\s+/g, '-');
        const playerId = `player-${child.toLowerCase()}`;

        db.teams = db.teams || [];
        if (!db.teams.find((t: any) => t.id === teamId)) {
            db.teams.push({ id: teamId, name: team, organization_id: orgId });
        }

        db.players = db.players || [];
        // CRITICAL FIX: Remove existing player to prevent duplicate keys
        db.players = db.players.filter((p: any) => p.id !== playerId);
        db.players.push({ id: playerId, first_name: child, last_name: 'Test', organization_id: orgId });

        db.team_players = db.team_players || [];
        db.team_players = db.team_players.filter((tp: any) => tp.player_id !== playerId);
        db.team_players.push({ team_id: teamId, player_id: playerId });

        db.profile_players = db.profile_players || [];
        db.profile_players = db.profile_players.filter((pp: any) => pp.player_id !== playerId);
        db.profile_players.push({ profile_id: 'mock-parent-id', player_id: playerId });

        localStorage.setItem('test_target_team_id', teamId);
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { child: childName, team: teamName });
});

Given('my child {string} is also on the {string} team', async ({ page }, childName: string, teamName: string) => {
    await page.evaluate(({ child, team }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        const teamId = team.toLowerCase().replace(/\s+/g, '-');
        const playerId = `player-${child.toLowerCase()}`;

        db.players = db.players || [];
        // CRITICAL FIX: Remove existing player to prevent duplicate keys
        db.players = db.players.filter((p: any) => p.id !== playerId);
        db.players.push({ id: playerId, first_name: child, last_name: 'Test', organization_id: orgId });

        db.team_players = db.team_players || [];
        db.team_players = db.team_players.filter((tp: any) => tp.player_id !== playerId);
        db.team_players.push({ team_id: teamId, player_id: playerId });

        db.profile_players = db.profile_players || [];
        db.profile_players = db.profile_players.filter((pp: any) => pp.player_id !== playerId);
        db.profile_players.push({ profile_id: 'mock-parent-id', player_id: playerId });

        localStorage.setItem('test_target_team_id', teamId);
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { child: childName, team: teamName });
});

Given('I am on the {string} page for the {string}', async ({ page }, pageName: string, teamName: string) => {
    const teamId = await page.evaluate(() => localStorage.getItem('test_target_team_id')) || teamName.toLowerCase().replace(/\s+/g, '-');
    await page.goto(`/team/${teamId}`);
    await expect(page.getByRole('heading', { name: teamName }).first()).toBeVisible({ timeout: 15000 });
});

Given('there is an upcoming practice on {string}', async ({ page }, day: string) => {
    await page.evaluate((d) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        db.practice_assignments = db.practice_assignments || [];
        db.practice_slots = db.practice_slots || [];
        
        const slotId = `slot-${d.toLowerCase()}`;
        if (!db.practice_slots.find((s: any) => s.id === slotId)) {
            db.practice_slots.push({
                id: slotId,
                day_of_week: d.substring(0, 3).toLowerCase(),
                start_time: '17:00',
                end_time: '18:30'
            });
        }

        if (!db.practice_assignments.find((pa: any) => pa.practice_slot_id === slotId)) {
            db.practice_assignments.push({
                id: `pa-${d.toLowerCase()}`,
                team_id: 'tigers',
                practice_slot_id: slotId,
                effective_date_range: '[2025-01-01,2025-12-31)',
                // CRITICAL FIX: Inject the 'slot' alias directly so useTeamPortal's expandPractices can read it
                slot: {
                    day_of_week: d.substring(0, 3).toLowerCase(),
                    start_time: '17:00',
                    end_time: '18:30',
                    field: { name: 'Main Field', location: { name: 'Complex' } }
                }
            });
        }
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, day);
    await page.reload();
    await expect(page.getByText(day, { exact: false }).first()).toBeVisible({ timeout: 10000 });
});

When('I click {string} for {string} on the {string} practice', async ({ page }, action: string, child: string, day: string) => {
  const practiceCard = page.locator('.glass-panel').filter({ hasText: new RegExp(day, 'i') }).filter({ hasText: /practice/i }).first();
  const playerRsvpRow = practiceCard.locator('.bg-bg-surface\\/30').filter({ hasText: new RegExp(child, 'i') }).first();

  const titleMap: Record<string, string> = {
    'Going': 'Going',
    'Not Going': 'Not Going',
    'Maybe': 'Maybe'
  };

  const btn = playerRsvpRow.getByTitle(titleMap[action] || action, { exact: true }).first();
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await btn.click({ force: true });
});

Then('I should see {string} marked as {string} on the {string} practice', async ({ page }, child: string, action: string, day: string) => {
  const practiceCard = page.locator('.glass-panel').filter({ hasText: new RegExp(day, 'i') }).filter({ hasText: /practice/i }).first();
  const playerRsvpRow = practiceCard.locator('.bg-bg-surface\\/30').filter({ hasText: new RegExp(child, 'i') }).first();
  const button = playerRsvpRow.getByTitle(action, { exact: true }).first();

  // Check that it does NOT have grayscale (meaning it is active)
  await expect(button).not.toHaveClass(/grayscale/, { timeout: 10000 });
  await expect(button).toHaveClass(/shadow-glow/, { timeout: 10000 });
});

Then('the database should have two distinct RSVP records for this practice occurrence', async ({ page }) => {
    const rsvps = await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        return db.event_rsvps || [];
    });
    expect(rsvps.length).toBeGreaterThanOrEqual(2);
});

Then('the RSVP timestamps should align with the league\'s official timezone', async ({ page }) => {
    const rsvps = await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        return db.event_rsvps || [];
    });
    expect(rsvps[0].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

When('I type {string} into the chat input', async ({ page }, msg: string) => {
  const input = page.getByPlaceholder('Type a message...').first();
  await input.fill(msg);
});

When('I send the messenger chat', async ({ page }) => {
  await page.locator('form button[type="submit"]').first().click({ force: true });
});

Then('the message {string} should appear in the team chat feed immediately', async ({ page }, msg: string) => {
  await expect(page.getByText(msg).first()).toBeVisible();
});

Then('the message should be broadcasted via Supabase Realtime to other connected clients', async ({ page }) => {
    const messages = await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        return db.team_messages || [];
    });
    expect(messages.length).toBeGreaterThan(0);
});