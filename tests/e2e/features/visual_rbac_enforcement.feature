Feature: Visual Role-Based Access Control Enforcement
  As a restricted user (Coach or Parent)
  I want the UI to completely hide administrative controls
  So that I am not confused by actions I cannot perform and security is visually maintained

  Scenario: Coach Visual UI Restrictions in Sidebar
    Given I am logged into SquadLogic as a "Coach"
    When I view the main navigation Sidebar
    Then I should visually see links for "Dashboard", "Team Management", and "Practice Schedule"
    But the "Data Import", "Settings", "Compliance", and "Reports" links should be completely absent from the UI

  Scenario: Score Entry Restrictions in League Standings
    Given I am logged into SquadLogic as a "Parent"
    And I navigate to the "League Standings" page
    When I view the "Recent Games" section
    Then I should see the final scores of past games
    But the score input fields and "Save" buttons should be completely hidden