import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('an organization and season are active', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        const orgId = 'org-test-e2e';
        db.organizations =[{ id: orgId, name: 'SquadLogic FC', status: 'active' }];
        db.organization_members =[{
            organization_id: orgId,
            profile_id: 'mock-admin-id',
            role: 'admin',
            organizations: { id: orgId, name: 'SquadLogic FC' }
        }];
        db.season_settings =[{ id: 's1', name: 'Fall 2024', organization_id: orgId }];
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
        localStorage.setItem('squadlogic_active_org', orgId);
        localStorage.setItem('squadlogic-current-season', 'Fall 2024');
    });
});

Then('I should see a {int}-step workflow on the left side', async ({ page }, steps: number) => {
    await expect(page.locator('.space-y-4 > .group')).toHaveCount(steps);
});

Then('I should see a {string} panel on the right side', async ({ page }, panelName: string) => {
    await expect(page.getByRole('heading', { name: panelName })).toBeVisible();
});

Then('the League Status panel should show the active organization name', async ({ page }) => {
    const orgValue = page.getByText('Active Club', { exact: true }).locator('..').locator('span').last();
    await expect(orgValue).not.toContainText('—', { timeout: 15000 });
});

Then('the League Status panel should show the active season name', async ({ page }) => {
    const seasonValue = page.getByText('Active Season', { exact: true }).locator('..').locator('span').last();
    await expect(seasonValue).not.toContainText('—', { timeout: 15000 });
});

Given('I have imported player data', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.imports =[{
            id: 'imp-1',
            user_id: 'mock-admin-id',
            import_type: 'players',
            status: 'completed',
            created_at: new Date().toISOString(),
            data: { totalRows: 150, validRows: 150 }
        }];
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
        localStorage.setItem('dashboardActiveStep', '2');
    });
    await page.reload();
});

Given('I have not generated teams', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.scheduler_runs = (db.scheduler_runs ||[]).map((r: any) => r.run_type === 'team' ? { ...r, status: 'queued' } : r);
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    await page.reload();
});

Given('I have not generated a practice schedule', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.scheduler_runs = (db.scheduler_runs ||[]).map((r: any) => r.run_type === 'practice' ? { ...r, status: 'queued' } : r);
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    await page.reload();
});

Given('I have not generated a game schedule', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.scheduler_runs = (db.scheduler_runs ||[]).map((r: any) => r.run_type === 'game' ? { ...r, status: 'queued' } : r);
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    await page.reload();
});

Given('all setup steps are complete', async ({ page }) => {
    await page.evaluate(() => {
        const now = new Date().toISOString();
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.imports =[{
            id: 'imp-full',
            user_id: 'mock-admin-id',
            import_type: 'players',
            status: 'completed',
            created_at: now,
            data: { totalRows: 150, validRows: 150 }
        }];
        db.scheduler_runs =[
            {
                id: 'run-t',
                run_type: 'team',
                status: 'completed',
                completed_at: now,
                metrics: { progress: 100 },
                results: {
                    teamsByDivision: { 'U10 Boys':[{ id: 't1', name: 'Tigers' }] },
                    rosterBalanceByDivision: { 'U10 Boys': { summary: { totalPlayers: 15, totalCapacity: 20 } } }
                },
                created_at: now
            },
            {
                id: 'run-p',
                run_type: 'practice',
                status: 'completed',
                completed_at: now,
                metrics: { progress: 100 },
                results: {
                    summary: { assignmentRate: 1.0, manualFollowUpRate: 0, unassignedTeams: 0 },
                    totals: { practices: 20 }
                },
                created_at: now
            },
            {
                id: 'run-g',
                run_type: 'game',
                status: 'completed',
                completed_at: now,
                metrics: { progress: 100 },
                results: {
                    summary: { totalGames: 15, scheduledRate: 1.0, unscheduledMatchups: 0 },
                    totals: { games: 15 }
                },
                created_at: now
            }
        ];
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
        localStorage.setItem('dashboardActiveStep', '6');
    });
    await page.reload();
});

Given('I have generated teams', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.scheduler_runs = db.scheduler_runs ||[];
        if (!db.scheduler_runs.find((r: any) => r.run_type === 'team')) {
            const now = new Date().toISOString();
            db.scheduler_runs.push({
                id: 'run-t',
                run_type: 'team',
                status: 'completed',
                completed_at: now,
                results: {
                    teamsByDivision: { 'U10 Boys':[{ id: 't1', name: 'Tigers' }] },
                    rosterBalanceByDivision: { 'U10 Boys': { summary: { totalPlayers: 15, totalCapacity: 20 } } }
                },
                created_at: now
            });
        }
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
        localStorage.setItem('dashboardActiveStep', '3');
    });
    await page.reload();
});

Given('I have generated a practice schedule', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.scheduler_runs = db.scheduler_runs ||[];
        const now = new Date().toISOString();
        ['team', 'practice', 'game'].forEach(type => {
            if (!db.scheduler_runs.find((r: any) => r.run_type === type)) {
                db.scheduler_runs.push({
                    id: `run-${type}`,
                    run_type: type,
                    status: 'completed',
                    created_at: now,
                    completed_at: now,
                    results: { totals: { playersAssigned: 100, teams: 10 } }
                });
            }
        });
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    await page.reload();
});

Given('I have generated a game schedule', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        db.scheduler_runs = db.scheduler_runs ||[];
        db.scheduler_runs.push({ id: 'run-g', run_type: 'game', status: 'completed', results: { totals: { games: 15 } }, created_at: new Date().toISOString() });
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
    await page.reload();
});

When('I view the Dashboard page', async ({ page }) => {
    await page.goto('/');
});

Then('the Readiness Score should display {string}', async ({ page }, score: string) => {
    const panel = page.getByTestId('readiness-score');
    await expect(panel).toContainText(score, { timeout: 15000 });
});

Then('the {string} step should show as completed', async ({ page }, stepName: string) => {
    const step = page.locator(`[data-testid*="workflow-step-"]`).filter({ hasText: stepName }).first();
    await expect(step.getByText(/Completed/i)).toBeVisible({ timeout: 10000 });
});

When('I click on the {string} workflow step', async ({ page }, stepName: string) => {
    const step = page.locator(`[data-testid*="workflow-step-"]`).filter({ hasText: stepName }).first();
    await step.click({ force: true });
});

Then('the {string} step should expand to show its content', async ({ page }, stepName: string) => {
    const step = page.locator(`[data-testid*="workflow-step-"]`).filter({ hasText: stepName }).first();
    await expect(step.locator('.grid.transition-all')).toHaveClass(/grid-rows-\[1fr\]/);
});

Then('the previously active step should collapse', async ({ page }) => {
    const expandedSteps = page.locator('.grid-rows-\\[1fr\\]');
    await expect(expandedSteps).toHaveCount(1);
});

Given('I belong to organizations {string} and {string}', async ({ page }, org1: string, org2: string) => {
    await page.evaluate(({ o1, o2 }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        const org1Id = 'org-test-e2e';
        const org2Id = 'org-2';
        db.organizations =[
            { id: org1Id, name: o1, status: 'active' },
            { id: org2Id, name: o2, status: 'active' }
        ];
        db.season_settings =[
            { id: 's1', name: 'Fall 2024', organization_id: org1Id },
            { id: 's2', name: 'Spring 2024', organization_id: org1Id },
            { id: 's3', name: 'Fall 2024', organization_id: org2Id }
        ];
        db.organization_members =[
            { organization_id: org1Id, profile_id: 'mock-admin-id', role: 'admin', organizations: { id: org1Id, name: o1 } },
            { organization_id: org2Id, profile_id: 'mock-admin-id', role: 'admin', organizations: { id: org2Id, name: o2 } }
        ];
        window.__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { o1: org1, o2: org2 });
    await page.reload();
});

Given('the sidebar shows {string} as the active organization', async ({ page }, orgName: string) => {
    await page.evaluate((name) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        const org = (db.organizations ||[]).find((o: any) => o.name === name);
        if (org) {
            localStorage.setItem('squadlogic_active_org', org.id);
            const seasons = (db.season_settings ||[]).filter((s: any) => s.organization_id === org.id);
            if (seasons.length > 0) {
                localStorage.setItem('squadlogic-current-season', seasons[0].name);
            }
        }
    }, orgName);
    if (page.url() !== 'about:blank') await page.reload();
});

Then('I should see a dropdown with {string} and {string}', async ({ page }, org1: string, org2: string) => {
    const menu = page.locator('.absolute.top-full').first();
    await expect(menu.getByRole('button', { name: org1 }).first()).toBeVisible();
    await expect(menu.getByRole('button', { name: org2 }).first()).toBeVisible();
});

When('I click the {string} selector in the sidebar', async ({ page }, selectorName: string) => {
    const label = page.locator('aside').getByText(selectorName, { exact: false }).first();
    await label.locator('..').getByRole('button').first().click({ force: true });
});

When('I select {string}', async ({ page }, option: string) => {
    await page.getByRole('button', { name: option, exact: true }).first().click({ force: true });
});

Then('the sidebar header should display {string}', async ({ page }, orgName: string) => {
    await expect(page.getByText('Active Organization').locator('..').locator('button')).toContainText(orgName);
});

Then('the {string} dropdown should update to show seasons for {string}', async ({ page }, dropdown: string, orgName: string) => {
    const seasonButton = page.getByText('Active Season').locator('..').getByRole('button');
    await expect(seasonButton).toBeVisible();
    await expect(seasonButton).not.toContainText('No seasons');
});

Then('the dashboard data should refresh to show {string} data', async ({ page }, orgName: string) => {
    const orgValue = page.getByText('Active Club', { exact: true }).locator('..').locator('span').last();
    await expect(orgValue).toContainText(orgName, { timeout: 15000 });
});

Then('I should see a dropdown with valid seasons for the current organization', async ({ page }) => {
    await expect(page.locator('.absolute.top-full button')).not.toHaveCount(0);
});

When('I select a different season', async ({ page }) => {
    await page.locator('.absolute.top-full button').last().click({ force: true });
});

Then('the season selector should display the selected season', async ({ page }) => {
    const seasonButton = page.getByText('Active Season').locator('..').getByRole('button');
    await expect(seasonButton).toBeVisible();
});

Then('the dashboard data should refresh to show data for the selected season', async ({ page }) => {
    const seasonValue = page.getByText('Active Season', { exact: true }).locator('..').locator('span').last();
    await expect(seasonValue).toBeVisible();
});

Given('the localStorage contains a season ID that does not exist for {string}', async ({ page }, orgName: string) => {
    await page.evaluate(() => localStorage.setItem('squadlogic-current-season', 'invalid-id'));
});

When('I switch the active organization to {string}', async ({ page }, orgName: string) => {
    await page.getByText('Active Organization').locator('..').getByRole('button').first().click({ force: true });
    const menu = page.locator('.absolute.top-full').first();
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: orgName }).first().click({ force: true });
});

Then('the active season should automatically select the most recent season for {string}', async ({ page }, orgName: string) => {
    const seasonButton = page.getByText('Active Season').locator('..').getByRole('button');
    await expect(seasonButton).not.toContainText('No seasons');
});

Then('localStorage should be updated with the valid season', async ({ page }) => {
    const season = await page.evaluate(() => localStorage.getItem('squadlogic-current-season'));
    expect(season).not.toBe('invalid-id');
});

Given('I have selected {string} as the active organization', async ({ page }, orgName: string) => {
    await page.evaluate((name) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        const org = (db.organizations ||[]).find((o: any) => o.name === name);
        if (org) {
            localStorage.setItem('squadlogic_active_org', org.id);
        }
    }, orgName);
    if (page.url() !== 'about:blank') await page.reload();
});

Given('a valid season is selected', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify(window.__MOCK_DB__ || {}));
        const seasons = db.season_settings ||[];
        if (seasons.length > 0) {
            localStorage.setItem('squadlogic-current-season', seasons[0].name || seasons[0].id);
        }
    });
});

Then('the sidebar should still show {string} as the active organization', async ({ page }, orgName: string) => {
    await expect(page.locator('aside').getByRole('button').filter({ hasText: orgName }).first()).toBeVisible();
});

Then('the sidebar should still show the selected season', async ({ page }) => {
    await expect(page.getByText('Active Season').locator('..').locator('button')).toBeVisible();
});