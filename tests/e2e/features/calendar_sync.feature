Feature: Calendar Sync
  As a parent or coach
  I want a unique calendar subscription link
  So that I can sync my team's events to my personal calendar

  Background:
    Given I am logged into SquadLogic as a "parent"
    And I have an organization labeled "Test Org"
    And my child "Alex" is on the "Tigers" team
    And I am on the "Team Portal" page for the "Tigers"
    
  Scenario: Copying the Calendar Sync Link
    When I click the "Subscribe to Calendar" button
    Then a modal should appear displaying a subscription link
    And the link should contain "calendar-feed"
    And the link should contain a secure "token" query parameter
    And I should be able to click a button to copy the link to my clipboard
