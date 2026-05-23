-- Security hardening: prevent low-privilege org members from mutating players.
-- Read access remains available to all organization members; mutations require org admin.

begin;

drop policy if exists "Unified org access on players" on public.players;

drop policy if exists "Org members can read players" on public.players;
create policy "Org members can read players"
  on public.players
  for select
  to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "Org admins can mutate players" on public.players;
create policy "Org admins can mutate players"
  on public.players
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

commit;
