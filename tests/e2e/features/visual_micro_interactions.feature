Feature: App Shell Visuals and Responsiveness
  As a user on various devices
  I want the application shell to adapt to my screen and preferences
  So that I can navigate easily and recover from errors

  Scenario: Mobile Sidebar Navigation
    Given I am logged into SquadLogic as "admin"
    And I am using a "Mobile" viewport
    When I view the Dashboard
    Then the sidebar should be hidden by default
    When I click the "Hamburger Menu" icon
    Then the sidebar overlay should slide into view
    When I click a navigation link like "Team Management"
    Then the sidebar overlay should automatically close

  Scenario: Global Theme Toggling
    Given I am logged into SquadLogic as "admin"
    When I click the floating "Theme Toggle" button
    Then the application background and panel styles should change to the "Light" theme
    When I click the toggle again
    Then the application should cycle to the "Party" theme with vibrant gradients

  Scenario: Global Error Boundary Fallback
    Given I am logged into SquadLogic as "admin"
    And I navigate to the Dashboard
    When a React component throws an unexpected rendering error
    Then the application should not show a blank white screen
    And I should see the "Something went wrong" glassmorphism error panel
    And I reset error flags and click "Return Home"
    Then I should be safely redirected to the Dashboard