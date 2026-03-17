Feature: Visual Micro-Interactions and Responsiveness
  As a user interacting with complex UI components
  I want clear visual feedback, responsive layouts, and accurate data visualizations
  So that I can confidently manage league operations

  Scenario: Visual affordances during drag-and-drop roster allocation
    Given I am on the "Teaming & Analysis" page in Edit Mode
    When I click and hold the drag handle for player "Alex"
    Then the player card opacity should visually change to 40%
    And a floating drag overlay should appear slightly rotated
    When I drag the player over an empty team column
    Then the empty column should display a dashed drop-zone border

  Scenario: Global theme toggling visual transitions
    Given I am logged into SquadLogic
    When I click the floating "Theme Toggle" button to activate the "Party" theme
    Then the application background should visually transition to a deep purple and pink radial gradient
    And the text colors should adjust to maintain WCAG 2.2 AA contrast

  Scenario: Club logo upload and color extraction
    Given I am on the "Appearance & Branding" tab in Settings
    When I upload a valid PNG file to the "Club Logo" dropzone
    Then I should see a visual preview of the uploaded logo
    And a "Detected Colors from Logo" panel should appear
    And I should see distinct color swatches extracted from the image

  Scenario: Recharts Tooltip Rendering
    Given I am on the "Reporting Dashboard"
    When I hover my mouse over the "Form Compliance Status" Bar Chart
    Then a dark-themed tooltip should appear showing the exact "Total Submissions" count
    And the chart colors should match the "Deep Space Glass" CSS variables

  Scenario: Mobile Sidebar Navigation
    Given I am logged into SquadLogic on a "Mobile" viewport
    When I view the Dashboard
    Then the sidebar should be hidden by default
    When I click the "Hamburger Menu" icon
    Then the sidebar overlay should slide into view
    When I click a navigation link like "Team Management"
    Then the sidebar overlay should automatically close