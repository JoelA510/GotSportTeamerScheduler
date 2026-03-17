Feature: Async States and Optimistic UI
  As a League Administrator
  I want clear loading indicators, timeout handling, and instant UI feedback
  So that I am never left wondering about the system's status

  Scenario: Persistence panel async loading and timeout visuals
    Given I have pending manual roster overrides
    When I click "Sync to Supabase" on the Team Persistence Panel
    Then the button should visually transition to a pulsing "Syncing..." state
    And if the Supabase connection is blocked for 10 seconds
    Then the panel should display a red error message stating "Supabase sync timed out. Please retry."

  Scenario: Global Error Boundary visual rendering
    Given the application encounters an unexpected fatal React error
    Then the screen should visually transition to the Error Boundary fallback
    And I should see a glass panel with a red ShieldAlert icon
    And I should see the text "Something went wrong"
    And I should see a functional "Return Home" button

  Scenario: Data Validation Panel layout on malformed CSV
    Given I have uploaded a GotSport CSV with malformed row data
    When the import processing completes with warnings
    Then the Data Validation Panel should appear with an amber warning header
    And I should see a scrollable table listing the specific row errors
    And the table should have a sticky header for "Type", "Description", and "Action"

  Scenario: Medical Clearance Optimistic Toggle
    Given I am on the "Compliance Dashboard"
    And I am viewing a registration for "Alex" with a "Reviewing" medical status
    When I click the "Reviewing" medical clearance button
    Then the button should instantly change to a blue "Cleared" state
    And the database should be updated in the background without requiring a page refresh

  Scenario: Output Generation Async Pipeline
    Given I am on the "Output & Communication" workflow step
    When I click "Generate CSVs"
    Then the button should disable and show "Generating..."
    When the generation completes, I click "Upload to Storage"
    Then the status text should pulse orange saying "Uploading to Storage..."
    And eventually display a green success message confirming the number of files uploaded