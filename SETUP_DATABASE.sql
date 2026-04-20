-- SONIA REIS CRM — Setup do banco de dados Supabase
-- Cole este SQL no Supabase > SQL Editor > New Query > Run

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  local text,
  phone text unique not null,
  created_at timestamptz default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  description text,
  total numeric,
  parcels int,
  parcel_value numeric,
  start_day int,
  payment_method text default 'pix',
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  parcel_index int,
  paid boolean default false,
  paid_at timestamptz,
  paid_amount numeric default 0,
  created_at timestamptz default now()
);

-- Permite leitura/escrita pelo app (chave pública)
alter table contacts enable row level security;
alter table sales enable row level security;
alter table payments enable row level security;

create policy "allow all" on contacts for all using (true) with check (true);
create policy "allow all" on sales for all using (true) with check (true);
create policy "allow all" on payments for all using (true) with check (true);
