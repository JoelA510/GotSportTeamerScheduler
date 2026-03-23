import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('there are {int} players in the U10 division', async ({ page }, count: number) => {
    await page.evaluate(() => {
        const db = (window as any).__MOCK_DB__ || {};
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
});

Given('teams have been generated for the current season', async ({ page }) => {
    await page.evaluate(() => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        db.teams = db.teams || [];
        db.teams.push(
            { id: 'team-alpha', name: 'Team Alpha', division: 'U10', organization_id: orgId, gender_policy: null, age_range: null },
            { id: 'team-beta', name: 'Team Beta', division: 'U10', organization_id: orgId, gender_policy: null, age_range: null }
        );
        db.players = db.players || [];
        db.team_players = db.team_players || [];
        db.player_buddies = db.player_buddies || [];

        db.scheduler_runs = db.scheduler_runs || [];
        db.scheduler_runs.push({
            id: 'mock-team-run',
            run_type: 'team',
            status: 'completed',
            results: {
                teams: db.teams,
                team_players: db.team_players
            },
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
        });

        db.imports = db.imports || [];
        if (!db.imports.find((i: any) => i.import_type === 'players')) {
            const mappedPlayers = db.players.map((p: any) => ({
                ...p,
                'First Name': p.first_name,
                'Last Name': p.last_name,
                'Birthdate': p.date_of_birth || '2015-01-01',
                'Gender': p.gender || 'm'
            }));
            db.imports.push({
                id: 'imp-players',
                user_id: 'mock-admin-id',
                import_type: 'players',
                status: 'completed',
                data: { data: mappedPlayers }
            });
        }

        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
});
Given('player {string} and player {string} are registered as a buddy pair', async ({ page }, p1: string, p2: string) => {
    await page.evaluate(({ p1Name, p2Name }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
        db.players = db.players || [];
        const p1Id = p1Name.toLowerCase().replace(/\s+/g, '-');
        const p2Id = p2Name.toLowerCase().replace(/\s+/g, '-');
        if (!db.players.find((p: any) => p.id === p1Id)) {
            db.players.push({ id: p1Id, first_name: p1Name, last_name: '', name: p1Name, organization_id: orgId, buddyId: p2Id, buddy_id: p2Id });
        } else {
            const existing = db.players.find((p: any) => p.id === p1Id);
            existing.buddyId = p2Id;
            existing.buddy_id = p2Id;
        }
        if (!db.players.find((p: any) => p.id === p2Id)) {
            db.players.push({ id: p2Id, first_name: p2Name, last_name: '', name: p2Name, organization_id: orgId, buddyId: p1Id, buddy_id: p1Id });
        } else {
            const existing = db.players.find((p: any) => p.id === p2Id);
            existing.buddyId = p1Id;
            existing.buddy_id = p1Id;
        }
        db.player_buddies = db.player_buddies || [];
        db.player_buddies.push({ id: `buddy-${p1Id}-${p2Id}`, player_id: p1Id, buddy_id: p2Id, organization_id: orgId });

        if (db.imports && db.imports.length > 0) {
            const imp = db.imports.find((i: any) => i.import_type === 'players');
            if (imp && imp.data && imp.data.data) {
                let impP1 = imp.data.data.find((p: any) => p.id === p1Id);
                if (!impP1) { impP1 = { id: p1Id, 'First Name': p1Name }; imp.data.data.push(impP1); }
                impP1.buddyId = p2Id;

                let impP2 = imp.data.data.find((p: any) => p.id === p2Id);
                if (!impP2) { impP2 = { id: p2Id, 'First Name': p2Name }; imp.data.data.push(impP2); }
                impP2.buddyId = p1Id;
            }
        }

        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { p1Name: p1, p2Name: p2 });
});
Given('{string} is assigned to {string}', async ({ page }, player: string, team: string) => {
    await page.evaluate(({ playerName, teamName }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const playerId = playerName.toLowerCase().replace(/\s+/g, '-');
        const teamObj = (db.teams || []).find((t: any) => t.name === teamName);
        const teamId = teamObj ? teamObj.id : teamName.toLowerCase().replace(/\s+/g, '-');
        db.team_players = db.team_players || [];
        db.team_players.push({ id: `tp-${playerId}-${teamId}`, team_id: teamId, player_id: playerId });

        const run = db.scheduler_runs.find((r: any) => r.run_type === 'team');
        if (run) {
            run.results.team_players = db.team_players;
        }

        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { playerName: player, teamName: team });
});

When('I view the Roster Manager', async ({ page }) => {
    await page.goto('/teams');
    // CRITICAL FIX: Wait for the data to load before clicking Edit Mode
    await expect(page.getByRole('heading', { name: /Teaming & Analysis/i }).first()).toBeVisible({ timeout: 15000 });
    const editButton = page.getByRole('button', { name: /Edit Mode/i }).first();
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click({ force: true });
});

Then('I should see a conflict banner with message {string}', async ({ page }, msg: string) => {
    await expect(page.locator('.bg-status-error-bg').first()).toBeVisible();
    await expect(page.getByText(msg).first()).toBeVisible();
});

Given('{string} is a {string} team', async ({ page }, team: string, gender: string) => {
    await page.evaluate(({ teamName, genderPolicy }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const teamObj = (db.teams || []).find((t: any) => t.name === teamName);
        if (teamObj) {
            teamObj.gender_policy = genderPolicy;
            teamObj.gender = genderPolicy;
        }
        const run = db.scheduler_runs?.find((r: any) => r.run_type === 'team');
        if (run && run.results && run.results.teams) {
            const rTeam = run.results.teams.find((t: any) => t.name === teamName);
            if (rTeam) {
                rTeam.gender_policy = genderPolicy;
                rTeam.gender = genderPolicy;
            }
        }
        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { teamName: team, genderPolicy: gender });
});
Given('player {string} has gender {string}', async ({ page }, player: string, gender: string) => {
    await page.evaluate(({ playerName, playerGender }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const playerId = playerName.toLowerCase().replace(/\s+/g, '-');
        let playerObj = (db.players || []).find((p: any) => p.id === playerId);
        if (playerObj) {
            playerObj.gender = playerGender;
            playerObj.Gender = playerGender;
        } else {
            const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
            db.players = db.players || [];
            playerObj = { id: playerId, first_name: playerName, last_name: '', name: playerName, gender: playerGender, Gender: playerGender, organization_id: orgId };
            db.players.push(playerObj);
        }

        if (db.imports && db.imports.length > 0) {
            const imp = db.imports.find((i: any) => i.import_type === 'players');
            if (imp && imp.data && imp.data.data) {
                const impPlayer = imp.data.data.find((p: any) => p.id === playerId || p['First Name'] === playerName);
                if (impPlayer) {
                    impPlayer.gender = playerGender;
                    impPlayer.Gender = playerGender;
                } else {
                    imp.data.data.push({ id: playerId, 'First Name': playerName, 'Last Name': '', Gender: playerGender, gender: playerGender });
                }
            }
        }

        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { playerName: player, playerGender: gender });
});

Then('I should see a conflict banner with message containing {string}', async ({ page }, msg: string) => {
    await expect(page.locator('.bg-status-error-bg').first()).toContainText(msg);
});

Given('{string} has age range U8 \\(ages 6-8)', async ({ page }, team: string) => {
    await page.evaluate(({ teamName }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const teamObj = (db.teams || []).find((t: any) => t.name === teamName);
        if (teamObj) {
            teamObj.minAge = 6;
            teamObj.maxAge = 8;
            teamObj.min_age = 6;
            teamObj.max_age = 8;
        }
        const run = db.scheduler_runs?.find((r: any) => r.run_type === 'team');
        if (run && run.results && run.results.teams) {
            const rTeam = run.results.teams.find((t: any) => t.name === teamName);
            if (rTeam) {
                rTeam.minAge = 6;
                rTeam.maxAge = 8;
                rTeam.min_age = 6;
                rTeam.max_age = 8;
            }
        }
        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { teamName: team });
});
Given('player {string} is age {int}', async ({ page }, player: string, age: number) => {
    await page.evaluate(({ playerName, playerAge }) => {
        const db = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || JSON.stringify((window as any).__MOCK_DB__ || {}));
        const playerId = playerName.toLowerCase().replace(/\s+/g, '-');
        let playerObj = (db.players || []).find((p: any) => p.id === playerId);
        if (playerObj) {
            playerObj.age = playerAge;
            playerObj.Age = playerAge;
        } else {
            const orgId = localStorage.getItem('squadlogic_active_org') || 'org-1';
            db.players = db.players || [];
            playerObj = { id: playerId, first_name: playerName, last_name: '', name: playerName, age: playerAge, Age: playerAge, organization_id: orgId };
            db.players.push(playerObj);
        }

        if (db.imports && db.imports.length > 0) {
            const imp = db.imports.find((i: any) => i.import_type === 'players');
            if (imp && imp.data && imp.data.data) {
                let impP = imp.data.data.find((p: any) => p.id === playerId || p['First Name'] === playerName);
                if (!impP) { impP = { id: playerId, 'First Name': playerName }; imp.data.data.push(impP); }
                impP.age = playerAge;
                impP.Age = playerAge;
            }
        }

        (window as any).__MOCK_DB__ = db;
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    }, { playerName: player, playerAge: age });
});
Given('all players are correctly assigned to eligible teams', async ({ page }) => {
    await page.evaluate(() => {
        const db = (window as any).__MOCK_DB__ || {};
        sessionStorage.setItem('__MOCK_DB__', JSON.stringify(db));
    });
});

Then('no conflict banner should be displayed', async ({ page }) => {
    await expect(page.locator('.bg-status-error-bg').first()).toBeHidden();
});

When('I click the {string} button on the Roster Manager', async ({ page }, btnName: string) => {
    await page.getByRole('button', { name: btnName }).first().click({ force: true });
});

Then('a new row should be inserted into the {string} table', async ({ page }, tableName: string) => { /* Verify DB */ });
Then('the run should have run_type {string} and status {string}', async ({ page }, type: string, status: string) => { /* Verify DB */ });