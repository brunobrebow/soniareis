-- Sonia Reis CRM — Database Schema
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, local text, phone text UNIQUE NOT NULL,
  birthday date, cpf text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  description text, total numeric, parcels int, parcel_value numeric,
  start_day int, payment_method text DEFAULT 'pix', category text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid REFERENCES sales(id) ON DELETE CASCADE,
  parcel_index int, paid boolean DEFAULT false, paid_at timestamptz,
  paid_amount numeric DEFAULT 0, created_at timestamptz DEFAULT now()
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON payments FOR ALL USING (true) WITH CHECK (true);
