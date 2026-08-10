-- ============================================================
-- Senka - Setup Supabase v2 (jalankan di SQL Editor)
-- Menambah: tabel sesi chat + auth per-akun (Google / Tamu)
-- ============================================================

-- 1. Tabel sesi chat (satu akun boleh punya banyak sesi)
create table if not exists public.senka_sessions (
    id text primary key,
    user_id text not null,
    nama text not null default 'Sesi',
    waktu_update timestamptz not null default now()
);

create index if not exists idx_senka_sessions_user on public.senka_sessions (user_id, waktu_update desc);

-- 2. Kolom sesi_id di tabel chat
alter table public.senka_chats add column if not exists sesi_id text not null default '';
create index if not exists idx_senka_chats_sesi on public.senka_chats (user_id, sesi_id, id desc);

-- 3. RLS chat: hanya pemilik akun (auth.uid) yang bisa baca/tulis/hapus
drop policy if exists "senka_chats_anon_insert" on public.senka_chats;
drop policy if exists "senka_chats_anon_select" on public.senka_chats;
drop policy if exists "senka_chats_auth_insert" on public.senka_chats;
drop policy if exists "senka_chats_auth_select" on public.senka_chats;
drop policy if exists "senka_chats_auth_delete" on public.senka_chats;

create policy "senka_chats_auth_insert" on public.senka_chats
    for insert to anon with check (auth.uid()::text = user_id);

create policy "senka_chats_auth_select" on public.senka_chats
    for select to anon using (auth.uid()::text = user_id);

create policy "senka_chats_auth_delete" on public.senka_chats
    for delete to anon using (auth.uid()::text = user_id);

-- 4. RLS sesi: hanya pemilik akun
alter table public.senka_sessions enable row level security;

drop policy if exists "sessions_auth_insert" on public.senka_sessions;
drop policy if exists "sessions_auth_select" on public.senka_sessions;
drop policy if exists "sessions_auth_update" on public.senka_sessions;
drop policy if exists "sessions_auth_delete" on public.senka_sessions;

create policy "sessions_auth_insert" on public.senka_sessions
    for insert to anon with check (auth.uid()::text = user_id);

create policy "sessions_auth_select" on public.senka_sessions
    for select to anon using (auth.uid()::text = user_id);

create policy "sessions_auth_update" on public.senka_sessions
    for update to anon using (auth.uid()::text = user_id)
    with check (auth.uid()::text = user_id);

create policy "sessions_auth_delete" on public.senka_sessions
    for delete to anon using (auth.uid()::text = user_id);

-- 5. Storage: baca tetap publik (URL media langsung dibuka di aplikasi),
--    upload wajib di folder sesuai akun (auth.uid)
drop policy if exists "senka_media_anon_insert" on storage.objects;
drop policy if exists "senka_media_auth_insert" on storage.objects;

create policy "senka_media_auth_insert" on storage.objects
    for insert to anon with check (
        bucket_id = 'senka-media'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
