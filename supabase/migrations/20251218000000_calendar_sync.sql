-- Milestone 3.3: Calendar Sync Schema
-- Adds a unique token to the teams table to securely expose ICS feeds without RLS

begin;

-- Add the column
alter table public.teams 
add column if not exists calendar_token uuid not null default gen_random_uuid();

-- Enforce uniqueness just to be safe
alter table public.teams
add constraint teams_calendar_token_key unique (calendar_token);

-- Update any existing rows (redundant if default handled it, but safe)
-- update public.teams set calendar_token = gen_random_uuid() where calendar_token is null;

commit;
