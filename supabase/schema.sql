-- Łapki GO: SCHEMAT NA PRZYSZŁOŚĆ, NIE WŁĄCZA SYNCHRONIZACJI AUTOMATYCZNIE.
-- Uruchom w SQL Editor dopiero przy wdrażaniu autoryzacji Supabase.
-- Domyślnie niczego nie publikujemy wszystkim użytkownikom.
create table if not exists public.animals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  species text not null check(species in ('dog','cat')),
  place_label text,
  note text,
  photo_path text,
  created_at timestamptz not null default now()
);
create table if not exists public.walks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes integer not null check(minutes between 1 and 1440),
  distance_m integer not null default 0 check(distance_m between 0 and 1000000),
  gps_measured boolean not null default false,
  finished_at timestamptz not null default now()
);
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  animal_id uuid references public.animals(id) on delete set null,
  reason text not null check (reason in ('violence','sexual','privacy','spam','other')),
  details text not null default '' check(char_length(details)<=500),
  status text not null default 'pending' check(status in ('pending','reviewed','closed')),
  created_at timestamptz not null default now()
);
alter table public.animals enable row level security;
alter table public.walks enable row level security;
alter table public.content_reports enable row level security;
revoke all on public.animals, public.walks, public.content_reports from anon;
grant select,insert,update,delete on public.animals, public.walks to authenticated;
grant insert,select on public.content_reports to authenticated;
create policy "animals_owner_select" on public.animals for select to authenticated using ((select auth.uid())=user_id);
create policy "animals_owner_insert" on public.animals for insert to authenticated with check ((select auth.uid())=user_id);
create policy "animals_owner_update" on public.animals for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "animals_owner_delete" on public.animals for delete to authenticated using ((select auth.uid())=user_id);
create policy "walks_owner_select" on public.walks for select to authenticated using ((select auth.uid())=user_id);
create policy "walks_owner_insert" on public.walks for insert to authenticated with check ((select auth.uid())=user_id);
create policy "walks_owner_update" on public.walks for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "walks_owner_delete" on public.walks for delete to authenticated using ((select auth.uid())=user_id);
create policy "reports_own_insert" on public.content_reports for insert to authenticated with check ((select auth.uid())=reporter_id and status='pending');
create policy "reports_own_select" on public.content_reports for select to authenticated using ((select auth.uid())=reporter_id);
-- Brak polityki odczytu wszystkich zgłoszeń przez użytkowników, brak prawa do edycji statusu.
-- Moderator docelowo korzysta z ZAUFANEGO BACKENDU, NIE z service_role w przeglądarce.
-- Konieczne dalsze kroki: prywatny Storage, walidacja plików na serwerze,
-- ograniczenia uploadów, realna kolejka/moderator, retencja i obsługa zgłoszeń.
