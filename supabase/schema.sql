create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'member',
  status text not null default 'inactive',
  current_period_end timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_status_check check (status in ('inactive', 'active', 'canceled', 'expired')),
  constraint memberships_tier_check check (tier in ('member'))
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  provider text not null default 'antom',
  payment_request_id text not null unique,
  provider_payment_id text,
  amount_minor integer not null,
  currency text not null,
  status text not null default 'checkout_created',
  checkout_url text,
  return_url text,
  raw_request jsonb,
  raw_response jsonb,
  raw_notify jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_status_check check (
    status in ('checkout_created', 'paid', 'failed', 'cancelled', 'processing', 'unknown')
    or length(status) <= 64
  )
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists memberships_period_end_idx on public.memberships (current_period_end);
create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);
create index if not exists payments_request_idx on public.payments (payment_request_id);

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.payments enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own"
  on public.memberships for select
  using (auth.uid() = user_id);

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
  on public.payments for select
  using (auth.uid() = user_id);
