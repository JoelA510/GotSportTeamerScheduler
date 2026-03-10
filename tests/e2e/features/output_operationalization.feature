Feature: Output Operationalization
  As a system administrator
  I want to export finalized schedules and rosters to Supabase Storage
  And generate draft email communications for coaches
  So that I can quickly operationalize the generated season data

  Background:
    Given I am configured as an Admin in the SquadLogic platform

  Scenario: Saving CSV exports to Supabase Storage
    When I click to export the team rosters or schedules
    Then the system should generate the CSV file
    And automatically upload a backup copy to the organization's Supabase Storage bucket
    And provide a secure download link or trigger an instant download

  Scenario: Generating coach welcome emails
    Given the team rosters have been generated and finalized
    When I access the communication tools
    Then I should be able to generate a batch of draft emails for all head coaches
    And each draft should include the coach's name, team name, and assigned practice schedule
