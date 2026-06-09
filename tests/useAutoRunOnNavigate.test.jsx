import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAutoRunOnNavigate } from '../frontend/src/hooks/useAutoRunOnNavigate.js';

function wrapperWithState(state) {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[{ pathname: '/teams', state }]}>{children}</MemoryRouter>;
  };
}

describe('useAutoRunOnNavigate', () => {
  it('fires onRun once, on the first transition to ready, when the intent is present', () => {
    const onRun = vi.fn();
    const { rerender } = renderHook(
      ({ ready }) => useAutoRunOnNavigate({ intentKey: 'autoRunTeaming', ready, onRun }),
      {
        wrapper: wrapperWithState({ autoRunTeaming: true }),
        initialProps: { ready: false },
      }
    );

    expect(onRun).not.toHaveBeenCalled();

    rerender({ ready: true });
    expect(onRun).toHaveBeenCalledTimes(1);

    // Staying ready (or toggling) must not re-fire.
    rerender({ ready: true });
    rerender({ ready: false });
    rerender({ ready: true });
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('fires immediately when ready on mount', () => {
    const onRun = vi.fn();
    renderHook(() => useAutoRunOnNavigate({ intentKey: 'autoRunTeaming', ready: true, onRun }), {
      wrapper: wrapperWithState({ autoRunTeaming: true }),
    });
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('never fires when no intent is present', () => {
    const onRun = vi.fn();
    const { rerender } = renderHook(
      ({ ready }) => useAutoRunOnNavigate({ intentKey: 'autoRunTeaming', ready, onRun }),
      {
        wrapper: wrapperWithState({}),
        initialProps: { ready: true },
      }
    );
    rerender({ ready: true });
    expect(onRun).not.toHaveBeenCalled();
  });

  it('ignores a non-matching intent key', () => {
    const onRun = vi.fn();
    renderHook(() => useAutoRunOnNavigate({ intentKey: 'autoRunTeaming', ready: true, onRun }), {
      wrapper: wrapperWithState({ autoRunPractice: true }),
    });
    expect(onRun).not.toHaveBeenCalled();
  });
});
