-- ============================================================
-- Sport Salle — synchro cloud (Supabase, plan gratuit)
-- À coller tel quel dans : Supabase → SQL Editor → New query → Run
-- ============================================================
-- Modèle : un « groupe » = un code secret long (généré par l'app).
-- Le serveur ne stocke qu'un instantané JSON par (groupe, profil).
-- Aucune table n'est accessible directement : l'API n'expose que
-- les 2 fonctions ci-dessous, qui exigent le code du groupe.

create table if not exists public.sync_profiles (
  code       text        not null,
  profile_id text        not null,
  device_id  text,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (code, profile_id)
);

-- RLS activé sans aucune policy = zéro accès direct via l'API REST.
alter table public.sync_profiles enable row level security;
revoke all on table public.sync_profiles from anon, authenticated;

-- Écrit (ou remplace) l'instantané d'un profil dans un groupe.
create or replace function public.sync_push(p_code text, p_profile text, p_device text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(p_code) < 16 or length(p_code) > 64 then
    raise exception 'code invalide';
  end if;
  if p_profile is null or length(p_profile) < 1 or length(p_profile) > 64 then
    raise exception 'profil invalide';
  end if;
  if pg_column_size(p_data) > 5 * 1024 * 1024 then
    raise exception 'instantané trop volumineux';
  end if;
  insert into sync_profiles (code, profile_id, device_id, data, updated_at)
  values (p_code, p_profile, p_device, p_data, now())
  on conflict (code, profile_id)
  do update set data = excluded.data, device_id = excluded.device_id, updated_at = now();
  return now();
end
$$;

-- Lit tous les instantanés d'un groupe.
create or replace function public.sync_pull(p_code text)
returns table (profile_id text, device_id text, data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select profile_id, device_id, data, updated_at
  from sync_profiles
  where code = p_code;
$$;

grant execute on function public.sync_push(text, text, text, jsonb) to anon;
grant execute on function public.sync_pull(text) to anon;
