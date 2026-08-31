-- Dados de demonstração carregados apenas no banco local criado pelo Compose.
-- O prefixo 999 garante sua execução depois do esquema.

DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_supplier_id uuid;
  v_material_category_id uuid;
  v_personal_category_id uuid;
  v_flour_id uuid;
  v_chocolate_id uuid;
  v_product_id uuid;
  v_document_id uuid;
BEGIN
  INSERT INTO app_users (full_name, email)
  VALUES ('Usuária de Demonstração', 'demo@integramei.local')
  RETURNING id INTO v_user_id;

  INSERT INTO businesses (
    legal_name, trade_name, cnpj, monthly_revenue_goal, price_alert_threshold_percentage
  )
  VALUES (
    'Confeitaria IntegraMEI LTDA', 'Confeitaria da Ana', '12345678000195', 8000.00, 10.00
  )
  RETURNING id INTO v_business_id;

  INSERT INTO business_members (business_id, user_id) VALUES (v_business_id, v_user_id);
  INSERT INTO categories (business_id, name, scope, code) VALUES
    (v_business_id, 'Matéria-prima', 'professional', 'material'),
    (v_business_id, 'Retirada pessoal', 'personal', 'withdrawal');
  SELECT id INTO v_material_category_id FROM categories WHERE business_id = v_business_id AND code = 'material';
  SELECT id INTO v_personal_category_id FROM categories WHERE business_id = v_business_id AND code = 'withdrawal';

  INSERT INTO suppliers (business_id, legal_name, tax_id)
  VALUES (v_business_id, 'Mercado Central LTDA', '98765432000110')
  RETURNING id INTO v_supplier_id;

  INSERT INTO inputs (business_id, name, base_unit, stock_minimum_quantity) VALUES
    (v_business_id, 'Farinha de trigo', 'kg', 5),
    (v_business_id, 'Chocolate em pó', 'kg', 2);
  SELECT id INTO v_flour_id FROM inputs WHERE business_id = v_business_id AND name = 'Farinha de trigo';
  SELECT id INTO v_chocolate_id FROM inputs WHERE business_id = v_business_id AND name = 'Chocolate em pó';

  -- As três compras de farinha exercitam o histórico e o alerta de alta.
  INSERT INTO expense_documents (
    business_id, supplier_id, category_id, issuer_tax_id, document_number,
    issue_date, total_amount, scope, status, extraction_confidence
  )
  VALUES (
    v_business_id, v_supplier_id, v_material_category_id, '98765432000110', 'NF-1001',
    DATE '2026-06-10', 20.00, 'professional', 'pending_review', 0.99
  )
  RETURNING id INTO v_document_id;
  INSERT INTO expense_document_items (
    expense_document_id, input_id, description, quantity, unit, unit_price, line_total
  )
  VALUES (v_document_id, v_flour_id, 'Farinha de trigo', 2, 'kg', 10.00, 20.00);
  PERFORM app_confirm_expense_document(v_document_id);

  INSERT INTO expense_documents (
    business_id, supplier_id, category_id, issuer_tax_id, document_number,
    issue_date, total_amount, scope, status, extraction_confidence
  )
  VALUES (
    v_business_id, v_supplier_id, v_material_category_id, '98765432000110', 'NF-1037',
    DATE '2026-07-12', 22.00, 'professional', 'pending_review', 0.98
  )
  RETURNING id INTO v_document_id;
  INSERT INTO expense_document_items (
    expense_document_id, input_id, description, quantity, unit, unit_price, line_total
  )
  VALUES (v_document_id, v_flour_id, 'Farinha de trigo', 2, 'kg', 11.00, 22.00);
  PERFORM app_confirm_expense_document(v_document_id);

  INSERT INTO expense_documents (
    business_id, supplier_id, category_id, issuer_tax_id, document_number,
    issue_date, total_amount, scope, status, extraction_confidence
  )
  VALUES (
    v_business_id, v_supplier_id, v_material_category_id, '98765432000110', 'NF-1075',
    DATE '2026-08-14', 26.00, 'professional', 'pending_review', 0.97
  )
  RETURNING id INTO v_document_id;
  INSERT INTO expense_document_items (
    expense_document_id, input_id, description, quantity, unit, unit_price, line_total
  )
  VALUES (v_document_id, v_flour_id, 'Farinha de trigo', 2, 'kg', 13.00, 26.00);
  PERFORM app_confirm_expense_document(v_document_id);

  INSERT INTO expense_documents (
    business_id, supplier_id, category_id, issuer_tax_id, document_number,
    issue_date, total_amount, scope, status, extraction_confidence
  )
  VALUES (
    v_business_id, v_supplier_id, v_material_category_id, '98765432000110', 'NF-1076',
    DATE '2026-08-14', 12.00, 'professional', 'pending_review', 0.97
  )
  RETURNING id INTO v_document_id;
  INSERT INTO expense_document_items (
    expense_document_id, input_id, description, quantity, unit, unit_price, line_total
  )
  VALUES (v_document_id, v_chocolate_id, 'Chocolate em pó', 1, 'kg', 12.00, 12.00);
  PERFORM app_confirm_expense_document(v_document_id);

  INSERT INTO expense_documents (
    business_id, supplier_id, category_id, issuer_tax_id, document_number,
    issue_date, total_amount, scope, status, extraction_confidence
  )
  VALUES (
    v_business_id, v_supplier_id, v_personal_category_id, '98765432000110', 'RC-23',
    DATE '2026-08-15', 45.00, 'personal', 'pending_review', 0.93
  )
  RETURNING id INTO v_document_id;
  INSERT INTO expense_document_items (
    expense_document_id, description, quantity, unit, unit_price, line_total
  )
  VALUES (v_document_id, 'Almoço pessoal', 1, 'un', 45.00, 45.00);
  PERFORM app_confirm_expense_document(v_document_id);

  INSERT INTO products (
    business_id, name, base_cost, desired_markup_percentage, current_sale_price
  )
  VALUES (v_business_id, 'Bolo de chocolate', 2.00, 100.00, 32.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_input_requirements (product_id, input_id, quantity) VALUES
    (v_product_id, v_flour_id, 0.5),
    (v_product_id, v_chocolate_id, 0.1);
  INSERT INTO sales (business_id, product_id, occurred_on, total_amount, quantity, note) VALUES
    (v_business_id, v_product_id, DATE '2026-07-20', 640.00, 20, 'Vendas de julho'),
    (v_business_id, v_product_id, DATE '2026-08-20', 960.00, 30, 'Vendas de agosto');
END;
$$;
