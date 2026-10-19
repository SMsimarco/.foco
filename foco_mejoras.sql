-- foco. — cobros, horas por proyecto, fechas que se repiten y avisos.
-- Correr una vez en el SQL editor de Supabase. Es idempotente: se puede
-- volver a correr sin romper nada. Correr ANTES de desplegar el código.

-- Proyectos: monto como número + moneda, lista de cobros
alter table proyectos add column if not exists monto_total numeric;
alter table proyectos add column if not exists moneda      text not null default 'USD';
-- cobros: [{ "fecha": "2026-10-20", "monto": 450, "nota": "50% inicial" }]
alter table proyectos add column if not exists cobros      jsonb not null default '[]'::jsonb;

-- Fechas ("Próximas fechas" = filas con estado 'recordatorio")
alter table proyectos add column if not exists hora                 text;   -- por si no se corrió proyectos_tablero.sql
alter table proyectos add column if not exists repite               text;   -- null | 'semanal'
alter table proyectos add column if not exists aviso_dia_enviado    date;   -- aviso del día anterior ya mandado para esa fecha
alter table proyectos add column if not exists aviso_previo_enviado date;   -- aviso de 30 min antes ya mandado para esa fecha

-- Tareas: cuándo se tildaron (para el resumen semanal)
alter table proyecto_tareas add column if not exists done_at timestamptz;
update proyecto_tareas set done_at = coalesce(done_at, now()) where done and done_at is null;

-- Eventos: a qué proyecto pertenecen (para sumar horas)
alter table events add column if not exists proyecto_id uuid references proyectos(id) on delete set null;
create index if not exists events_proyecto_id_idx on events (proyecto_id) where proyecto_id is not null;

-- Pasar los montos que estaban como texto ("USD 2.600 · 50/50") a número
-- + moneda, y dejar el resto ("50/50") como condiciones de pago.
-- Solo toca los que empiezan con moneda y número; el resto queda como está.
update proyectos set
  moneda      = case when monto ~* '^\s*ars' then 'ARS' when monto ~* '^\s*(eur|€)' then 'EUR' else 'USD' end,
  monto_total = replace(substring(monto from '^\s*(?:USD|ARS|EUR|€)\s*([0-9][0-9.]*)'), '.', '')::numeric,
  monto       = nullif(trim(regexp_replace(monto, '^\s*(USD|ARS|EUR|€)\s*[0-9][0-9.,]*\s*[·-]?\s*', '', 'i')), '')
where monto_total is null
  and estado not in ('recordatorio', 'nota')
  and monto ~* '^\s*(USD|ARS|EUR|€)\s*[0-9]';
