-- Registration RPC: Atomic Submission
-- Replaces multi-step client-side inserts with a single transactional RPC.

begin;

create or replace function public.submit_registration(
    p_organization_id uuid,
    p_form_id uuid,
    p_profile_id uuid,
    p_responses jsonb,
    p_player_id uuid default null,
    p_first_name text default null,
    p_last_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_player_id uuid := p_player_id;
    v_registration_id uuid;
begin
    -- 1. Validate Organization Membership (Caller must be member of target org)
    if not is_org_member(p_organization_id) then
        raise exception 'Access denied: User is not a member of organization %', p_organization_id;
    end if;

    -- 2. Create player if not provided
    if v_player_id is null then
        if p_first_name is null or p_last_name is null then
            raise exception 'New player registration requires first and last name.';
        end if;

        insert into public.players (organization_id, first_name, last_name, division_id)
        select p_organization_id, p_first_name, p_last_name, rf.division_id
        from public.registration_forms rf
        where rf.id = p_form_id
        returning id into v_player_id;
    end if;

    -- 3. Ensure player is linked to profile
    insert into public.profile_players (organization_id, profile_id, player_id)
    values (p_organization_id, p_profile_id, v_player_id)
    on conflict (profile_id, player_id) do nothing;

    -- 4. Create Registration Record
    insert into public.registrations (
        organization_id,
        form_id,
        player_id,
        profile_id,
        responses,
        waiver_signed,
        waiver_signed_at
    )
    values (
        p_organization_id,
        p_form_id,
        v_player_id,
        p_profile_id,
        p_responses,
        true,
        now()
    )
    returning id into v_registration_id;

    return v_registration_id;
exception
    when unique_violation then
        raise exception 'This player is already registered for this form.';
end;
$$;

commit;
