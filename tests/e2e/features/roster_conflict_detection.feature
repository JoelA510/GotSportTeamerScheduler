Feature: Roster Conflict Detection
  As a League Administrator
  I want to see real-time conflict warnings when roster assignments violate rules
  So that I can fix buddy separations and age/gender mismatches before finalizing

  Background:
    Given I am logged into SquadLogic as an "Admin"
    And teams have been generated for the current season

  Scenario: No conflicts shows no banner
    Given all players are correctly assigned to eligible teams
    When I view the Roster Manager
    Then no conflict banner should be displayed

  Scenario: Buddy pair separation
    Given a buddy pair "Alice" and "Bob" are in the same division
    When I view the Roster Manager
    Then I should see a conflict banner with message "Buddy pair separated: Alice & Bob"

  Scenario: Gender mismatch
    Given a player "Sara" is assigned to a "Boys" team
    When I view the Roster Manager
    Then I should see a conflict banner with message containing "Gender mismatch"

  Scenario: Age mismatch
    Given a player "Jake" of age 11 is assigned to a "U8" team
    When I view the Roster Manager
    Then I should see a conflict banner with message containing "Age mismatch"

  Scenario: Quick Draft
    Given there are 20 players in the "U10" division
    When I view the Roster Manager
    And I click the "Quick Draft" button on the Roster Manager
    Then a new row should be inserted into the "team_players" table
    And the run should have run_type "team" and status "completed"
