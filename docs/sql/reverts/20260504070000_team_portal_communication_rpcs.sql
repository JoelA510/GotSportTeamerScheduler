-- Emergency rollback for 20260504070000_team_portal_communication_rpcs.sql.
--
-- Pair this with an application rollback if the deployed frontend still calls
-- upsert_team_event_rsvp or create_team_message. This restores the previous
-- direct table-write policies for team portal communication tables. The audit
-- action constraint is intentionally left expanded so existing audit rows for
-- team.rsvp_updated / team.message_created remain valid.

BEGIN;

DROP FUNCTION IF EXISTS public.upsert_team_event_rsvp(uuid, uuid, uuid, text, date, text);
DROP FUNCTION IF EXISTS public.create_team_message(uuid, text);

DROP POLICY IF EXISTS "Event RSVPs: members access" ON public.event_rsvps;
DROP POLICY IF EXISTS "Users can access team RSVPs" ON public.event_rsvps;
DROP POLICY IF EXISTS "Event RSVPs: parents manage own" ON public.event_rsvps;
DROP POLICY IF EXISTS "Admins can access all rsvps" ON public.event_rsvps;
DROP POLICY IF EXISTS "Parents can insert/update RSVPs for their children" ON public.event_rsvps;

CREATE POLICY "Event RSVPs: members access"
    ON public.event_rsvps FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "Admins can access all rsvps"
    ON public.event_rsvps FOR ALL TO authenticated
    USING (
        public.is_org_member(organization_id)
        AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
    WITH CHECK (
        public.is_org_member(organization_id)
        AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    );

CREATE POLICY "Users can access team RSVPs"
    ON public.event_rsvps FOR SELECT TO authenticated
    USING (
        public.is_org_member(organization_id)
        AND (
            auth.uid() IN (
                SELECT c.user_id
                FROM public.coaches c
                WHERE c.id IN (SELECT t.coach_id FROM public.teams t WHERE t.id = event_rsvps.team_id)
                   OR c.id = ANY(SELECT unnest(t.assistant_coach_ids) FROM public.teams t WHERE t.id = event_rsvps.team_id)
            )
            OR auth.uid() IN (
                SELECT pp.profile_id
                FROM public.profile_players pp
                JOIN public.team_players tp ON pp.player_id = tp.player_id
                WHERE tp.team_id = event_rsvps.team_id
            )
        )
    );

CREATE POLICY "Parents can insert/update RSVPs for their children"
    ON public.event_rsvps FOR ALL TO authenticated
    USING (
        public.is_org_member(organization_id)
        AND player_id IN (SELECT player_id FROM public.profile_players WHERE profile_id = auth.uid())
    )
    WITH CHECK (
        public.is_org_member(organization_id)
        AND player_id IN (SELECT player_id FROM public.profile_players WHERE profile_id = auth.uid())
    );

DROP POLICY IF EXISTS "Team Messages: members access" ON public.team_messages;
DROP POLICY IF EXISTS "Users can select team messages" ON public.team_messages;
DROP POLICY IF EXISTS "Admins can access all team messages" ON public.team_messages;
DROP POLICY IF EXISTS "Users can insert team messages" ON public.team_messages;

CREATE POLICY "Team Messages: members access"
    ON public.team_messages FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "Admins can access all team messages"
    ON public.team_messages FOR ALL TO authenticated
    USING (
        public.is_org_member(organization_id)
        AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    );

CREATE POLICY "Users can select team messages"
    ON public.team_messages FOR SELECT TO authenticated
    USING (
        public.is_org_member(organization_id)
        AND (
            auth.uid() IN (
                SELECT c.user_id
                FROM public.coaches c
                WHERE c.id IN (SELECT t.coach_id FROM public.teams t WHERE t.id = team_messages.team_id)
                   OR c.id = ANY(SELECT unnest(t.assistant_coach_ids) FROM public.teams t WHERE t.id = team_messages.team_id)
            )
            OR auth.uid() IN (
                SELECT pp.profile_id
                FROM public.profile_players pp
                JOIN public.team_players tp ON pp.player_id = tp.player_id
                WHERE tp.team_id = team_messages.team_id
            )
        )
    );

CREATE POLICY "Users can insert team messages"
    ON public.team_messages FOR INSERT TO authenticated
    WITH CHECK (
        public.is_org_member(organization_id)
        AND author_id = auth.uid()
        AND (
            auth.uid() IN (
                SELECT c.user_id
                FROM public.coaches c
                WHERE c.id IN (SELECT t.coach_id FROM public.teams t WHERE t.id = team_messages.team_id)
                   OR c.id = ANY(SELECT unnest(t.assistant_coach_ids) FROM public.teams t WHERE t.id = team_messages.team_id)
            )
            OR auth.uid() IN (
                SELECT pp.profile_id
                FROM public.profile_players pp
                JOIN public.team_players tp ON pp.player_id = tp.player_id
                WHERE tp.team_id = team_messages.team_id
            )
        )
    );

COMMIT;
