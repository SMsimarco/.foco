-- Fix: recurrentes son 1 fila compartida por todas las ocurrencias.
-- events.done marcaba TODAS las ocurrencias done a la vez (semana que
-- viene incluida). Esta tabla guarda el done por ocurrencia (fecha).

create table if not exists event_completions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (event_id, date)
);

alter table event_completions enable row level security;

create policy "own completions select" on event_completions
  for select using (auth.uid() = user_id);

create policy "own completions insert" on event_completions
  for insert with check (auth.uid() = user_id);

create policy "own completions update" on event_completions
  for update using (auth.uid() = user_id);

create policy "own completions delete" on event_completions
  for delete using (auth.uid() = user_id);
