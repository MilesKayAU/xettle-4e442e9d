-- ═══════════════════════════════════════════════════════════════
-- Fulfillment Bridge V1 — product_links + amazon_fbm_orders
-- ═══════════════════════════════════════════════════════════════

-- Table: product_links
create table public.product_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amazon_sku text not null,
  amazon_asin text,
  shopify_variant_id bigint not null,
  shopify_sku text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_links_user_sku_unique unique (user_id, amazon_sku)
);

create index idx_product_links_user_sku on public.product_links (user_id, amazon_sku);
create index idx_product_links_user_enabled on public.product_links (user_id, enabled);

alter table public.product_links enable row level security;

create policy "admin only"
  on public.product_links
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- Table: amazon_fbm_orders
create table public.amazon_fbm_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amazon_order_id text not null,
  shopify_order_id bigint,
  status text not null default 'pending',
  error_detail text,
  raw_amazon_payload jsonb,
  raw_shopify_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint amazon_fbm_orders_user_order_unique unique (user_id, amazon_order_id)
);

create index idx_amazon_fbm_orders_user_created on public.amazon_fbm_orders (user_id, created_at desc);
create index idx_amazon_fbm_orders_user_status on public.amazon_fbm_orders (user_id, status);
create index idx_amazon_fbm_orders_user_order on public.amazon_fbm_orders (user_id, amazon_order_id);

-- Reuse existing update_updated_at_column trigger function
create trigger set_updated_at_amazon_fbm_orders
  before update on public.amazon_fbm_orders
  for each row
  execute function public.update_updated_at_column();

alter table public.amazon_fbm_orders enable row level security;

create policy "admin only"
  on public.amazon_fbm_orders
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));