Feature: Field Management Visibility

  As a League Administrator
  I want to see a visual 7-day grid for each field
  So that I can quickly understand field utilization and availability

  Background:
    Given I am logged in as an administrator
    And an organization has multiple fields configured

  Scenario: Viewing field weekly schedule
    When I view the "Field Management" page
    Then each field card should display a visual 7-day grid
    And days with allocated time slots should be highlighted with the club's theme color
