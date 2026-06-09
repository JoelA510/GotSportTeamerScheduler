import React from 'react';
import PropTypes from 'prop-types';
import { Play } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Tooltip from '../ui/Tooltip.jsx';

/**
 * Standardized "Run this step" action for the dashboard workflow.
 *
 * Renders a primary button that manually triggers a step's run (e.g.
 * "Start Teaming"). When the step already has generated data (`hasExisting`),
 * callers pass a re-run label and a confirmation guards against discarding the
 * current draft. When `disabled`, the reason is surfaced accessibly via a
 * tooltip — the Tooltip wrapper stays focusable so screen-reader and keyboard
 * users can reach the reason even though the native button is disabled.
 *
 * @param {Object} props
 * @param {string} props.label
 * @param {() => void} props.onRun
 * @param {boolean} [props.disabled]
 * @param {string} [props.disabledReason]
 * @param {boolean} [props.hasExisting]
 * @param {string} [props.reRunConfirmMessage]
 * @param {'sm' | 'md' | 'lg'} [props.size]
 * @param {string} [props.testId]
 * @param {string} [props.className]
 */
export default function StepRunButton({
  label,
  onRun,
  disabled = false,
  disabledReason = '',
  hasExisting = false,
  reRunConfirmMessage = 'Re-running will replace the current draft. Continue?',
  size = 'md',
  testId,
  className = '',
}) {
  const handleClick = () => {
    if (disabled) return;
    if (hasExisting && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(reRunConfirmMessage)) return;
    }
    onRun();
  };

  const button = (
    <Button
      variant="primary"
      size={size}
      icon={Play}
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={className}
    >
      {label}
    </Button>
  );

  if (disabled && disabledReason) {
    return <Tooltip content={disabledReason}>{button}</Tooltip>;
  }

  return button;
}

StepRunButton.propTypes = {
  label: PropTypes.string.isRequired,
  onRun: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  disabledReason: PropTypes.string,
  hasExisting: PropTypes.bool,
  reRunConfirmMessage: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  testId: PropTypes.string,
  className: PropTypes.string,
};
