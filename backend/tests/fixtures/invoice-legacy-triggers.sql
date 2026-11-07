-- Isolated test fixture: function bodies exported from the existing database.
-- Intentionally keeps the missing schema qualifiers to reproduce the regression.
create or replace function public.app_bloquear_mes_fechado()
returns trigger language plpgsql as $$
declare
  row_data jsonb;
  record_business uuid;
  record_date date;
begin
  row_data := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  record_business := (row_data ->> 'empresa_id')::uuid;
  record_date := (row_data ->> TG_ARGV[0])::date;
  if record_date is not null and exists (
    select 1 from fechamentos_mensais
    where empresa_id = record_business
      and mes_fechado = date_trunc('month', record_date)::date
  ) then
    raise exception 'Registros de meses encerrados não podem ser alterados ou excluídos.';
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

create or replace function public.app_validar_nota_fiscal()
returns trigger language plpgsql as $$
declare
  candidate_business uuid;
  candidate_scope tipo_gasto;
begin
  if NEW.fornecedor_id is not null then
    select empresa_id into candidate_business from fornecedores where id = NEW.fornecedor_id;
    if candidate_business is distinct from NEW.empresa_id then
      raise exception 'O fornecedor deve pertencer ao mesmo negócio da nota.';
    end if;
  end if;
  if NEW.categoria_id is not null then
    select empresa_id, tipo into candidate_business, candidate_scope from categorias where id = NEW.categoria_id;
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

create function public.app_exigir_funcao_confirmacao()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'confirmed' and OLD.status <> 'confirmed'
     and current_setting('app.allow_document_confirmation', true) is distinct from 'on' then
    raise exception 'Use app_confirmar_nota_fiscal() para confirmar uma nota fiscal.';
  end if;
  return NEW;
end;
$$;

create function public.app_atualizar_data_modificacao()
returns trigger language plpgsql as $$
begin
  NEW.atualizado_em = now();
  return NEW;
end;
$$;

create trigger trg_closed_document before insert or update or delete on public.notas_fiscais
for each row execute function public.app_bloquear_mes_fechado('data_emissao');
create trigger trg_validate_document before insert or update on public.notas_fiscais
for each row execute function public.app_validar_nota_fiscal();
create trigger trg_confirm_transition before update on public.notas_fiscais
for each row execute function public.app_exigir_funcao_confirmacao();
create trigger trg_touch_documents before update on public.notas_fiscais
for each row execute function public.app_atualizar_data_modificacao();
