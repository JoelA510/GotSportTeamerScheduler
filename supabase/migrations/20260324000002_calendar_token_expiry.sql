-- Phase 2.3: Calendar Token Expiry & Rotation (H-2)
-- Adds expiry timestamp to calendar tokens and a function to rotate them.
-- Tokens default to 90-day expiry. Coaches/admins can regenerate from Team Portal.

begin;

-- 1. Add expiry column (default 90 days from now for existing tokens)
alter table public.teams
  add column if not exists calendar_token_expires_at
    timestamptz not null default (now() + interval '90 days');

-- 2. RPC to rotate a team's calendar token (generates new UUID + resets expiry)
create or replace function public.rotate_calendar_token(p_team_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_token uuid;
  v_org_id uuid;
begin
  -- Verify the team exists and get its org
  select organization_id into v_org_id
  from teams where id = p_team_id;

  if v_org_id is null then
    return json_build_object('status', 'error', 'message', 'Team not found');
  end if;

  -- Verify calling user is a member of this organization
  if not is_org_member(v_org_id) then
    return json_build_object('status', 'error', 'message', 'Access denied');
  end if;

  -- Generate new token and reset expiry
  v_new_token := gen_random_uuid();

  update teams
  set calendar_token = v_new_token,
      calendar_token_expires_at = now() + interval '90 days',
      updated_at = now()
  where id = p_team_id;

  return json_build_object(
    'status', 'success',
    'calendar_token', v_new_token,
    'expires_at', (now() + interval '90 days')::text
  );
end;
$$;

-- Grant execute to authenticated users (RPC enforces org membership internally)
grant execute on function public.rotate_calendar_token(uuid) to authenticated;

commit;
