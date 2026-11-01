-- ============================================
-- DOMINO SCORE TRACKER — SCHEMA COMPLETO
-- Ejecuta TODO esto en el SQL Editor de Supabase
-- ============================================

-- Eliminar tabla vieja si existe
drop table if exists scores;

-- ============================================
-- 1. TABLA DE PERFILES
-- Se crea automáticamente al registrarse
-- ============================================
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text not null,
  initials text not null check (char_length(initials) <= 3),
  created_at timestamp with time zone default now()
);

alter table profiles enable row level security;

create policy "Public profiles" on profiles for select using (true);

create policy "Users update own profile" on profiles
  for update using (auth.uid() = id);

create policy "Insert own profile" on profiles
  for insert with check (auth.uid() = id);

-- Trigger: auto-crear perfil cuando alguien se registra
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', 'Jugador'),
    upper(coalesce(new.raw_user_meta_data->>'initials', 'JG'))
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Eliminar trigger si ya existe para evitar error
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================
-- 2. TABLA DE PARTIDAS
-- Guarda cada partida con los 4 jugadores
-- ============================================
drop table if exists matches;

create table matches (
  id uuid default gen_random_uuid() primary key,
  team1_player1 uuid references profiles(id),
  team1_player2 uuid references profiles(id),
  team2_player1 uuid references profiles(id),
  team2_player2 uuid references profiles(id),
  limit_score integer not null,
  rounds jsonb not null default '[]',
  team1_total integer not null default 0,
  team2_total integer not null default 0,
  winner_team integer not null check (winner_team in (1, 2)),
  is_zapato boolean default false,
  created_at timestamp with time zone default now()
);

alter table matches enable row level security;

create policy "Authenticated read matches" on matches
  for select using (auth.role() = 'authenticated');

create policy "Authenticated insert matches" on matches
  for insert with check (auth.role() = 'authenticated');

-- ============================================
-- 3. VISTA DE ESTADÍSTICAS POR JUGADOR
-- Se consulta como una tabla normal
-- ============================================
create or replace view player_stats as
select
  p.id,
  p.display_name,
  p.initials,
  count(m.id) as total_matches,
  count(*) filter (where
    (m.winner_team = 1 and p.id in (m.team1_player1, m.team1_player2)) or
    (m.winner_team = 2 and p.id in (m.team2_player1, m.team2_player2))
  ) as wins,
  count(*) filter (where
    (m.winner_team = 2 and p.id in (m.team1_player1, m.team1_player2)) or
    (m.winner_team = 1 and p.id in (m.team2_player1, m.team2_player2))
  ) as losses,
  count(*) filter (where
    m.is_zapato = true and (
      (m.winner_team = 1 and p.id in (m.team1_player1, m.team1_player2)) or
      (m.winner_team = 2 and p.id in (m.team2_player1, m.team2_player2))
    )
  ) as zapatos_given,
  count(*) filter (where
    m.is_zapato = true and (
      (m.winner_team = 2 and p.id in (m.team1_player1, m.team1_player2)) or
      (m.winner_team = 1 and p.id in (m.team2_player1, m.team2_player2))
    )
  ) as zapatos_received
from profiles p
left join matches m on p.id in (
  m.team1_player1, m.team1_player2,
  m.team2_player1, m.team2_player2
)
group by p.id, p.display_name, p.initials;

-- ============================================
-- LISTO! Ahora registra usuarios desde la app.
-- ============================================
