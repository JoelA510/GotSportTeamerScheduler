Feature: Registration and Compliance
  As a parent
  I want to register my child for a season and sign waivers
  So that they are cleared to play

  As an admin
  I want to create registration forms and track compliance
  So that I know who has signed waivers

  Background:
    Given I have an organization labeled "Test Org"
    And there is an active season "Fall 2026"

  Scenario: Admin creates a registration form
    Given I am logged into SquadLogic as an "admin"
    And I navigate to the "Registration Forms" page
    When I create a new form for "Fall 2026" titled "Fall Registration"
    And I add a custom text field labeled "Emergency Contact"
    And I save the form
    Then the form "Fall Registration" should appear in the forms list

  Scenario: Parent registers a child
    Given I am logged into SquadLogic as a "parent"
    And I navigate to the registration link for "Fall Registration"
    When I select my child "Alex"
    And I fill out the custom field "Emergency Contact" with "Jane Doe"
    And I agree to the waiver
    And I submit the registration
    Then I should see a success message

  Scenario: Admin checks compliance dashboard
    Given I am logged into SquadLogic as an "admin"
    And I navigate to the "Compliance Dashboard"
    When I filter for "Fall Registration"
    Then I should see a registration for "Alex"
    And the waiver status should be "Signed"
    And the medical status should be "Pending"
