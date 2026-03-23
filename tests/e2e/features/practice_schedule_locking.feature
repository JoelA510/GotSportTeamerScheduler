Feature: Practice Schedule Locking

  As a League Administrator
  I want to lock specific practice assignments
  So that they are preserved when I re-run the automated scheduler

  Background:
    Given I am logged in as an administrator
    And a practice schedule has been generated

  Scenario: Locking a practice slot
    Given the automated schedule has been generated
    And I am on the Practice Scheduling page
    When I click the "Lock" icon on for "Team A"
    Then the assignment for "Team A" should show a "Locked" status
    And the lock state should be persisted to the database

  Scenario: Re-running scheduler with locked slots
    Given "Team A" has a locked practice assignment
    When I click "Run Scheduler"
    Then the assignment for "Team A" should remain unchanged
    And other unlocked assignments should be updated by the engine
