Feature: Visual Role-Based Access Control
  As a restricted user (Coach or Parent)
  I want the UI to hide administrative controls
  So that I am not confused by actions I cannot perform

  Scenario: Coach Visual UI Restrictions in Sidebar
    Given I am logged into SquadLogic as a "Coach"
    When I view the main navigation Sidebar
    Then I should see links for "Dashboard", "Team Management", and "Practice Schedule"
    But I should NOT see links for "Data Import", "Settings", or "Compliance"

  Scenario: Score Entry Restrictions in League Standings
    Given I am logged into SquadLogic as a "Parent"
    And I navigate to the "League Standings" page
    When I view the "Recent Games" section
    Then I should see the final scores of past games
    But the score input fields and "Save" buttons should be completely hidden