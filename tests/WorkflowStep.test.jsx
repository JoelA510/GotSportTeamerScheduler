import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WorkflowStep from '../frontend/src/components/WorkflowStep.jsx';

describe('WorkflowStep', () => {
  it('allows active expanded content to overflow for nested panels and tooltips', () => {
    render(
      <WorkflowStep
        title="Data Import"
        description="Upload CSVs."
        status="active"
        onClick={() => {}}
      >
        <div>Expanded child</div>
      </WorkflowStep>
    );

    const step = screen.getByTestId('workflow-step-data-import');
    expect(step).toHaveClass('min-w-0', 'overflow-visible');

    const expandedGrid = step.querySelector('.grid');
    expect(expandedGrid).toHaveClass('min-w-0', 'overflow-visible', 'grid-rows-[1fr]');

    const expandedContent = screen.getByText('Expanded child').parentElement;
    expect(expandedContent).toHaveClass('min-w-0');
    expect(expandedContent?.parentElement).toHaveClass('min-w-0', 'overflow-visible');
  });

  it('keeps inactive expanded content clipped for the collapsed animation', () => {
    render(
      <WorkflowStep
        title="Data Import"
        description="Upload CSVs."
        status="pending"
        onClick={() => {}}
      >
        <div>Collapsed child</div>
      </WorkflowStep>
    );

    const step = screen.getByTestId('workflow-step-data-import');
    expect(step).toHaveClass('min-w-0', 'overflow-visible');

    const expandedGrid = step.querySelector('.grid');
    expect(expandedGrid).toHaveClass('overflow-hidden', 'grid-rows-[0fr]');

    const collapsedContent = screen.getByText('Collapsed child').parentElement;
    expect(collapsedContent?.parentElement).toHaveClass('min-w-0', 'overflow-hidden');
  });
});
