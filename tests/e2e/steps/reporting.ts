import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Then('I should see the {string} metric', async ({ page }, metricName: string) => {
  // Assert metric is visible
});

Then('a CSV file containing player and team data should be downloaded client-side', async ({ page }) => {
  // Assert download trigger
});

When('I input a score of {string} to {string} for a completed game', async ({ page }, scoreHome: string, scoreAway: string) => {
  // Input scores
});

Then('the {string} table should reflect a win for the home team', async ({ page }, tableName: string) => {
  // Assert standings
});

Then('the points and goal differential should update accordingly', async ({ page }) => {
  // Assert calculations
});
