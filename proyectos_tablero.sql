-- Tablero de Proyectos: campos para que cada proyecto tenga su vista
-- completa (cliente, monto, plazo, próximo paso, cronograma, qué incluye y
-- qué no, contactos, link a un tablero externo y color propio).
-- Correr una vez en el SQL editor de Supabase. Es idempotente.

alter table proyectos add column if not exists cliente       text;
alter table proyectos add column if not exists via           text;
alter table proyectos add column if not exists monto         text;
alter table proyectos add column if not exists plazo         text;
alter table proyectos add column if not exists proximo_paso  text;
alter table proyectos add column if not exists link_tablero  text;
alter table proyectos add column if not exists color         text;
-- hora opcional para las "Próximas fechas" (ej. 11:00), muestra la cuenta regresiva exacta
alter table proyectos add column if not exists hora          text;
alter table proyectos add column if not exists incluye       jsonb not null default '[]'::jsonb;
alter table proyectos add column if not exists excluye       jsonb not null default '[]'::jsonb;
alter table proyectos add column if not exists contactos     jsonb not null default '[]'::jsonb;
-- cronograma: [{ "cuando": "13/10", "que": "Arranque", "estado": "pendiente|ahora|listo" }]
alter table proyectos add column if not exists cronograma    jsonb not null default '[]'::jsonb;
