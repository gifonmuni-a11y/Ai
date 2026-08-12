-- ============================================
-- SUPABASE SQL EDITOR — jalankan SEKALI saja
-- Kegunaan: tabel pengaturan aplikasi
-- 1. Menyimpan "Kode Akses Mode Cerita" secara GLOBAL
--    (bisa diubah dari Admin Panel dan langsung aktif di semua perangkat)
-- 2. Setelah tabel ini ada, GET /api/access-code akan
--    memprioritaskan kode dari tabel ini, lalu fallback ke env SENKA_ACCESS_CODE
-- ============================================

create table if not exists public.app_settings (
    key text primary key,
    value text,
    updated_at timestamptz default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_read" on public.app_settings;
create policy "app_settings_read" on public.app_settings for select using (true);

drop policy if exists "app_settings_insert" on public.app_settings;
create policy "app_settings_insert" on public.app_settings for insert with check (true);

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update" on public.app_settings for update using (true) with check (true);
