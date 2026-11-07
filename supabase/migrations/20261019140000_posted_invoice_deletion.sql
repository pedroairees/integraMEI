-- Após 20261019120000_invoice_auto_supplies.sql. Não exclui dados ao aplicar.
-- Exclusão financeira auditada, seguida de limpeza retomável do Storage e da nota.
begin;
alter table public.notas_exclusoes_auditoria
  add column if not exists lancamento_removido jsonb,
  add column if not exists precos_removidos jsonb not null default '[]'::jsonb;

create or replace function public.iniciar_exclusao_nota(
  p_nota_id uuid, p_empresa_id uuid, p_versao uuid, p_justificativa text
) returns void language plpgsql security definer set search_path='' as $$
declare n public.notas_fiscais%rowtype;
begin
  if auth.uid() is null or not public.usuario_da_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_justificativa is null or char_length(btrim(p_justificativa)) not between 10 and 1000 then
    raise exception 'Informe uma justificativa de 10 a 1.000 caracteres.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text,0));
  select * into n from public.notas_fiscais
    where id=p_nota_id and empresa_id=p_empresa_id and enviado_por=auth.uid() for update;
  if not found then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if n.exclusao_solicitada_em is not null and n.exclusao_justificativa is not null
    and exists(select 1 from public.notas_exclusoes_auditoria where nota_id=n.id) then return; end if;
  if n.versao_arquivo is distinct from p_versao then raise exception 'A nota mudou. Atualize a lista antes de excluir.'; end if;
  if n.status <> 'pending_review' or exists(select 1 from public.itens_nota_fiscal where nota_fiscal_id=n.id) then
    raise exception 'Nota integrada ao estoque: a exclusão exige estorno pelo fluxo de estoque.'; end if;
  lock table public.fechamentos_mensais in share mode;
  if exists(select 1 from public.fechamentos_mensais where empresa_id=p_empresa_id
    and mes_fechado=date_trunc('month',n.data_emissao)::date) then
    raise exception 'Mês encerrado: não é possível excluir esta nota.'; end if;
  -- O trigger registra motivo/autoria. O marcador retira a nota dos indicadores.
  update public.notas_fiscais set exclusao_solicitada_em=coalesce(n.exclusao_solicitada_em,now()),
    exclusao_justificativa=btrim(p_justificativa) where id=n.id;
  update public.notas_exclusoes_auditoria set
    lancamento_removido=case when n.lancado_financeiro_em is null then null else
      jsonb_build_object('natureza',n.natureza,'tipo',n.tipo,'data_emissao',n.data_emissao,
        'valor_total',n.valor_total,'lancado_em',n.lancado_financeiro_em) end,
    precos_removidos=coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'insumo_id',p.insumo_id,
      'indice_item',p.indice_item,'data_compra',p.data_compra,'quantidade',p.quantidade,
      'unidade',p.unidade_medida,'valor_unitario',p.valor_unitario))
      from public.insumos_precos_registrados p where p.nota_fiscal_id=n.id),'[]'::jsonb)
    where nota_id=n.id;
  -- O catálogo e as compras de outras notas/manuais permanecem intactos.
  delete from public.insumos_precos_registrados where nota_fiscal_id=n.id;
end;
$$;

create or replace function public.concluir_exclusao_nota(p_nota_id uuid,p_empresa_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare n public.notas_fiscais%rowtype;
begin
  if auth.uid() is null or not public.usuario_da_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text,0));
  select * into n from public.notas_fiscais where id=p_nota_id and empresa_id=p_empresa_id
    and enviado_por=auth.uid() for update;
  if not found then return; end if;
  if n.status <> 'pending_review' or n.exclusao_solicitada_em is null or n.exclusao_justificativa is null
    or not exists(select 1 from public.notas_exclusoes_auditoria where nota_id=n.id) then
    raise exception 'Solicite a exclusão com uma justificativa antes de apagar a nota.'; end if;
  if exists(select 1 from storage.objects where bucket_id='invoice-documents' and name=n.caminho_arquivo) then
    raise exception 'A exclusão do arquivo ainda está pendente. Tente novamente.'; end if;
  if exists(select 1 from public.itens_nota_fiscal where nota_fiscal_id=n.id)
    or exists(select 1 from public.insumos_precos_registrados where nota_fiscal_id=n.id) then
    raise exception 'Ainda existem registros vinculados à nota. Exclusão não concluída.'; end if;
  lock table public.fechamentos_mensais in share mode;
  if exists(select 1 from public.fechamentos_mensais where empresa_id=p_empresa_id
    and mes_fechado=date_trunc('month',n.data_emissao)::date) then
    raise exception 'Mês encerrado: não é possível excluir esta nota.'; end if;
  delete from public.notas_fiscais where id=n.id;
end;
$$;

-- Continua proibido editar valores de uma nota lançada ou apagar diretamente via REST.
-- SECURITY INVOKER identifica a execução privilegiada das RPCs, sem confiar em GUC do cliente.
create or replace function public.proteger_nota_lancada()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.lancado_financeiro_em is not null then
    if current_user is distinct from pg_get_userbyid((select proowner from pg_proc
        where oid='public.iniciar_exclusao_nota(uuid,uuid,uuid,text)'::regprocedure))
      or auth.uid() is distinct from old.enviado_por or not public.usuario_da_empresa(old.empresa_id)
      or old.status <> 'pending_review' then
      raise exception 'Nota lançada: use a exclusão auditada.'; end if;
    if TG_OP='UPDATE' then
      if old.exclusao_solicitada_em is not null or new.exclusao_solicitada_em is null
        or new.exclusao_justificativa is null
        or char_length(btrim(new.exclusao_justificativa)) not between 10 and 1000
        or (to_jsonb(new)-'exclusao_solicitada_em'-'exclusao_justificativa'-'atualizado_em')
          is distinct from (to_jsonb(old)-'exclusao_solicitada_em'-'exclusao_justificativa'-'atualizado_em') then
        raise exception 'Nota lançada: somente a solicitação auditada de exclusão é permitida.'; end if;
    else
      if old.exclusao_solicitada_em is null or old.exclusao_justificativa is null
        or not exists(select 1 from public.notas_exclusoes_auditoria where nota_id=old.id)
        or exists(select 1 from storage.objects where bucket_id='invoice-documents' and name=old.caminho_arquivo)
        or exists(select 1 from public.insumos_precos_registrados where nota_fiscal_id=old.id)
        or exists(select 1 from public.itens_nota_fiscal where nota_fiscal_id=old.id) then
        raise exception 'Conclua a exclusão auditada e a remoção do arquivo antes de apagar a nota.'; end if;
    end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.iniciar_exclusao_nota(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.concluir_exclusao_nota(uuid,uuid) from public,anon;
grant execute on function public.iniciar_exclusao_nota(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.concluir_exclusao_nota(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
