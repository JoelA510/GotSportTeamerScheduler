Feature: RBAC and Multi-Tenancy Enforcement
  As a system administrator
  I want strict role-based access control and multi-tenancy isolation
  So that users can only access data belonging to their organization and role

  Background:
    Given the following organizations exist: "Org A", "Org B"
    And "Coach Alice" belongs to "Org A" with role "Coach"
    And "Admin Bob" belongs to "Org B" with role "Admin"

  Scenario: Multi-Tenancy Data Isolation (RLS)
    Given I am logged into the SquadLogic dashboard as "Coach Alice"
    When I request the list of teams, players, or schedules
    Then I should only receive records associated with "Org A"
    And any direct query for "Org B" records should return empty or unauthorized

  Scenario: Route Protection via usePermission
    Given I am logged into the SquadLogic dashboard as "Coach Alice"
    When I attempt to navigate to full Admin routes such as Data Import or Settings
    Then I should be redirected to the Dashboard
    And I should see an "Unauthorized access" warning

  Scenario: Admin Access Verification
    Given I am logged into the SquadLogic dashboard as "Admin Bob"
    When I navigate to the Admin routes
    Then I should successfully load the page
    And I should be able to view and manage data specifically for "Org B"
