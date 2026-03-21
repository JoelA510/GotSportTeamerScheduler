Feature: Team Communication and Portal
  As a parent or coach
  I want a dedicated team portal
  So that I can view the schedule, RSVP for my children, and chat with the team

  Background:
    Given I am logged into SquadLogic as a "parent"
    And I have an organization labeled "Test Org"
    And my child "Alex" is on the "Tigers" team
    And my child "Jamie" is also on the "Tigers" team
    And I am on the "Team Portal" page for the "Tigers"

  Scenario: RSVPing for multiple children (Twins edge case)
    Given there is an upcoming practice on "Tuesday"
    When I click "Going" for "Alex" on the "Tuesday" practice
    And I click "Not Going" for "Jamie" on the "Tuesday" practice
    Then I should see "Alex" marked as "Going" on the "Tuesday" practice
    And I should see "Jamie" marked as "Not Going" on the "Tuesday" practice
    And the database should have two distinct RSVP records for this practice occurrence
    And the RSVP timestamps should align with the league's official timezone

  Scenario: Sending and receiving real-time chat messages
    When I type "Will we have snacks?" into the chat input
    And I send the messenger chat
    Then the message "Will we have snacks?" should appear in the team chat feed immediately
    And the message should be broadcasted via Supabase Realtime to other connected clients
