-- Após as migrações de upload/exclusão. Preserva documentos e status do workflow de estoque.
-- Confirma somente o valor financeiro revisado, sem inventar quantidades ou preços de itens.
begin;
alter table public.notas_fiscais
  add column if not exists lancado_financeiro_em timestamptz,
  add column if not exists lancado_financeiro_por uuid references auth.users(id);
create unique index if not exists notas_lancamento_arquivo_unico
  on public.notas_fiscais(empresa_id, hash_arquivo)
  where lancado_financeiro_em is not null and hash_arquivo is not null;
create index if not exists notas_lancamento_periodo
  on public.notas_fiscais(empresa_id, data_emissao) where lancado_financeiro_em is not null;

-- A gravação financeira só é permitida pela função autenticada abaixo.
revoke update (lancado_financeiro_em, lancado_financeiro_por, tipo) on public.notas_fiscais from authenticated;
create or replace function public.proteger_nota_lancada()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.lancado_financeiro_em is not null then
    raise exception 'Nota já lançada no financeiro: edição e exclusão bloqueadas.';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_nota_lancada on public.notas_fiscais;
create trigger trg_proteger_nota_lancada before update or delete on public.notas_fiscais
for each row execute function public.proteger_nota_lancada();

create or replace function public.lancar_nota_financeiro(
  p_nota_id uuid, p_empresa_id uuid, p_versao uuid, p_tipo text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  n public.notas_fiscais%rowtype;
  own_cnpj text;
  emitter text;
  recipient text;
begin
  if auth.uid() is null or not public.usuario_da_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into n from public.notas_fiscais
    where id = p_nota_id and empresa_id = p_empresa_id and enviado_por = auth.uid() for update;
  if not found then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if n.lancado_financeiro_em is not null then return; end if;
  if n.status <> 'pending_review' or n.revisado_em is null
     or n.exclusao_solicitada_em is not null or n.versao_arquivo is distinct from p_versao then
    raise exception 'Revise e atualize a nota antes de lançar.';
  end if;
  if p_tipo is null or p_tipo not in ('professional','personal') then raise exception 'Finalidade inválida.'; end if;
  if n.data_emissao is null or n.valor_total is null or n.valor_total < 0
     or n.valor_total > 999999999.99 or n.cnpj_emissor is null
     or nullif(btrim(n.dados_extracao->>'supplier'), '') is null
     or jsonb_typeof(n.dados_extracao->'items') is distinct from 'array' then
    raise exception 'Dados mínimos ausentes.';
  end if;
  if jsonb_array_length(n.dados_extracao->'items') = 0 then raise exception 'Itens ausentes.'; end if;
  if n.data_emissao > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data futura não permitida.'; end if;
  if n.data_emissao::text is distinct from n.dados_extracao->>'date'
     or n.valor_total is distinct from (n.dados_extracao->>'total')::numeric
     or n.cnpj_emissor is distinct from n.dados_extracao->>'cnpj' then
    raise exception 'Dados divergentes da revisão.';
  end if;
  select regexp_replace(cnpj, '\D', '', 'g') into own_cnpj from public.empresas where id = p_empresa_id;
  emitter := n.dados_extracao->>'cnpj'; recipient := n.dados_extracao->>'recipientCnpj';
  if own_cnpj is null or own_cnpj !~ '^[0-9]{14}$' or emitter !~ '^[0-9]{14}$'
     or coalesce(n.dados_extracao->>'operation','') not in ('sale','service')
     or not coalesce((n.natureza='revenue' and emitter=own_cnpj and recipient is distinct from own_cnpj)
       or (n.natureza='cost' and emitter<>own_cnpj and recipient=own_cnpj), false) then
    raise exception 'CNPJ ou categoria incompatível.';
  end if;
  -- Serialize against a concurrent period closure; keep this transaction short.
  lock table public.fechamentos_mensais in share mode;
  if exists (select 1 from public.fechamentos_mensais
    where empresa_id=p_empresa_id and mes_fechado=date_trunc('month',n.data_emissao)::date) then
    raise exception 'Mês encerrado: lançamento bloqueado.';
  end if;
  -- Scope assignment is typed using the existing enum on notas_fiscais.
  n.tipo := case when n.natureza='revenue' then 'unclassified' else p_tipo end;
  update public.notas_fiscais set tipo=n.tipo, lancado_financeiro_em=now(),
    lancado_financeiro_por=auth.uid(), versao_arquivo=gen_random_uuid()
    where id=n.id;
end;
$$;
revoke all on function public.lancar_nota_financeiro(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.lancar_nota_financeiro(uuid,uuid,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
