Feature: Cold-start organization creation

  Scenario: Authenticated brand-new user with zero organizations is redirected from root
    Given I am authenticated with zero organizations
    When I visit the root path
    Then I should be on the onboarding organization creation route

  Scenario: Authenticated brand-new user can create their first organization
    Given I am authenticated with zero organizations
    When I complete and submit the onboarding organization form
    Then I should land on the dashboard

  Scenario: Duplicate slug is shown inline and user remains on onboarding form
    Given I am authenticated with zero organizations
    When I submit onboarding with a duplicate organization slug
    Then I should see an inline slug error on onboarding
    And I should remain on the onboarding organization creation route

  Scenario: Logged out user can reach reset password route
    Given I am logged out
    When I visit the reset password route
    Then I should be on the reset password route

  Scenario: Invite route remains reachable
    Given I am logged out
    When I visit invite code route "demo-code"
    Then I should be on the invite route "demo-code"
