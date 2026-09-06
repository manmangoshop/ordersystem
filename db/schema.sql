CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  image_url text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  name text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  shelf_life_days integer,
  weight_kg numeric(10,3),
  image_url text,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_code text NOT NULL UNIQUE,
  received_at date,
  expiry_date date,
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  remaining_qty integer NOT NULL DEFAULT 0 CHECK (remaining_qty >= 0),
  unit_cost_cents integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  exchange_rate numeric(12,6),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT '官網',
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','processing','shipped','completed','cancelled')),
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  email text NOT NULL,
  line_name text NOT NULL,
  shipping_method text NOT NULL CHECK (shipping_method IN ('超商取貨','宅配到府')),
  address text NOT NULL,
  tax_id text,
  note text,
  subtotal_cents integer NOT NULL,
  discount_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  shipping_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','reported','paid','refunded')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN ('unfulfilled','allocated','shipped','delivered','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku text NOT NULL,
  product_name text NOT NULL,
  unit_price_cents integer NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS order_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE(order_item_id, batch_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase','sale','cancel','return','waste','adjustment')),
  quantity integer NOT NULL CHECK (quantity <> 0),
  reference_type text,
  reference_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_batches_fifo_idx ON inventory_batches(product_id, expiry_date, received_at) WHERE remaining_qty > 0;
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements(product_id, created_at DESC);

INSERT INTO settings(key, value) VALUES
  ('store_status', '"OPEN"'::jsonb),
  ('shipping', '{"storeFee":60,"storeFreeAt":1500,"homeFee":210,"homeFreeAt":3000}'::jsonb),
  ('promotion', '{"twoItemRate":0.95}'::jsonb)
ON CONFLICT (key) DO NOTHING;
