-- Magazzino: schema Supabase
-- Esegui questo file in Supabase > SQL Editor > New query > Run

create table if not exists categorie (
  codice  text primary key,
  nome    text not null,
  ordine  int  not null default 0
);

insert into categorie (codice, nome, ordine) values
  ('bere', 'Bere', 1),
  ('cibo', 'Cibo', 2)
on conflict (codice) do nothing;

create table if not exists articoli (
  id            bigint generated always as identity primary key,
  nome          text    not null,
  categoria     text    not null references categorie(codice),
  unita         text    not null default 'pz',
  quantita      numeric not null default 0 check (quantita >= 0),
  scorta_minima numeric not null default 0 check (scorta_minima >= 0),
  creato_il     timestamptz not null default now()
);

create table if not exists movimenti (
  id          bigint generated always as identity primary key,
  articolo_id bigint  not null references articoli(id) on delete cascade,
  tipo        text    not null check (tipo in ('carico', 'scarico')),
  quantita    numeric not null check (quantita > 0),
  nota        text,
  creato_il   timestamptz not null default now()
);

create index if not exists movimenti_creato_il_idx on movimenti (creato_il desc);

-- Carico/scarico atomico: aggiorna la giacenza e registra il movimento insieme.
-- Uno scarico superiore alla giacenza viene rifiutato.
create or replace function registra_movimento(
  p_articolo_id bigint,
  p_tipo        text,
  p_quantita    numeric,
  p_nota        text default null
) returns articoli
language plpgsql
security definer
set search_path = public
as $$
declare
  r articoli;
begin
  if p_quantita is null or p_quantita <= 0 then
    raise exception 'La quantità deve essere maggiore di zero';
  end if;

  if p_tipo = 'scarico' then
    update articoli set quantita = quantita - p_quantita
     where id = p_articolo_id and quantita >= p_quantita
     returning * into r;
    if not found then
      raise exception 'Quantità insufficiente in magazzino';
    end if;
  elsif p_tipo = 'carico' then
    update articoli set quantita = quantita + p_quantita
     where id = p_articolo_id
     returning * into r;
    if not found then
      raise exception 'Articolo non trovato';
    end if;
  else
    raise exception 'Tipo non valido: %', p_tipo;
  end if;

  insert into movimenti (articolo_id, tipo, quantita, nota)
  values (p_articolo_id, p_tipo, p_quantita, nullif(trim(p_nota), ''));

  return r;
end;
$$;

-- RLS attiva senza policy: le tabelle sono accessibili solo con la chiave
-- segreta (service role), che vive solo sul server (Mac / Vercel), mai sull'iPad.
alter table categorie enable row level security;
alter table articoli  enable row level security;
alter table movimenti enable row level security;

revoke execute on function registra_movimento(bigint, text, numeric, text) from public, anon, authenticated;
