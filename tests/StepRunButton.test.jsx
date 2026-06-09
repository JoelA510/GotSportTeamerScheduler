import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepRunButton from '../frontend/src/components/workflow/StepRunButton.jsx';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StepRunButton', () => {
  it('renders the label and calls onRun on click when enabled', () => {
    const onRun = vi.fn();
    render(<StepRunButton label="Start Teaming" onRun={onRun} testId="run" />);

    const btn = screen.getByTestId('run');
    expect(btn).toHaveTextContent('Start Teaming');
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('disables the button and exposes the reason via an associated tooltip', () => {
    const onRun = vi.fn();
    render(
      <StepRunButton
        label="Run Practice Scheduling"
        onRun={onRun}
        disabled
        disabledReason="Generate teams first to enable scheduling."
        testId="run"
      />
    );

    const btn = screen.getByTestId('run');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Generate teams first to enable scheduling.'
    );

    fireEvent.click(btn);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('confirms before re-running when the step already has a draft', () => {
    const onRun = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StepRunButton label="Re-run Teaming" onRun={onRun} hasExisting testId="run" />);

    fireEvent.click(screen.getByTestId('run'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('run'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
