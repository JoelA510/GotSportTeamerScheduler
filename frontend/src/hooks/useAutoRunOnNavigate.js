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

  // Always invoke the latest onRun without making it a fire-effect dependency.
  // Handlers like handleGenerateTeams change identity whenever their inputs
  // change; keeping onRun out of the fire effect's deps guarantees the run
  // fires exactly once on the first ready transition (never again when the
  // handler is recreated) and avoids re-running the effect on every render.
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  // Capture the intent on the first render that carries it, then strip it from
  // history state so a refresh or back-navigation does not replay the run.
  // Declaring the deps is safe: once the intent is stripped, later runs find no
  // intent and no-op (intentRef stays captured for the fire effect below).
  useEffect(() => {
    if (location.state && location.state[intentKey]) {
      intentRef.current = true;
      const { [intentKey]: _omit, ...rest } = location.state;
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: Object.keys(rest).length > 0 ? rest : null,
      });
    }
  }, [location, intentKey, navigate]);

  // Fire once, the first time the page reports it is ready to run. consumedRef
  // is set before the call and never reset, so this can fire at most once.
  useEffect(() => {
    if (intentRef.current && !consumedRef.current && ready) {
      consumedRef.current = true;
      onRunRef.current?.();
    }
  }, [ready]);
}

export default useAutoRunOnNavigate;
