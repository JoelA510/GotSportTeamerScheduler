import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then, Before } = createBdd();

Given('I navigate to the reporting dashboard', async ({ page }) => {
  await page.goto('/admin/reports');
  await page.waitForSelector('.text-4xl', { timeout: 10000 }); // Wait for metric cards
});

Before(async ({ page }) => {
  await page.addInitScript(() => {
    const db = (window as any).__MOCK_DB__ || {};
    const orgId = 'org-test-e2e';

    // Seed Organizations
    db.organizations = [{ id: orgId, name: 'Test Org' }];

    // Seed Organization Members
    db.organization_members = [
      { id: 'mem-admin', organization_id: orgId, profile_id: 'mock-admin-id', role: 'admin' },
      { id: 'mem-coach', organization_id: orgId, profile_id: 'mock-coach-id', role: 'coach' }
    ];

    // Seed Metrics View
    db.view_org_metrics = [{
      organization_id: orgId,
      total_players: 150,
      total_teams: 12,
      total_users: 25
    }];

    // Seed Compliance View
    db.view_compliance_stats = [{
      organization_id: orgId,
      form_title: 'Fall Registration',
      total_registrations: 45,
      medical_cleared: 38
    }];

    // Seed Standings View (Initial)
    db.view_league_standings = [
      {
        organization_id: orgId,
        team_id: 'team-home',
        team_name: 'Home Team',
        division: 'U10',
        wins: 1,
        losses: 1,
        draws: 0,
        games_played: 2,
        goals_for: 5,
        goals_against: 4,
        goal_differential: 1,
        points: 3
      },
      {
        organization_id: orgId,
        team_id: 'team-away',
        team_name: 'Away Team',
        division: 'U10',
        wins: 1,
        losses: 1,
        draws: 0,
        games_played: 2,
        goals_for: 4,
        goals_against: 5,
        goal_differential: -1,
        points: 3
      }
    ];

    // Seed Games for score entry
    db.games = [
      {
        id: 'game-1',
        organization_id: orgId,
        home_team_id: 'team-home',
        away_team_id: 'team-away',
        start_time: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        score_home: null,
        score_away: null
      }
    ];

    // Seed Teams for export
    db.teams = [
      { id: 't1', name: 'Eagles', division: 'U10', organization_id: orgId },
      { id: 't2', name: 'Hawks', division: 'U10', organization_id: orgId },
      { id: 'team-home', name: 'Home Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' },
      { id: 'team-away', name: 'Away Team', division: 'U10', organization_id: orgId, coach_id: 'mock-coach-id' }
    ];

    db.players = [
      { id: 'p1', first_name: 'John', last_name: 'Doe', team_id: 't1', organization_id: orgId },
      { id: 'p1', first_name: 'Bob', last_name: 'Builder', team_id: 'team-home', organization_id: orgId },
      { id: 'p2', first_name: 'Alice', last_name: 'Wonder', team_id: 'team-away', organization_id: orgId }
    ];

    db.profile_players = [
      { profile_id: 'mock-parent-id', player_id: 'player-1' }
    ];

    (window as any).__MOCK_DB__ = db;
    sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    localStorage.setItem('squadlogic_active_org', orgId);
  });

  if (page.url() === 'about:blank') await page.goto('/');
});

Then('I should see the {string} metric', async ({ page }, metricName: string) => {
  if (metricName.toLowerCase() === 'registrations') {
    // Registrations metric is represented by the Compliance chart or summary
    await expect(page.getByText(/Form Compliance Status/i)).toBeVisible();
    // In our seeded data, we have 45 total registrations
    await expect(page.getByText(/45/i).first()).toBeVisible();
  } else {
    // Use card border/bg class to narrow down to the metric card
    const normalizedName = metricName.replace('Total Teams', 'Active Teams');
    const card = page.locator('.bg-bg-surface').filter({ hasText: new RegExp(`^${normalizedName}$|${normalizedName}`, 'i') }).first();
    await expect(card).toBeVisible();
    
    const valSpan = card.locator('span.text-4xl');
    await expect(valSpan).toBeVisible();
    const val = await valSpan.textContent();
    expect(Number(val)).toBeGreaterThan(0);
  }
});

Then('a CSV file containing player and team data should be downloaded client-side', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Rosters CSV/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('squadlogic-rosters');
  expect(download.suggestedFilename()).toContain('.csv');
});

When('I input a score of {string} to {string} for a completed game', async ({ page }, scoreHome: string, scoreAway: string) => {
  // Find the game card
  const gameCard = page.locator('.bg-bg-app').filter({ hasText: /Home Team/i }).first();
  await gameCard.getByLabel('Home Score').fill(scoreHome);
  await gameCard.getByLabel('Away Score').fill(scoreAway);
  
  // Wait for the standings to refresh (handled by onChange and subsequent fetch in components)
  // Since we want to check updated standings, we MUST ensure the mock DB reflects the NEW state 
  // after the update. 
  await page.evaluate(({ sh, sa }) => {
     const db = window.__MOCK_DB__;
     // Update the standings view manually to simulate backend recalculation
     const home = db.view_league_standings.find(s => s.team_id === 'team-home');
     const away = db.view_league_standings.find(s => s.team_id === 'team-away');
     if (home && away) {
       home.wins += 1;
       home.games_played += 1;
       home.goals_for += Number(sh);
       home.goals_against += Number(sa);
       home.goal_differential += (Number(sh) - Number(sa));
       home.points += 3;

       away.losses += 1;
       away.games_played += 1;
       away.goals_for += Number(sa);
       away.goals_against += Number(sh);
       away.goal_differential += (Number(sa) - Number(sh));
     }
     sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
  }, { sh: scoreHome, sa: scoreAway });

  // We might need to wait for a refresh or click something if handleScoreUpdate is slow
  // But usually it re-fetches immediately.
  await page.waitForTimeout(1000); 
});

Then('the {string} table should reflect a win for the home team', async ({ page }, tableName: string) => {
  const row = page.getByRole('row').filter({ hasText: 'Home Team' });
  await expect(row.locator('td.text-status-success').first()).toHaveText('2'); // Wins was 1, now 2
});

Then('the points and goal differential should update accordingly', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'Home Team' });
  // Initial points was 3, +3 for win = 6
  await expect(row.locator('td.text-color-primary').last()).toHaveText('6');
  // Initial GD was +1, game score 3-1 (+2), new GD = +3
  await expect(row.getByText('+3')).toBeVisible();
});
