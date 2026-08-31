DO $$
DECLARE
  v_business_id uuid;
  v_document_id uuid;
  history_count integer;
  increase_count integer;
  personal_amount numeric(14,2);
  minimum_data_rejected boolean := false;
BEGIN
  SELECT id INTO v_business_id FROM businesses WHERE cnpj = '12345678000195';
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Dados de demonstração não foram carregados.'; END IF;

  SELECT count(*) INTO history_count
  FROM price_history ph JOIN inputs i ON i.id = ph.input_id
  WHERE i.business_id = v_business_id AND i.name = 'Farinha de trigo';
  IF history_count <> 3 THEN
    RAISE EXCEPTION 'Histórico deveria conter 3 compras de farinha; encontrado: %.', history_count;
  END IF;

  SELECT count(*) INTO increase_count FROM alerts
  WHERE business_id = v_business_id AND kind = 'price_increase';
  IF increase_count < 1 THEN RAISE EXCEPTION 'RN-003 não gerou alerta de alta.'; END IF;

  SELECT personal_withdrawals INTO personal_amount FROM v_monthly_dashboard
  WHERE business_id = v_business_id AND month_start = DATE '2026-08-01';
  IF personal_amount <> 45.00 THEN
    RAISE EXCEPTION 'RN-005 não separou a retirada pessoal de R$ 45,00.';
  END IF;

  INSERT INTO expense_documents (business_id, status, scope, total_amount, issue_date)
  VALUES (v_business_id, 'pending_review', 'professional', 10.00, DATE '2026-08-25')
  RETURNING id INTO v_document_id;
  BEGIN
    PERFORM app_confirm_expense_document(v_document_id);
  EXCEPTION WHEN OTHERS THEN
    minimum_data_rejected := position('dados mínimos' IN SQLERRM) > 0;
  END;
  IF NOT minimum_data_rejected THEN RAISE EXCEPTION 'RN-001 não bloqueou nota incompleta.'; END IF;
  DELETE FROM expense_documents WHERE id = v_document_id;
END;
$$;

BEGIN;
DO $$
DECLARE
  v_business_id uuid;
  closed_period_rejected boolean := false;
BEGIN
  SELECT id INTO v_business_id FROM businesses WHERE cnpj = '12345678000195';
  INSERT INTO accounting_period_closures (business_id, closed_month)
  VALUES (v_business_id, DATE '2026-08-01');
  BEGIN
    UPDATE sales SET total_amount = total_amount + 1
    WHERE business_id = v_business_id AND occurred_on = DATE '2026-08-20';
  EXCEPTION WHEN OTHERS THEN
    closed_period_rejected := position('meses encerrados' IN SQLERRM) > 0;
  END;
  IF NOT closed_period_rejected THEN RAISE EXCEPTION 'RN-006 não bloqueou o período fechado.'; END IF;
END;
$$;
ROLLBACK;

SELECT 'Todos os testes de banco foram aprovados.' AS result;
