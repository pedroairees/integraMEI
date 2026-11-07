-- Aplicar após 20261006120000_invoice_financial_posting.sql.
-- Corrige a resolução de nomes nas funções legadas chamadas pelo lançamento.
-- Não altera notas, permissões, triggers ou regras de negócio.
begin;

create or replace function public.app_bloquear_mes_fechado()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  row_data jsonb;
  record_business uuid;
  record_date date;
begin
  row_data := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  record_business := (row_data ->> 'empresa_id')::uuid;
  record_date := (row_data ->> TG_ARGV[0])::date;
  if record_date is not null and exists (
    select 1 from public.fechamentos_mensais
    where empresa_id = record_business
      and mes_fechado = date_trunc('month', record_date)::date
  ) then
    raise exception 'Registros de meses encerrados não podem ser alterados ou excluídos.';
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

create or replace function public.app_validar_nota_fiscal()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  candidate_business uuid;
  candidate_scope public.tipo_gasto;
begin
  if NEW.fornecedor_id is not null then
    select empresa_id into candidate_business from public.fornecedores where id = NEW.fornecedor_id;
    if candidate_business is distinct from NEW.empresa_id then
      raise exception 'O fornecedor deve pertencer ao mesmo negócio da nota.';
    end if;
  end if;
  if NEW.categoria_id is not null then
    select empresa_id, tipo into candidate_business, candidate_scope from public.categorias where id = NEW.categoria_id;
    if candidate_business is distinct from NEW.empresa_id then
      raise exception 'A categoria deve pertencer ao mesmo negócio da nota.';
    end if;
    if NEW.tipo <> 'unclassified' and candidate_scope <> NEW.tipo then
      raise exception 'A categoria precisa ter o mesmo escopo da nota.';
    end if;
  end if;
  return NEW;
end;
$$;

notify pgrst, 'reload schema';
commit;
