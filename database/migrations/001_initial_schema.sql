-- IntegraMEI - esquema inicial PostgreSQL.
-- Compatível com PostgreSQL 16 e Supabase PostgreSQL.
-- Credenciais pertencem ao provedor de autenticação; este banco guarda o perfil
-- da aplicação e o vínculo do usuário com o negócio.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE document_status AS ENUM ('processing', 'pending_review', 'confirmed', 'rejected', 'failed');
CREATE TYPE expense_scope AS ENUM ('professional', 'personal', 'unclassified');
CREATE TYPE movement_kind AS ENUM ('purchase', 'consumption', 'adjustment');
CREATE TYPE alert_kind AS ENUM ('price_increase', 'price_decrease', 'restock', 'strategic_purchase');
CREATE TYPE task_status AS ENUM ('open', 'completed', 'dismissed');
CREATE TYPE report_format AS ENUM ('pdf', 'xlsx');

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject uuid UNIQUE,
  full_name text NOT NULL,
  email citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  cnpj varchar(14) NOT NULL UNIQUE CHECK (cnpj ~ '^[0-9]{14}$'),
  monthly_revenue_goal numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_revenue_goal >= 0),
  price_alert_threshold_percentage numeric(5,2) NOT NULL DEFAULT 10
    CHECK (price_alert_threshold_percentage > 0 AND price_alert_threshold_percentage <= 100),
  tax_rate_percentage numeric(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate_percentage >= 0 AND tax_rate_percentage < 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_members (
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member', 'accountant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  legal_name text NOT NULL,
  tax_id varchar(14) CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{14}$'),
  email citext,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (business_id, tax_id)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  name text NOT NULL,
  scope expense_scope NOT NULL CHECK (scope <> 'unclassified'),
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);

CREATE TABLE inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  name text NOT NULL,
  base_unit text NOT NULL CHECK (btrim(base_unit) <> ''),
  stock_minimum_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (stock_minimum_quantity >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE expense_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers ON DELETE SET NULL,
  category_id uuid REFERENCES categories ON DELETE SET NULL,
  issuer_tax_id varchar(14) CHECK (issuer_tax_id IS NULL OR issuer_tax_id ~ '^[0-9]{14}$'),
  document_number text,
  issue_date date,
  total_amount numeric(14,2) CHECK (total_amount IS NULL OR total_amount >= 0),
  scope expense_scope NOT NULL DEFAULT 'unclassified',
  status document_status NOT NULL DEFAULT 'processing',
  extraction_confidence numeric(5,4)
    CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  storage_path text,
  extraction_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_note text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expense_document_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_document_id uuid NOT NULL REFERENCES expense_documents ON DELETE CASCADE,
  input_id uuid REFERENCES inputs ON DELETE SET NULL,
  description text NOT NULL CHECK (btrim(description) <> ''),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  input_id uuid NOT NULL REFERENCES inputs ON DELETE CASCADE,
  expense_document_item_id uuid UNIQUE REFERENCES expense_document_items ON DELETE SET NULL,
  kind movement_kind NOT NULL,
  quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
  occurred_on date NOT NULL DEFAULT current_date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'purchase' AND quantity_delta > 0)
    OR (kind = 'consumption' AND quantity_delta < 0)
    OR kind = 'adjustment'
  )
);

CREATE TABLE price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  input_id uuid NOT NULL REFERENCES inputs ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers ON DELETE SET NULL,
  expense_document_item_id uuid NOT NULL UNIQUE REFERENCES expense_document_items ON DELETE CASCADE,
  purchased_on date NOT NULL,
  unit text NOT NULL,
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  name text NOT NULL,
  base_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_cost >= 0),
  desired_markup_percentage numeric(6,2) NOT NULL DEFAULT 100 CHECK (desired_markup_percentage >= 0),
  current_sale_price numeric(14,2) CHECK (current_sale_price IS NULL OR current_sale_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE product_input_requirements (
  product_id uuid NOT NULL REFERENCES products ON DELETE CASCADE,
  input_id uuid NOT NULL REFERENCES inputs ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (product_id, input_id)
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  product_id uuid REFERENCES products ON DELETE SET NULL,
  occurred_on date NOT NULL,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  input_id uuid REFERENCES inputs ON DELETE SET NULL,
  kind alert_kind NOT NULL,
  percentage_change numeric(8,2),
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  input_id uuid NOT NULL REFERENCES inputs ON DELETE CASCADE,
  recommended_quantity numeric(14,3) CHECK (recommended_quantity IS NULL OR recommended_quantity > 0),
  status task_status NOT NULL DEFAULT 'open',
  note text,
  due_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounting_period_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  closed_month date NOT NULL CHECK (closed_month = date_trunc('month', closed_month)::date),
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by_user_id uuid REFERENCES app_users ON DELETE SET NULL,
  note text,
  UNIQUE (business_id, closed_month)
);

CREATE TABLE report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES app_users ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  scope expense_scope NOT NULL DEFAULT 'professional' CHECK (scope <> 'unclassified'),
  format report_format NOT NULL,
  storage_path text,
  recipient_email citext,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_documents_business_date ON expense_documents (business_id, issue_date DESC);
CREATE INDEX idx_expense_documents_pending ON expense_documents (business_id, status)
  WHERE status IN ('processing', 'pending_review');
CREATE INDEX idx_document_items_document ON expense_document_items (expense_document_id);
CREATE INDEX idx_price_history_input_date ON price_history (input_id, purchased_on DESC);
CREATE INDEX idx_inventory_input_date ON inventory_movements (input_id, occurred_on DESC);
CREATE INDEX idx_sales_business_date ON sales (business_id, occurred_on DESC);
CREATE INDEX idx_alerts_business_unread ON alerts (business_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE OR REPLACE FUNCTION app_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_validate_document()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate_business uuid;
  candidate_scope expense_scope;
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT business_id INTO candidate_business FROM suppliers WHERE id = NEW.supplier_id;
    IF candidate_business IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'O fornecedor deve pertencer ao mesmo negócio da nota.';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    SELECT business_id, scope INTO candidate_business, candidate_scope FROM categories WHERE id = NEW.category_id;
    IF candidate_business IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'A categoria deve pertencer ao mesmo negócio da nota.';
    END IF;
    IF NEW.scope <> 'unclassified' AND candidate_scope <> NEW.scope THEN
      RAISE EXCEPTION 'A categoria precisa ter o mesmo escopo da nota.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_validate_item_input()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document_business uuid;
  input_business uuid;
BEGIN
  IF NEW.input_id IS NULL THEN RETURN NEW; END IF;
  SELECT business_id INTO document_business FROM expense_documents WHERE id = NEW.expense_document_id;
  SELECT business_id INTO input_business FROM inputs WHERE id = NEW.input_id;
  IF document_business IS DISTINCT FROM input_business THEN
    RAISE EXCEPTION 'O insumo deve pertencer ao mesmo negócio da nota.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_prevent_closed_period()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  record_business uuid;
  record_date date;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  record_business := (row_data ->> 'business_id')::uuid;
  record_date := (row_data ->> TG_ARGV[0])::date;
  IF record_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM accounting_period_closures
    WHERE business_id = record_business
      AND closed_month = date_trunc('month', record_date)::date
  ) THEN
    RAISE EXCEPTION 'Registros de meses encerrados não podem ser alterados ou excluídos.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION app_prevent_closed_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document_id uuid;
  record_business uuid;
  record_date date;
BEGIN
  document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_document_id ELSE NEW.expense_document_id END;
  SELECT business_id, issue_date INTO record_business, record_date FROM expense_documents WHERE id = document_id;
  IF record_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM accounting_period_closures
    WHERE business_id = record_business
      AND closed_month = date_trunc('month', record_date)::date
  ) THEN
    RAISE EXCEPTION 'Itens de notas de meses encerrados não podem ser alterados ou excluídos.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION app_only_confirm_with_function()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed'
     AND current_setting('app.allow_document_confirmation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use app.confirm_expense_document() para confirmar uma nota fiscal.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_create_price_alert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reference_price numeric(14,4);
  variation numeric(8,2);
  threshold numeric(5,2);
BEGIN
  SELECT price_alert_threshold_percentage INTO threshold FROM businesses WHERE id = NEW.business_id;
  SELECT avg(unit_price) INTO reference_price
  FROM price_history
  WHERE input_id = NEW.input_id
    AND id <> NEW.id
    AND purchased_on >= NEW.purchased_on - INTERVAL '90 days'
    AND purchased_on < NEW.purchased_on;
  IF reference_price IS NULL OR reference_price = 0 THEN RETURN NEW; END IF;
  variation := round(((NEW.unit_price - reference_price) / reference_price) * 100, 2);
  IF variation > threshold THEN
    INSERT INTO alerts (business_id, input_id, kind, percentage_change, message, metadata)
    VALUES (
      NEW.business_id, NEW.input_id, 'price_increase', variation,
      format('Alerta de inflação: aumento de %s%% identificado no insumo.', variation),
      jsonb_build_object('reference_price', reference_price, 'current_price', NEW.unit_price)
    );
  ELSIF variation <= -5 THEN
    INSERT INTO alerts (business_id, input_id, kind, percentage_change, message, metadata)
    VALUES
      (
        NEW.business_id, NEW.input_id, 'price_decrease', variation,
        format('Redução de custo: este insumo está %s%% mais barato.', abs(variation)),
        jsonb_build_object('reference_price', reference_price, 'current_price', NEW.unit_price)
      ),
      (
        NEW.business_id, NEW.input_id, 'strategic_purchase', variation,
        'Momento ideal para compra: houve redução relevante no preço do insumo.',
        jsonb_build_object('reference_price', reference_price, 'current_price', NEW.unit_price)
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_create_restock_task()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  min_stock numeric(14,3);
  stock numeric(14,3);
BEGIN
  SELECT stock_minimum_quantity INTO min_stock FROM inputs WHERE id = NEW.input_id;
  SELECT coalesce(sum(quantity_delta), 0) INTO stock FROM inventory_movements WHERE input_id = NEW.input_id;
  IF min_stock > 0 AND stock < min_stock AND NOT EXISTS (
    SELECT 1 FROM purchase_tasks WHERE business_id = NEW.business_id AND input_id = NEW.input_id AND status = 'open'
  ) THEN
    INSERT INTO purchase_tasks (business_id, input_id, recommended_quantity, note)
    VALUES (NEW.business_id, NEW.input_id, min_stock - stock, 'Estoque abaixo do mínimo configurado.');
    INSERT INTO alerts (business_id, input_id, kind, message)
    VALUES (NEW.business_id, NEW.input_id, 'restock', 'Estoque mínimo atingido: uma tarefa de compra foi criada.');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_confirm_expense_document(p_document_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  document_row expense_documents%ROWTYPE;
  item_row expense_document_items%ROWTYPE;
  item_count integer;
  input_base_unit text;
BEGIN
  SELECT * INTO document_row FROM expense_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota fiscal não encontrada.'; END IF;
  IF document_row.status <> 'pending_review' THEN
    RAISE EXCEPTION 'Somente notas aguardando revisão podem ser confirmadas.';
  END IF;
  SELECT count(*) INTO item_count FROM expense_document_items WHERE expense_document_id = p_document_id;
  IF document_row.issuer_tax_id IS NULL OR document_row.issue_date IS NULL
     OR document_row.total_amount IS NULL OR document_row.supplier_id IS NULL
     OR document_row.scope = 'unclassified' OR item_count = 0 THEN
    RAISE EXCEPTION 'A nota não atende aos dados mínimos para confirmação. Mantenha-a pendente para revisão.';
  END IF;
  PERFORM set_config('app.allow_document_confirmation', 'on', true);
  UPDATE expense_documents SET status = 'confirmed', confirmed_at = now() WHERE id = p_document_id;
  FOR item_row IN SELECT * FROM expense_document_items WHERE expense_document_id = p_document_id LOOP
    IF item_row.input_id IS NOT NULL THEN
      INSERT INTO price_history (
        business_id, input_id, supplier_id, expense_document_item_id, purchased_on, unit, unit_price
      )
      VALUES (
        document_row.business_id, item_row.input_id, document_row.supplier_id, item_row.id,
        document_row.issue_date, item_row.unit, item_row.unit_price
      )
      ON CONFLICT (expense_document_item_id) DO NOTHING;
      SELECT i.base_unit INTO input_base_unit FROM inputs i WHERE i.id = item_row.input_id;
      IF document_row.scope = 'professional' AND item_row.unit = input_base_unit THEN
        INSERT INTO inventory_movements (
          business_id, input_id, expense_document_item_id, kind, quantity_delta, occurred_on, note
        )
        VALUES (
          document_row.business_id, item_row.input_id, item_row.id, 'purchase', item_row.quantity,
          document_row.issue_date, 'Entrada gerada pela confirmação da nota fiscal.'
        )
        ON CONFLICT (expense_document_item_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE TRIGGER trg_touch_app_users BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_businesses BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_suppliers BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_categories BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_inputs BEFORE UPDATE ON inputs FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_documents BEFORE UPDATE ON expense_documents FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_items BEFORE UPDATE ON expense_document_items FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_inventory BEFORE UPDATE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_products BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_sales BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_touch_tasks BEFORE UPDATE ON purchase_tasks FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER trg_validate_document BEFORE INSERT OR UPDATE ON expense_documents FOR EACH ROW EXECUTE FUNCTION app_validate_document();
CREATE TRIGGER trg_validate_item BEFORE INSERT OR UPDATE ON expense_document_items FOR EACH ROW EXECUTE FUNCTION app_validate_item_input();
CREATE TRIGGER trg_confirm_transition BEFORE UPDATE OF status ON expense_documents FOR EACH ROW EXECUTE FUNCTION app_only_confirm_with_function();
CREATE TRIGGER trg_closed_document BEFORE INSERT OR UPDATE OR DELETE ON expense_documents FOR EACH ROW EXECUTE FUNCTION app_prevent_closed_period('issue_date');
CREATE TRIGGER trg_closed_item BEFORE INSERT OR UPDATE OR DELETE ON expense_document_items FOR EACH ROW EXECUTE FUNCTION app_prevent_closed_item();
CREATE TRIGGER trg_closed_inventory BEFORE INSERT OR UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION app_prevent_closed_period('occurred_on');
CREATE TRIGGER trg_closed_sale BEFORE INSERT OR UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION app_prevent_closed_period('occurred_on');
CREATE TRIGGER trg_price_alert AFTER INSERT ON price_history FOR EACH ROW EXECUTE FUNCTION app_create_price_alert();
CREATE TRIGGER trg_restock AFTER INSERT OR UPDATE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION app_create_restock_task();

CREATE VIEW v_input_stock AS
SELECT i.business_id, i.id AS input_id, i.name AS input_name, i.base_unit, i.stock_minimum_quantity,
  coalesce(sum(m.quantity_delta), 0) AS current_quantity,
  coalesce(sum(m.quantity_delta), 0) < i.stock_minimum_quantity AS is_below_minimum
FROM inputs i
LEFT JOIN inventory_movements m ON m.input_id = i.id
GROUP BY i.business_id, i.id, i.name, i.base_unit, i.stock_minimum_quantity;

CREATE VIEW v_input_price_history AS
SELECT ph.business_id, ph.input_id, i.name AS input_name, ph.purchased_on, ph.unit, ph.unit_price,
  s.legal_name AS supplier_name, s.tax_id AS supplier_tax_id
FROM price_history ph
JOIN inputs i ON i.id = ph.input_id
LEFT JOIN suppliers s ON s.id = ph.supplier_id;

CREATE VIEW v_monthly_dashboard AS
WITH sale_month AS (
  SELECT business_id, date_trunc('month', occurred_on)::date AS month_start, sum(total_amount) AS revenue
  FROM sales GROUP BY business_id, date_trunc('month', occurred_on)::date
), expense_month AS (
  SELECT business_id, date_trunc('month', issue_date)::date AS month_start,
    sum(total_amount) FILTER (WHERE scope = 'professional') AS professional_expenses,
    sum(total_amount) FILTER (WHERE scope = 'personal') AS personal_withdrawals
  FROM expense_documents WHERE status = 'confirmed'
  GROUP BY business_id, date_trunc('month', issue_date)::date
)
SELECT coalesce(s.business_id, e.business_id) AS business_id, coalesce(s.month_start, e.month_start) AS month_start,
  coalesce(s.revenue, 0)::numeric(14,2) AS revenue,
  coalesce(e.professional_expenses, 0)::numeric(14,2) AS professional_expenses,
  coalesce(e.personal_withdrawals, 0)::numeric(14,2) AS personal_withdrawals,
  (coalesce(s.revenue, 0) - coalesce(e.professional_expenses, 0))::numeric(14,2) AS net_profit
FROM sale_month s FULL JOIN expense_month e ON e.business_id = s.business_id AND e.month_start = s.month_start;

CREATE VIEW v_product_price_suggestions AS
WITH cost AS (
  SELECT p.id AS product_id, p.business_id, p.name, p.base_cost, p.desired_markup_percentage,
    p.current_sale_price, count(pir.input_id) FILTER (WHERE latest.unit_price IS NOT NULL) AS priced_input_count,
    coalesce(sum(pir.quantity * latest.unit_price), 0) AS input_cost
  FROM products p
  LEFT JOIN product_input_requirements pir ON pir.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT unit_price FROM price_history ph WHERE ph.input_id = pir.input_id
    ORDER BY purchased_on DESC, created_at DESC LIMIT 1
  ) latest ON true
  GROUP BY p.id, p.business_id, p.name, p.base_cost, p.desired_markup_percentage, p.current_sale_price
)
SELECT c.product_id, c.business_id, c.name AS product_name,
  round((c.base_cost + c.input_cost)::numeric, 2) AS production_cost,
  c.desired_markup_percentage,
  CASE WHEN c.base_cost + c.input_cost = 0 OR c.priced_input_count = 0 THEN NULL
       ELSE round(((c.base_cost + c.input_cost) * (1 + b.tax_rate_percentage / 100)
                   * (1 + c.desired_markup_percentage / 100))::numeric, 2)
  END AS suggested_sale_price,
  c.current_sale_price
FROM cost c JOIN businesses b ON b.id = c.business_id;

COMMIT;
