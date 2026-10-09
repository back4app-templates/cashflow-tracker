-- Firmbook schema, release 0.1. Money is integer cents; quantities are integer thousandths; dates are calendar dates.
create table settings (key text primary key, value text not null default '');

create table users (
  id serial primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('owner','staff','demo')),
  created_at timestamptz not null default now()
);

create table bootstrap (id int primary key check (id = 1), done_at timestamptz not null default now());

create table sessions (
  id text primary key,
  user_id int not null references users(id) on delete cascade,
  csrf text not null,
  flash jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_user on sessions(user_id);

create table recovery_codes (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz
);

create table idempotency_keys (key text primary key, created_at timestamptz not null default now());

create table contacts (
  id serial primary key,
  name text not null,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table categories (
  id serial primary key,
  name text not null,
  kind text not null check (kind in ('income','expense')),
  is_sample boolean not null default false,
  unique (name, kind)
);

create table invoice_counters (year int primary key, last int not null default 0);

create table invoices (
  id serial primary key,
  number text unique,
  status text not null default 'draft' check (status in ('draft','issued','void')),
  contact_id int not null references contacts(id),
  contact_snapshot jsonb,
  issued_on date,
  due_on date,
  tax_label text not null default '',
  tax_rate_bp int not null default 0,
  tax_inclusive boolean not null default false,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  notes text not null default '',
  share_token text unique,
  sent_at timestamptz,
  voided_at timestamptz,
  replaced_by_id int references invoices(id),
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index invoices_contact on invoices(contact_id);
create index invoices_due on invoices(status, due_on);

create table invoice_items (
  id serial primary key,
  invoice_id int not null references invoices(id) on delete cascade,
  position int not null,
  description text not null,
  qty_milli bigint not null,
  unit_cents bigint not null,
  net_cents bigint not null,
  tax_cents bigint not null,
  gross_cents bigint not null
);
create index invoice_items_invoice on invoice_items(invoice_id);

create table payments (
  id serial primary key,
  contact_id int not null references contacts(id),
  direction text not null check (direction in ('received','refunded')),
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null default '',
  reference text not null default '',
  notes text not null default '',
  is_sample boolean not null default false,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index payments_contact on payments(contact_id);
create index payments_paid_on on payments(paid_on);

create table allocations (
  id serial primary key,
  payment_id int not null references payments(id) on delete cascade,
  invoice_id int not null references invoices(id),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);
create index allocations_invoice on allocations(invoice_id);
create index allocations_payment on allocations(payment_id);

create table bills (
  id serial primary key,
  supplier_id int not null references contacts(id),
  category_id int references categories(id),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  due_on date not null,
  status text not null default 'open' check (status in ('open','void')),
  notes text not null default '',
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index bills_due on bills(status, due_on);

create table bill_payments (
  id serial primary key,
  bill_id int not null references bills(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null default '',
  notes text not null default '',
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index bill_payments_paid_on on bill_payments(paid_on);

create table audit_log (
  id serial primary key,
  at timestamptz not null default now(),
  user_id int,
  user_name text not null default '',
  action text not null,
  entity text not null,
  entity_id text not null default '',
  details jsonb
);
