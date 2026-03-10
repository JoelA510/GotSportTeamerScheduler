Feature: Roster Conflict Detection
  As a League Administrator
  I want to see real-time conflict warnings when roster assignments violate rules
  So that I can fix buddy separations and age/gender mismatches before finalizing

  Background:
    Given I am logged into SquadLogic as an "Admin"
    And teams have been generated for the current season

  Scenario: Detecting a buddy pair separation
    Given player "Alice" and player "Bob" are registered as a buddy pair
    And "Alice" is assigned to "Team Alpha"
    And "Bob" is assigned to "Team Beta"
    When I view the Roster Manager
    Then I should see a conflict banner with message "Buddy pair separated: Alice & Bob"

  Scenario: Detecting a gender mismatch
    Given "Team Alpha" is a "Boys" team
    And player "Sara" has gender "Girls"
    When "Sara" is assigned to "Team Alpha"
    Then I should see a conflict banner with message containing "Gender mismatch"

  Scenario: Detecting an age mismatch
    Given "Team Alpha" has age range U8 (ages 6-8)
    And player "Jake" is age 11
    When "Jake" is assigned to "Team Alpha"
    Then I should see a conflict banner with message containing "Age mismatch"

  Scenario: No conflicts shows no banner
    Given all players are correctly assigned to eligible teams
    When I view the Roster Manager
    Then no conflict banner should be displayed

  Scenario: Quick Draft invokes backend team generation
    When I click the "Quick Draft" button on the Roster Manager
    Then a new row should be inserted into the "scheduler_runs" table
    And the run should have run_type "team" and status "running"
