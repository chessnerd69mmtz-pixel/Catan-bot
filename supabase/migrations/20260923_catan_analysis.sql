
-- Catan Analysis persistence schema
-- Run through Supabase migrations. RLS is enabled on every exposed table.

create table if not exists public.games (
  game_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('1v1','4player','sandbox')),
  status text not null default 'complete' check (status in ('in_progress','complete','abandoned','disconnected')),
  started_at bigint,
  ended_at bigint,
  duration_seconds integer not null default 0,
  winner_id text,
  final_scores jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.board_setups (
  game_id text primary key references public.games(game_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.move_logs (
  move_id text primary key,
  game_id text not null references public.games(game_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_number integer not null default 0,
  player_id text not null,
  timestamp_ms bigint not null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  dice_roll integer,
  state_before jsonb,
  state_after jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.game_analysis (
  game_id text primary key references public.games(game_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  engine_version text not null,
  computed_at timestamptz not null default now(),
  per_player jsonb not null default '{}'::jsonb,
  move_evaluations jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists games_user_updated_idx on public.games(user_id, updated_at desc);
create index if not exists move_logs_game_turn_idx on public.move_logs(game_id, turn_number, timestamp_ms);
create index if not exists move_logs_user_idx on public.move_logs(user_id);
create index if not exists board_setups_user_idx on public.board_setups(user_id);
create index if not exists game_analysis_user_idx on public.game_analysis(user_id);

alter table public.games enable row level security;
alter table public.board_setups enable row level security;
alter table public.move_logs enable row level security;
alter table public.game_analysis enable row level security;

revoke all on public.games from anon;
revoke all on public.board_setups from anon;
revoke all on public.move_logs from anon;
revoke all on public.game_analysis from anon;

grant select, insert, update, delete on public.games to authenticated;
grant select, insert, update, delete on public.board_setups to authenticated;
grant select, insert, update, delete on public.move_logs to authenticated;
grant select, insert, update, delete on public.game_analysis to authenticated;

drop policy if exists games_owner_select on public.games;
drop policy if exists games_owner_insert on public.games;
drop policy if exists games_owner_update on public.games;
drop policy if exists games_owner_delete on public.games;
create policy games_owner_select on public.games for select to authenticated using ((select auth.uid()) = user_id);
create policy games_owner_insert on public.games for insert to authenticated with check ((select auth.uid()) = user_id);
create policy games_owner_update on public.games for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy games_owner_delete on public.games for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists board_owner_select on public.board_setups;
drop policy if exists board_owner_insert on public.board_setups;
drop policy if exists board_owner_update on public.board_setups;
drop policy if exists board_owner_delete on public.board_setups;
create policy board_owner_select on public.board_setups for select to authenticated using ((select auth.uid()) = user_id);
create policy board_owner_insert on public.board_setups for insert to authenticated with check ((select auth.uid()) = user_id);
create policy board_owner_update on public.board_setups for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy board_owner_delete on public.board_setups for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists moves_owner_select on public.move_logs;
drop policy if exists moves_owner_insert on public.move_logs;
drop policy if exists moves_owner_update on public.move_logs;
drop policy if exists moves_owner_delete on public.move_logs;
create policy moves_owner_select on public.move_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy moves_owner_insert on public.move_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy moves_owner_update on public.move_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy moves_owner_delete on public.move_logs for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists analysis_owner_select on public.game_analysis;
drop policy if exists analysis_owner_insert on public.game_analysis;
drop policy if exists analysis_owner_update on public.game_analysis;
drop policy if exists analysis_owner_delete on public.game_analysis;
create policy analysis_owner_select on public.game_analysis for select to authenticated using ((select auth.uid()) = user_id);
create policy analysis_owner_insert on public.game_analysis for insert to authenticated with check ((select auth.uid()) = user_id);
create policy analysis_owner_update on public.game_analysis for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy analysis_owner_delete on public.game_analysis for delete to authenticated using ((select auth.uid()) = user_id);
