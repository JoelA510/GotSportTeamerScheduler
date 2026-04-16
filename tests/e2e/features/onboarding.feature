Feature: Organization Onboarding Flow
  As a new manager, I want to create my organization's workspace so I can configure settings.
  As an existing manager, I want to be taken straight to my dashboard.

  @cold_start
  Scenario: Cold Start Organization Creation
    Given I am registered as a brand new user with email "newuser@squadlogic.app"
    And I navigate to the application
    Then I should be redirected to the Organization Creation step
    When I fill in the organization name with "Galactic FC"
    And I fill in the organization slug with "galactic-fc"
    And I submit the organization creation form
    Then I should see the success confirmation overlay
    # New organizations are redirected to Phase 2 (Setup Wizard)
    And I should be redirected to the Setup Wizard
    And the active organization in the sidebar should read "Galactic FC"

  @org_bypass
  Scenario: Existing User Bypass
    Given I authenticate as "admin@squadlogic.app"
    And I navigate to the application
    Then I should bypass the Organization Creation step and land on the Dashboard
