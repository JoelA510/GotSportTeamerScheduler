import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Tooltip from '../frontend/src/components/ui/Tooltip.jsx';

const tooltipFor = (element) => {
  const describedBy = element.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  return document.getElementById(describedBy.split(/\s+/).at(-1));
};

describe('Tooltip', () => {
  it('links tooltip text to a focusable child without replacing visible labels', async () => {
    render(
      <Tooltip content="Helpful action">
        <button type="button">Action</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Action' });
    const tooltip = tooltipFor(button);

    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(tooltip).toHaveTextContent('Helpful action');
    expect(tooltip).toHaveClass(
      'group-hover/tooltip:opacity-100',
      'group-focus-within/tooltip:opacity-100'
    );

    button.focus();
    expect(button).toHaveFocus();
  });

  it('keeps disabled controls describable through a focusable wrapper', () => {
    render(
      <Tooltip content="Unavailable until a file is selected">
        <button type="button" disabled>
          Start Import
        </button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Start Import' });
    const wrapper = button.parentElement;
    const tooltip = tooltipFor(button);

    expect(button).toBeDisabled();
    expect(wrapper).toHaveAttribute('tabindex', '0');
    expect(wrapper).toHaveAttribute('aria-disabled', 'true');
    expect(wrapper).toHaveAttribute('aria-describedby', tooltip.id);
    expect(tooltip).toHaveTextContent('Unavailable until a file is selected');
  });
});
