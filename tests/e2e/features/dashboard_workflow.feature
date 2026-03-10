Feature: Dashboard Workflow and Readiness Score
  As a League Administrator
  I want a structured workflow dashboard with a readiness score
  So that I can track my season setup progress at a glance

  Background:
    Given I am logged into SquadLogic as an "Admin"
    And an organization and season are active

  Scenario: Viewing the workflow dashboard layout
    When I navigate to the Dashboard page
    Then I should see a 5-step workflow on the left side
    And I should see a "League Status" panel on the right side
    And the League Status panel should show the active organization name
    And the League Status panel should show the active season name

  Scenario: Readiness score reflects data import completion
    Given I have imported player data
    But I have not generated teams
    And I have not generated a practice schedule
    And I have not generated a game schedule
    When I view the Dashboard page
    Then the Readiness Score should display "25%"
    And the "Data Import" step should show as completed

  Scenario: Readiness score reflects all steps completed
    Given I have imported player data
    And I have generated teams
    And I have generated a practice schedule
    And I have generated a game schedule
    When I view the Dashboard page
    Then the Readiness Score should display "100%"

  Scenario: Clicking a workflow step expands its content
    When I navigate to the Dashboard page
    And I click on the "Team Generation" workflow step
    Then the "Team Generation" step should expand to show its content
    And the previously active step should collapse
