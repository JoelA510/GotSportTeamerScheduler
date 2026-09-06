-- Harness stub for pg_cron. See pg_cron.control.
CREATE SCHEMA IF NOT EXISTS cron;

CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text,
  command text,
  nodename text DEFAULT 'localhost',
  nodeport int DEFAULT 5432,
  database text,
  username text,
  active boolean DEFAULT true,
  jobname text
);

-- Records the request and returns an id. Runs nothing: the harness proves the
-- migration APPLIES, not that a cron job fires.
CREATE OR REPLACE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  DELETE FROM cron.job WHERE jobname = p_jobname;
  INSERT INTO cron.job (schedule, command, jobname, database, username)
  VALUES (p_schedule, p_command, p_jobname, current_database(), current_user)
  RETURNING jobid INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION cron.schedule(p_schedule text, p_command text)
RETURNS bigint LANGUAGE sql AS $$
  SELECT cron.schedule('job_' || md5(p_command), p_schedule, p_command);
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(p_jobname text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN DELETE FROM cron.job WHERE jobname = p_jobname; RETURN true; END; $$;

CREATE OR REPLACE FUNCTION cron.unschedule(p_jobid bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN DELETE FROM cron.job WHERE jobid = p_jobid; RETURN true; END; $$;
