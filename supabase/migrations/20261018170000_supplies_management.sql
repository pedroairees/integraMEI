-- Catálogo e histórico de insumos. Não altera os totais das notas nem movimenta estoque.
begin;
alter table public.insumos add column if not exists versao_cadastro uuid not null default gen_random_uuid();
alter table public.insumos enable row level security;
revoke insert, update, delete on public.insumos from anon, authenticated;
grant select on public.insumos to authenticated;
drop policy if exists insumos_empresa_limite on public.insumos;
create policy insumos_empresa_limite on public.insumos as restrictive for all to authenticated
  using (public.usuario_da_empresa(empresa_id)) with check (public.usuario_da_empresa(empresa_id));
drop policy if exists insumos_empresa_leitura on public.insumos;
create policy insumos_empresa_leitura on public.insumos for select to authenticated using (public.usuario_da_empresa(empresa_id));

-- Complementa o histórico legado (que exige item_nota_fiscal_id).
-- Não cria itens fiscais fictícios para registros manuais ou notas extraídas sem quantidade.
create table if not exists public.insumos_precos_registrados (
  id uuid primary key,
  empresa_id uuid not null references public.empresas(id),
  insumo_id uuid not null references public.insumos(id),
  registrado_por uuid not null references auth.users(id),
  origem text not null check (origem in ('manual','invoice')),
  nota_fiscal_id uuid references public.notas_fiscais(id),
  indice_item integer,
  data_compra date not null,
  unidade_medida text not null,
  quantidade numeric(14,3) not null check (quantidade > 0),
  valor_unitario numeric(14,4) not null check (valor_unitario >= 0),
  fornecedor text not null check (char_length(btrim(fornecedor)) between 1 and 200),
  criado_em timestamptz not null default now(),
  check ((origem='manual' and nota_fiscal_id is null and indice_item is null)
    or (origem='invoice' and nota_fiscal_id is not null and indice_item >= 0)),
  unique(nota_fiscal_id, indice_item)
);
create index if not exists insumos_precos_periodo on public.insumos_precos_registrados(empresa_id, insumo_id, data_compra, id);
alter table public.insumos_precos_registrados enable row level security;
revoke all on public.insumos_precos_registrados from anon, authenticated;
grant select on public.insumos_precos_registrados to authenticated;
drop policy if exists insumos_precos_empresa on public.insumos_precos_registrados;
create policy insumos_precos_empresa on public.insumos_precos_registrados for select to authenticated
  using (public.usuario_da_empresa(empresa_id));

create or replace function public.salvar_insumo(
  p_empresa uuid, p_id uuid, p_versao uuid, p_nome text, p_unidade text, p_minimo numeric, p_ativo boolean
) returns public.insumos language plpgsql security definer set search_path='' as $$
declare s public.insumos%rowtype;
begin
  if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  p_nome := btrim(p_nome); p_unidade := lower(btrim(p_unidade));
  if p_nome is null or char_length(p_nome) not between 1 and 120 or p_unidade is null
    or p_unidade !~ '^[a-z0-9²³]{1,12}$' or p_minimo is null or p_minimo::text in ('NaN','Infinity','-Infinity')
    or p_minimo < 0 or p_minimo > 999999999 or p_minimo <> round(p_minimo,3) or p_ativo is null then
    raise exception 'Dados do insumo inválidos.';
  end if;
  -- Serializa cadastros/renomeações para evitar duplicidade também por caixa/espaços.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa::text,0));
  if exists(select 1 from public.insumos where empresa_id=p_empresa and lower(btrim(nome))=lower(p_nome) and id is distinct from p_id) then
    raise exception 'Já existe um insumo com esse nome.' using errcode='23505';
  end if;
  if p_id is null then
    insert into public.insumos(empresa_id,nome,unidade_medida,estoque_minimo,ativo)
      values(p_empresa,p_nome,p_unidade,p_minimo,p_ativo) returning * into s;
  else
    select * into s from public.insumos where id=p_id and empresa_id=p_empresa for update;
    if not found then raise exception 'Insumo não encontrado.' using errcode='42501'; end if;
    if s.versao_cadastro is distinct from p_versao then raise exception 'O insumo mudou. Atualize a lista.'; end if;
    if s.unidade_medida <> p_unidade then raise exception 'A unidade não pode ser alterada. Cadastre outro insumo para manter o histórico consistente.'; end if;
    update public.insumos set nome=p_nome,estoque_minimo=p_minimo,ativo=p_ativo,versao_cadastro=gen_random_uuid(),atualizado_em=now()
      where id=p_id returning * into s;
  end if;
  return s;
end;
$$;

create or replace function public.registrar_preco_insumo(
  p_empresa uuid, p_insumo uuid, p_id uuid, p_origem text, p_nota uuid, p_item integer,
  p_data date, p_quantidade numeric, p_preco numeric, p_fornecedor text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  s public.insumos%rowtype;
  n public.notas_fiscais%rowtype;
  existing public.insumos_precos_registrados%rowtype;
begin
  if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_id is null or p_origem is null or p_origem not in ('manual','invoice')
    or p_quantidade is null or p_quantidade::text in ('NaN','Infinity','-Infinity')
    or p_quantidade <= 0 or p_quantidade > 999999999 or p_quantidade <> round(p_quantidade,3)
    or p_preco is null or p_preco::text in ('NaN','Infinity','-Infinity') or p_preco < 0
    or p_preco > 999999999 or p_preco <> round(p_preco,4) then raise exception 'Quantidade ou preço inválido.'; end if;
  select * into s from public.insumos where id=p_insumo and empresa_id=p_empresa for update;
  if not found then raise exception 'Insumo não encontrado.' using errcode='42501'; end if;
  -- Idempotência após perda de resposta, sem duplicar o histórico.
  select * into existing from public.insumos_precos_registrados where id=p_id;
  if found then
    if existing.empresa_id=p_empresa and existing.insumo_id=p_insumo and existing.registrado_por=auth.uid()
      and existing.origem=p_origem and existing.nota_fiscal_id is not distinct from p_nota
      and existing.indice_item is not distinct from p_item and existing.quantidade=p_quantidade and existing.valor_unitario=p_preco
      and (p_origem='invoice' or (existing.data_compra=p_data and existing.fornecedor=btrim(p_fornecedor))) then return existing.id; end if;
    raise exception 'Identificador já utilizado.' using errcode='23505';
  end if;
  if not s.ativo then raise exception 'Reative o insumo antes de registrar preços.'; end if;
  if p_origem='invoice' then
    select * into n from public.notas_fiscais where id=p_nota and empresa_id=p_empresa and enviado_por=auth.uid() for update;
    if not found then raise exception 'Nota não encontrada.' using errcode='42501'; end if;
    if n.natureza <> 'cost' or n.tipo <> 'professional' or n.lancado_financeiro_em is null
      or n.exclusao_solicitada_em is not null or n.revisado_em is null then
      raise exception 'Use uma nota de custo profissional revisada e lançada no financeiro.';
    end if;
    if p_item is null or p_item < 0 or jsonb_typeof(n.dados_extracao->'items') is distinct from 'array'
      or p_item >= jsonb_array_length(n.dados_extracao->'items') then raise exception 'Selecione um item da nota.'; end if;
    if exists(select 1 from public.insumos_precos_registrados where nota_fiscal_id=p_nota and indice_item=p_item) then
      raise exception 'Esse item já tem preço registrado.' using errcode='23505'; end if;
    -- Um item já integrado pelo fluxo legado não deve ser contabilizado duas vezes.
    if exists(select 1 from public.itens_nota_fiscal i join public.historico_precos h on h.item_nota_fiscal_id=i.id
      where i.nota_fiscal_id=p_nota) then
      raise exception 'Essa nota já possui histórico integrado pelo fluxo de itens.' using errcode='23505'; end if;
    if round(p_quantidade*p_preco,2) + coalesce((select sum(round(quantidade*valor_unitario,2))
      from public.insumos_precos_registrados where nota_fiscal_id=p_nota),0) > n.valor_total then
      raise exception 'A soma dos itens ultrapassa o total da nota.'; end if;
    p_data := n.data_emissao; p_fornecedor := n.dados_extracao->>'supplier';
  elsif p_nota is not null or p_item is not null then raise exception 'Registro manual não pode conter nota.';
  end if;
  p_fornecedor := btrim(p_fornecedor);
  if p_data is null or p_data < date '2000-01-01' or p_data > (now() at time zone 'America/Sao_Paulo')::date
    or p_fornecedor is null or char_length(p_fornecedor) not between 1 and 200 then raise exception 'Data ou fornecedor inválido.'; end if;
  lock table public.fechamentos_mensais in share mode;
  if exists(select 1 from public.fechamentos_mensais where empresa_id=p_empresa and mes_fechado=date_trunc('month',p_data)::date) then
    raise exception 'Mês encerrado: registro de preço bloqueado.'; end if;
  insert into public.insumos_precos_registrados(id,empresa_id,insumo_id,registrado_por,origem,nota_fiscal_id,indice_item,data_compra,unidade_medida,quantidade,valor_unitario,fornecedor)
    values(p_id,p_empresa,p_insumo,auth.uid(),p_origem,p_nota,p_item,p_data,s.unidade_medida,p_quantidade,p_preco,p_fornecedor);
  return p_id;
end;
$$;
revoke all on function public.salvar_insumo(uuid,uuid,uuid,text,text,numeric,boolean) from public,anon;
grant execute on function public.salvar_insumo(uuid,uuid,uuid,text,text,numeric,boolean) to authenticated;
revoke all on function public.registrar_preco_insumo(uuid,uuid,uuid,text,uuid,integer,date,numeric,numeric,text) from public,anon;
grant execute on function public.registrar_preco_insumo(uuid,uuid,uuid,text,uuid,integer,date,numeric,numeric,text) to authenticated;
notify pgrst,'reload schema';
commit;
