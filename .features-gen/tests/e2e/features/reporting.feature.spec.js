// Generated from: tests\e2e\features\reporting.feature
import { test } from "playwright-bdd";

test.describe('Admin Reporting Dashboard', () => {

  test.beforeEach('Background', async ({ Given, And, page }, testInfo) => { if (testInfo.error) return;
    await Given('I have an organization labeled "Test Org"', null, { page }); 
    await And('there is an active season "Fall 2026"', null, { page }); 
  });
  
  test('Admin views the reporting dashboard key metrics', async ({ Given, Then, And, page }) => { 
    await Given('I am logged into SquadLogic as an "admin"', null, { page }); 
    await And('I navigate to the "Reporting Dashboard"', null, { page }); 
    await Then('I should see the "Total Players" metric', null, { page }); 
    await And('I should see the "Total Teams" metric', null, { page }); 
    await And('I should see the "Registrations" metric', null, { page }); 
  });

  test('Admin exports rosters to CSV', async ({ Given, When, Then, And, page }) => { 
    await Given('I am logged into SquadLogic as an "admin"', null, { page }); 
    await And('I navigate to the "Reporting Dashboard"', null, { page }); 
    await When('I click the "Export Rosters CSV" button', null, { page }); 
    await Then('a CSV file containing player and team data should be downloaded client-side', null, { page }); 
  });

  test('Coach enters a game score and standings update', async ({ Given, When, Then, And, page }) => { 
    await Given('I am logged into SquadLogic as a "coach"', null, { page }); 
    await And('I navigate to the "League Standings"', null, { page }); 
    await When('I input a score of "3" to "1" for a completed game', null, { page }); 
    await Then('the "League Standings" table should reflect a win for the home team', null, { page }); 
    await And('the points and goal differential should update accordingly', null, { page }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('tests\\e2e\\features\\reporting.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":11,"pickleLine":10,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":7,"keywordType":"Context","textWithKeyword":"Given I have an organization labeled \"Test Org\"","isBg":true,"stepMatchArguments":[{"group":{"start":31,"value":"\"Test Org\"","children":[{"start":32,"value":"Test Org","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":8,"keywordType":"Context","textWithKeyword":"And there is an active season \"Fall 2026\"","isBg":true,"stepMatchArguments":[{"group":{"start":26,"value":"\"Fall 2026\"","children":[{"start":27,"value":"Fall 2026","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":12,"gherkinStepLine":11,"keywordType":"Context","textWithKeyword":"Given I am logged into SquadLogic as an \"admin\"","stepMatchArguments":[{"group":{"start":34,"value":"\"admin\"","children":[{"start":35,"value":"admin","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":13,"gherkinStepLine":12,"keywordType":"Context","textWithKeyword":"And I navigate to the \"Reporting Dashboard\"","stepMatchArguments":[{"group":{"start":18,"value":"\"Reporting Dashboard\"","children":[{"start":19,"value":"Reporting Dashboard","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":14,"gherkinStepLine":13,"keywordType":"Outcome","textWithKeyword":"Then I should see the \"Total Players\" metric","stepMatchArguments":[{"group":{"start":17,"value":"\"Total Players\"","children":[{"start":18,"value":"Total Players","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":15,"gherkinStepLine":14,"keywordType":"Outcome","textWithKeyword":"And I should see the \"Total Teams\" metric","stepMatchArguments":[{"group":{"start":17,"value":"\"Total Teams\"","children":[{"start":18,"value":"Total Teams","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":16,"gherkinStepLine":15,"keywordType":"Outcome","textWithKeyword":"And I should see the \"Registrations\" metric","stepMatchArguments":[{"group":{"start":17,"value":"\"Registrations\"","children":[{"start":18,"value":"Registrations","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":19,"pickleLine":17,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":7,"keywordType":"Context","textWithKeyword":"Given I have an organization labeled \"Test Org\"","isBg":true,"stepMatchArguments":[{"group":{"start":31,"value":"\"Test Org\"","children":[{"start":32,"value":"Test Org","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":8,"keywordType":"Context","textWithKeyword":"And there is an active season \"Fall 2026\"","isBg":true,"stepMatchArguments":[{"group":{"start":26,"value":"\"Fall 2026\"","children":[{"start":27,"value":"Fall 2026","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":20,"gherkinStepLine":18,"keywordType":"Context","textWithKeyword":"Given I am logged into SquadLogic as an \"admin\"","stepMatchArguments":[{"group":{"start":34,"value":"\"admin\"","children":[{"start":35,"value":"admin","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":21,"gherkinStepLine":19,"keywordType":"Context","textWithKeyword":"And I navigate to the \"Reporting Dashboard\"","stepMatchArguments":[{"group":{"start":18,"value":"\"Reporting Dashboard\"","children":[{"start":19,"value":"Reporting Dashboard","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":22,"gherkinStepLine":20,"keywordType":"Action","textWithKeyword":"When I click the \"Export Rosters CSV\" button","stepMatchArguments":[{"group":{"start":12,"value":"\"Export Rosters CSV\"","children":[{"start":13,"value":"Export Rosters CSV","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":23,"gherkinStepLine":21,"keywordType":"Outcome","textWithKeyword":"Then a CSV file containing player and team data should be downloaded client-side","stepMatchArguments":[]}]},
  {"pwTestLine":26,"pickleLine":23,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":7,"keywordType":"Context","textWithKeyword":"Given I have an organization labeled \"Test Org\"","isBg":true,"stepMatchArguments":[{"group":{"start":31,"value":"\"Test Org\"","children":[{"start":32,"value":"Test Org","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":8,"keywordType":"Context","textWithKeyword":"And there is an active season \"Fall 2026\"","isBg":true,"stepMatchArguments":[{"group":{"start":26,"value":"\"Fall 2026\"","children":[{"start":27,"value":"Fall 2026","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":27,"gherkinStepLine":24,"keywordType":"Context","textWithKeyword":"Given I am logged into SquadLogic as a \"coach\"","stepMatchArguments":[{"group":{"start":33,"value":"\"coach\"","children":[{"start":34,"value":"coach","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":28,"gherkinStepLine":25,"keywordType":"Context","textWithKeyword":"And I navigate to the \"League Standings\"","stepMatchArguments":[{"group":{"start":18,"value":"\"League Standings\"","children":[{"start":19,"value":"League Standings","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":29,"gherkinStepLine":26,"keywordType":"Action","textWithKeyword":"When I input a score of \"3\" to \"1\" for a completed game","stepMatchArguments":[{"group":{"start":19,"value":"\"3\"","children":[{"start":20,"value":"3","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"},{"group":{"start":26,"value":"\"1\"","children":[{"start":27,"value":"1","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":30,"gherkinStepLine":27,"keywordType":"Outcome","textWithKeyword":"Then the \"League Standings\" table should reflect a win for the home team","stepMatchArguments":[{"group":{"start":4,"value":"\"League Standings\"","children":[{"start":5,"value":"League Standings","children":[{"children":[]}]},{"children":[{"children":[]}]}]},"parameterTypeName":"string"}]},{"pwStepLine":31,"gherkinStepLine":28,"keywordType":"Outcome","textWithKeyword":"And the points and goal differential should update accordingly","stepMatchArguments":[]}]},
]; // bdd-data-end