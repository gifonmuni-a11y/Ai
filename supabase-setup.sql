-- ============================================================
-- Senka - Setup Supabase (jalankan sekali di SQL Editor)
-- ============================================================

-- 1. Tabel chat (isi_pesan menyimpan teks/URL yang SUDAH DIENKRIPSI oleh frontend)
create table if not exists public.senka_chats (
    id bigserial primary key,
    user_id text not null,
    tipe_user text not null default 'anonymous',
    tipe_pesan text not null default 'text',
    isi_pesan text not null,
    pengirim text not null,
    waktu_kirim timestamptz not null default now()
);

create index if not exists idx_senka_chats_user_id on public.senka_chats (user_id, id desc);

-- 2. Row Level Security: anon boleh insert & select (isi tetap aman karena terenkripsi)
alter table public.senka_chats enable row level security;

drop policy if exists "senka_chats_anon_insert" on public.senka_chats;
create policy "senka_chats_anon_insert" on public.senka_chats
    for insert to anon with check (true);

drop policy if exists "senka_chats_anon_select" on public.senka_chats;
create policy "senka_chats_anon_select" on public.senka_chats
    for select to anon using (true);

-- 3. Bucket storage 'senka-media' (publik) untuk foto/gambar/video
insert into storage.buckets (id, name, public)
values ('senka-media', 'senka-media', true)
on conflict (id) do update set public = true;

drop policy if exists "senka_media_anon_select" on storage.objects;
create policy "senka_media_anon_select" on storage.objects
    for select to anon using (bucket_id = 'senka-media');

drop policy if exists "senka_media_anon_insert" on storage.objects;
create policy "senka_media_anon_insert" on storage.objects
    for insert to anon with check (bucket_id = 'senka-media');
