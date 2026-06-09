import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Consume a one-shot "auto-run" intent passed via React Router location state,
 * then invoke `onRun` exactly once the first time the page reports it is `ready`.
 *
 * The dashboard workflow's Run buttons navigate to a step's page with
 * `navigate(path, { state: { [intentKey]: true } })`. This hook reads that flag
 * once on mount, strips it from history state (so a refresh or back-navigation
 * does not replay the run), and fires `onRun` when the page's preconditions are
 * met. It never fires on bare mount unless `ready` is already true, and never
 * fires more than once per visit.
 *
 * @param {Object} params
 * @param {string} params.intentKey - Location-state key that signals the intent.
 * @param {boolean} params.ready - Page-defined readiness (data loaded, perms ok).
 * @param {() => void} params.onRun - Trigger to invoke once when ready.
 */
export function useAutoRunOnNavigate({ intentKey, ready, onRun }) {
  const location = useLocation();
  const navigate = useNavigate();
  const intentRef = useRef(false);
  const consumedRef = useRef(false);

  // Capture the intent once on mount, then strip it from history state so a
  // refresh or back-navigation does not replay the run.
  useEffect(() => {
    if (location.state && location.state[intentKey]) {
      intentRef.current = true;
      const { [intentKey]: _omit, ...rest } = location.state;
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: Object.keys(rest).length > 0 ? rest : null,
      });
    }
    // Intent is a one-shot captured on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire once, the first time the page reports it is ready to run.
  useEffect(() => {
    if (intentRef.current && !consumedRef.current && ready && typeof onRun === 'function') {
      consumedRef.current = true;
      onRun();
    }
  }, [ready, onRun]);
}

export default useAutoRunOnNavigate;
