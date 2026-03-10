Feature: Pillar 1 - The Engine (Scheduling & Team Generation)
  As a league coordinator
  I want the scheduling engine to automatically assign teams and practices
  So that I can minimize manual effort and ensure fair allocations

  Background:
    Given a set of registered players and available field slots
    And coach availability and preference constraints are defined

  Scenario: Automated Team Generation
    Given there are 100 players in the U10 division
    And a target roster size of 10
    When I trigger the team generation algorithm
    Then 10 teams should be created
    And players should be balanced by skill level across teams
    And mutual buddy requests should be respected where possible

  Scenario: Practice Scheduling with Timezone Support
    Given multiple teams require weekly practice slots
    And a team is located in a specific timezone
    When the scheduler runs
    Then practice assignments should respect the local timezone offsets
    And no coach should be scheduled for two concurrent practices
    And no field slot should exceed its maximum capacity

  Scenario: Game Schedule Generation
    Given a list of teams in a division
    When I generate a round-robin game schedule
    Then every team should play every other team twice
    And games should be assigned to the highest priority field slots first
    And consecutive games for the same coach should be avoided if possible
