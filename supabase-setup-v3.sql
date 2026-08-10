-- ============================================================
-- Senka - Fix RLS v3 (jalankan di SQL Editor, setelah v2)
-- Token login (Tamu & Google) ber-role "authenticated",
-- jadi policy harus berlaku untuk anon DAN authenticated.
-- ============================================================

drop policy if exists "senka_chats_auth_insert" on public.senka_chats;
drop policy if exists "senka_chats_auth_select" on public.senka_chats;
drop policy if exists "senka_chats_auth_delete" on public.senka_chats;

create policy "senka_chats_auth_insert" on public.senka_chats
    for insert to anon, authenticated with check (auth.uid()::text = user_id);

create policy "senka_chats_auth_select" on public.senka_chats
    for select to anon, authenticated using (auth.uid()::text = user_id);

create policy "senka_chats_auth_delete" on public.senka_chats
    for delete to anon, authenticated using (auth.uid()::text = user_id);

drop policy if exists "sessions_auth_insert" on public.senka_sessions;
drop policy if exists "sessions_auth_select" on public.senka_sessions;
drop policy if exists "sessions_auth_update" on public.senka_sessions;
drop policy if exists "sessions_auth_delete" on public.senka_sessions;

create policy "sessions_auth_insert" on public.senka_sessions
    for insert to anon, authenticated with check (auth.uid()::text = user_id);

create policy "sessions_auth_select" on public.senka_sessions
    for select to anon, authenticated using (auth.uid()::text = user_id);

create policy "sessions_auth_update" on public.senka_sessions
    for update to anon, authenticated using (auth.uid()::text = user_id)
    with check (auth.uid()::text = user_id);

create policy "sessions_auth_delete" on public.senka_sessions
    for delete to anon, authenticated using (auth.uid()::text = user_id);

drop policy if exists "senka_media_anon_select" on storage.objects;
drop policy if exists "senka_media_auth_insert" on storage.objects;

create policy "senka_media_anon_select" on storage.objects
    for select to anon, authenticated using (bucket_id = 'senka-media');

create policy "senka_media_auth_insert" on storage.objects
    for insert to anon, authenticated with check (
        bucket_id = 'senka-media'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
