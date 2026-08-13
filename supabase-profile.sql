-- ============================================================
-- Senka - User Profile (Discord style) - Setup Supabase
-- Jalankan SEKALI di SQL Editor (Dashboard > SQL Editor > New query)
--
-- Kegunaan: tabel profil user agar Nama, Foto, Banner, Bio,
-- dan Avatar Decoration tersimpan di cloud (sinkron antar perangkat
-- untuk akun Google/Tamu yang login), bukan cuma di localStorage.
--
-- Cara pakai di app (public/script.js):
--   baca :  GET  /api/profile   (ambil profil milik auth.uid)
--   simpan: POST /api/profile   (upsert profil milik auth.uid)
-- ============================================================

-- ============================================================
-- 1. TABEL PROFIL
--    user_id      = auth.uid()::text  (sama seperti senka_chats)
--    avatar/banner= URL / data-URL gambar (foto custom disimpan
--                   sebagai data:image/jpeg;base64,...)
--    decoration   = URL dekorasi avatar yang dipilih user
-- ============================================================
create table if not exists public.senka_profiles (
    user_id      text primary key,
    name         text not null default '',
    avatar       text not null default '',
    avatar_source text not null default '',  -- 'google' | 'guest' | 'custom'
    banner       text not null default '',
    bio          text not null default '',
    decoration   text not null default '',
    member_since timestamptz,
    updated_at   timestamptz not null default now()
);

comment on table public.senka_profiles is 'Profil user (nama, avatar, banner, bio, dekorasi) untuk fitur User Profile ala Discord';

-- ============================================================
-- 2. ROW LEVEL SECURITY
--    User hanya bisa baca & ubah profil miliknya sendiri.
--    (mengikuti pola v2/v3: anon + authenticated, karena token
--    login Tamu/Google ber-role authenticated)
-- ============================================================
alter table public.senka_profiles enable row level security;

drop policy if exists "profiles_auth_select" on public.senka_profiles;
create policy "profiles_auth_select" on public.senka_profiles
    for select to anon, authenticated using (auth.uid()::text = user_id);

drop policy if exists "profiles_auth_insert" on public.senka_profiles;
create policy "profiles_auth_insert" on public.senka_profiles
    for insert to anon, authenticated with check (auth.uid()::text = user_id);

drop policy if exists "profiles_auth_update" on public.senka_profiles;
create policy "profiles_auth_update" on public.senka_profiles
    for update to anon, authenticated using (auth.uid()::text = user_id)
    with check (auth.uid()::text = user_id);

-- ============================================================
-- 3. TRIGGER: otomatis buat baris profil saat user daftar/masuk
--    pertama kali (Google maupun Tamu), agar tidak perlu insert
--    manual dari app.
-- ============================================================
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.senka_profiles (user_id, member_since)
    values (new.id::text, new.created_at)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
    after insert on auth.users
    for each row execute function public.handle_new_user_profile();

-- ============================================================
-- 4. (OPSIONAL) Membuat/menemukan profil sendiri dari app
--    Jika app menekan RLS saat profil belum ada, fungsi ini
--    membuat baris lalu mengembalikannya dalam satu panggilan RPC.
--    Contoh panggilan dari app:
--      supabase.rpc('get_or_create_my_profile')
-- ============================================================
create or replace function public.get_or_create_my_profile()
returns setof public.senka_profiles
language sql
security definer set search_path = public
as $$
    insert into public.senka_profiles (user_id, member_since)
    values (auth.uid()::text, now())
    on conflict (user_id) do nothing;
    select * from public.senka_profiles where user_id = auth.uid()::text;
$$;

-- ============================================================
-- SELESAI.
-- Setelah menjalankan script ini, pastikan app sudah memakai
-- tabel ini (endpoint /api/profile di server.js + fungsi
-- syncProfile() di public/script.js) supaya profil tidak hanya
-- tersimpan di localStorage.
-- ============================================================
