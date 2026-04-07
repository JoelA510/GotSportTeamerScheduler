Feature: Intelligent Auto-Scheduler
  As a League Administrator
  I want an auto-generate button that optimizes practice assignments
  So that I can achieve the fairest possible schedule with minimal manual effort

  Background:
    Given I am logged into SquadLogic as an "Admin"
    And an organization and season are active

  Scenario: Auto-Scheduler panel is visible on Practice Scheduling page
    When I navigate to the Practice Scheduling page
    Then I should see the "Intelligent Auto-Scheduler" panel
    And I should see an "Auto-Generate" button
    And the Auto-Generate button should be enabled

  Scenario: Auto-Scheduler panel shows progress during optimization
    Given I have imported player data
    And I have generated teams
    And I have generated a practice schedule
    When I navigate to the Practice Scheduling page
    And I click the "Auto-Generate" button
    Then I should see an optimization progress indicator
    And the progress indicator should show iteration count
    And the progress indicator should show a best score percentage
    And the Auto-Generate button should be disabled during optimization

  Scenario: Auto-Scheduler shows results on completion
    Given I have imported player data
    And I have generated teams
    And I have generated a practice schedule
    When I navigate to the Practice Scheduling page
    And I click the "Auto-Generate" button
    And the auto-scheduler completes
    Then I should see "Optimization Complete" in the auto-scheduler panel
    And I should see the number of assigned teams
    And I should see the optimization score
    And I should see a "Reset" button

  Scenario: Auto-Scheduler displays error on failure
    Given I have imported player data
    And the auto-scheduler service is unavailable
    When I navigate to the Practice Scheduling page
    And I click the "Auto-Generate" button
    Then I should see an error message in the auto-scheduler panel

  Scenario: Auto-Scheduler respects locked assignments
    Given I have imported player data
    And I have generated teams
    And I have generated a practice schedule
    And team "T1" has a locked assignment to slot "s1"
    When I navigate to the Practice Scheduling page
    And I click the "Auto-Generate" button
    And the auto-scheduler completes
    Then team "T1" should remain assigned to slot "s1"
    And team "T1" assignment should have source "locked"

  Scenario: Auto-Scheduler panel is accessible via keyboard
    When I navigate to the Practice Scheduling page
    Then the "Auto-Generate" button should be keyboard focusable
    And the "Auto-Generate" button should have an accessible label
    And the auto-scheduler panel should use proper ARIA landmarks
