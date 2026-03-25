import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// ────────────────────────────────────────────────────────────
// Shared state for RBAC multi-tenancy scenarios
// ────────────────────────────────────────────────────────────
const rbacState: {
    orgs: Record<string, string>;           // "Org A" → orgId
    users: Record<string, { org: string; role: string; orgId: string }>;
} = { orgs: {}, users: {} };

/**
 * Background step: seed two organizations into the mock DB.
 * Each org gets a stable predictable ID so later steps can reference them.
 */
Given('the following organizations exist: {string}, {string}', async ({ page }, org1: string, org2: string) => {
    const orgId1 = 'rbac-org-a-' + Date.now();
    const orgId2 = 'rbac-org-b-' + Date.now();

    rbacState.orgs[org1] = orgId1;
    rbacState.orgs[org2] = orgId2;

    await page.goto('/');
    await page.evaluate(({ o1, id1, o2, id2 }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');

        db.organizations = db.organizations || [];
        db.organizations.push({ id: id1, name: o1, status: 'active' });
        db.organizations.push({ id: id2, name: o2, status: 'active' });

        // Seed teams scoped to each org so the Teams page has data to filter
        db.teams = db.teams || [];
        db.teams.push({ id: 'team-orgA-1', name: 'Org A Thunder', division: 'U10', organization_id: id1 });
        db.teams.push({ id: 'team-orgA-2', name: 'Org A Lightning', division: 'U10', organization_id: id1 });
        db.teams.push({ id: 'team-orgB-1', name: 'Org B Sharks', division: 'U10', organization_id: id2 });
        db.teams.push({ id: 'team-orgB-2', name: 'Org B Dolphins', division: 'U10', organization_id: id2 });

        // Seed season_settings for each org
        db.season_settings = db.season_settings || [];
        db.season_settings.push({ id: 'season-a', organization_id: id1, name: 'Fall 2026', status: 'active' });
        db.season_settings.push({ id: 'season-b', organization_id: id2, name: 'Fall 2026', status: 'active' });

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { o1: org1, id1: orgId1, o2: org2, id2: orgId2 });
});

/**
 * Background step: assign a named user to an organization with a specific role.
 * Seeds the organization_members entry in the mock DB.
 */
Given('{string} belongs to {string} with role {string}', async ({ page }, user: string, org: string, role: string) => {
    const orgId = rbacState.orgs[org];
    if (!orgId) throw new Error(`Organization "${org}" was not seeded in Background step`);

    const cleanRole = role.toLowerCase();
    const userId = `mock-${cleanRole}-${user.replace(/\s+/g, '-').toLowerCase()}`;

    rbacState.users[user] = { org, role: cleanRole, orgId };

    await page.evaluate(({ uId, oId, roleName, orgName, userName }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');

        db.organization_members = db.organization_members || [];
        db.organization_members.push({
            organization_id: oId,
            profile_id: uId,
            role: roleName,
            organizations: { id: oId, name: orgName },
        });

        db.profiles = db.profiles || [];
        db.profiles.push({ id: uId, full_name: userName, email: `${uId}@squadlogic.app` });

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { uId: userId, oId: orgId, roleName: cleanRole, orgName: org, userName: user });
});

// ────────────────────────────────────────────────────────────
// Scenario 1: Multi-Tenancy Data Isolation (RLS)
// ────────────────────────────────────────────────────────────

When('I request the list of teams, players, or schedules', async ({ page }) => {
    await page.goto('/teams');
    // Wait for the page to load and render team data
    await page.waitForLoadState('networkidle');
});

Then('I should only receive records associated with {string}', async ({ page }, org: string) => {
    const orgId = rbacState.orgs[org];
    if (!orgId) throw new Error(`Organization "${org}" was not seeded`);

    // The active org in localStorage should match the user's org
    const activeOrg = await page.evaluate(() => localStorage.getItem('squadlogic_active_org'));

    // Verify the page shows team data from the expected org
    // In mock mode, the mock DB filters by organization_id matching localStorage active org
    const pageContent = await page.textContent('body');

    // Teams from the user's org should be visible
    if (org === 'Org A') {
        // Coach Alice is in Org A — should see Org A teams
        const hasOrgAContent = pageContent?.includes('Org A') || pageContent?.includes('Thunder') || pageContent?.includes('Lightning');
        expect(hasOrgAContent, `Expected to see Org A team data on the page`).toBeTruthy();
    }
});

Then('any direct query for {string} records should return empty or unauthorized', async ({ page }, org: string) => {
    const orgId = rbacState.orgs[org];
    if (!orgId) throw new Error(`Organization "${org}" was not seeded`);

    // Verify that the OTHER org's teams are NOT visible on the page
    const pageContent = await page.textContent('body');

    if (org === 'Org B') {
        // Coach Alice should NOT see Org B team names
        const hasOrgBContent = pageContent?.includes('Sharks') || pageContent?.includes('Dolphins');
        expect(hasOrgBContent, `Expected Org B team data to be hidden, but found it on the page`).toBeFalsy();
    }
});

// ────────────────────────────────────────────────────────────
// Scenario 2: Route Protection via usePermission
// ────────────────────────────────────────────────────────────

When('I attempt to navigate to full Admin routes such as Data Import or Settings', async ({ page }) => {
    await page.goto('/settings');
    // Allow time for the redirect/warning to appear
    await page.waitForTimeout(1000);
});

// ────────────────────────────────────────────────────────────
// Scenario 3: Admin Access Verification
// ────────────────────────────────────────────────────────────

When('I navigate to the Admin routes', async ({ page }) => {
    await page.goto('/settings');
});

Then('I should successfully load the page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible({ timeout: 10000 });
});

Then('I should be able to view and manage data specifically for {string}', async ({ page }, org: string) => {
    const orgId = rbacState.orgs[org];

    // Verify localStorage points to the correct org
    const activeOrg = await page.evaluate(() => localStorage.getItem('squadlogic_active_org'));
    expect(activeOrg).toBe(orgId);

    // Verify the page header or sidebar reflects the active org
    const pageContent = await page.textContent('body');
    const containsOrgReference = pageContent?.includes(org) || pageContent?.includes(orgId);
    expect(containsOrgReference, `Expected the page to reference "${org}" data`).toBeTruthy();
});

// ────────────────────────────────────────────────────────────
// Field Management steps (shared with field_management_efficiency.feature)
// ────────────────────────────────────────────────────────────

Given('I am logged in as an administrator', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
        const session = {
            user: {
                id: 'mock-admin-id',
                email: 'admin@squadlogic.app',
                user_metadata: { full_name: 'Mock Admin' },
                app_metadata: { role: 'admin' }
            },
            access_token: 'mock-token',
        };
        sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify(session));
        localStorage.setItem('squadlogic_active_org', 'org-1');
    });
    await page.reload();
    await expect(page.getByRole('button', { name: /Sign Out/i })).toBeVisible({ timeout: 15000 });
});

Given('an organization has multiple fields configured', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';

        db.fields = db.fields || [];
        db.fields.push(
            { id: 'field-1', name: 'Main Field', location: 'Central Park', organization_id: orgId, is_active: true, surface: 'grass', size: 'full' },
            { id: 'field-2', name: 'Practice Field A', location: 'Central Park', organization_id: orgId, is_active: true, surface: 'turf', size: 'half' },
        );

        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
});

When('I view the {string} page', async ({ page }, pageName: string) => {
    await page.goto('/fields');
});

Then('each field card should display a visual 7-day grid', async ({ page }) => {
    await expect(page.locator('.grid.grid-cols-7').first()).toBeVisible();
});

Then('days with allocated time slots should be highlighted with the club\'s theme color', async ({ page }) => {
    const activeDay = page.locator('.bg-blue-500\\/10').first();
    await expect(activeDay).toBeVisible();
});
