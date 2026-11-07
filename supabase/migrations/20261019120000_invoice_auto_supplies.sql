-- Após 20261018170000_supplies_management.sql. Sem importação retroativa.
-- Um único commit grava o lançamento e TODOS os preços/insumos; falhas desfazem tudo.
begin;
create or replace function public.lancar_nota_com_insumos(
  p_nota_id uuid, p_empresa_id uuid, p_versao uuid, p_tipo text
) returns void language plpgsql security definer set search_path='' as $$
declare
  n public.notas_fiscais%rowtype;
  s public.insumos%rowtype;
  item jsonb;
  idx integer;
  v_nome text;
  unidade text;
  qtd numeric;
  preco numeric;
  soma numeric := 0;
begin
  if auth.uid() is null or not public.usuario_da_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode='42501'; end if;
  -- Mesma trava do cadastro manual: não cria dois insumos ao lançar notas simultâneas.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text,0));
  select * into n from public.notas_fiscais
    where id=p_nota_id and empresa_id=p_empresa_id and enviado_por=auth.uid() for update;
  if not found then raise exception 'Acesso negado.' using errcode='42501'; end if;
  -- Retry de uma confirmação ou nota antiga: não duplica nem importa retroativamente.
  if n.lancado_financeiro_em is not null then return; end if;
  if n.natureza='cost' and p_tipo='professional' then
    if jsonb_typeof(n.dados_extracao->'lineItems') is distinct from 'array'
      or jsonb_typeof(n.dados_extracao->'items') is distinct from 'array' then
      raise exception 'Revise todos os itens: nome, quantidade, unidade e preço unitário são obrigatórios.'; end if;
    if jsonb_array_length(n.dados_extracao->'lineItems') not between 1 and 200
      or jsonb_array_length(n.dados_extracao->'lineItems') <> jsonb_array_length(n.dados_extracao->'items') then
      raise exception 'Revise todos os itens: nome, quantidade, unidade e preço unitário são obrigatórios.'; end if;
    for item,idx in select value,(ordinality-1)::integer from jsonb_array_elements(n.dados_extracao->'lineItems') with ordinality loop
      if jsonb_typeof(item->'description') is distinct from 'string'
        or jsonb_typeof(item->'unit') is distinct from 'string'
        or jsonb_typeof(item->'quantity') is distinct from 'number'
        or jsonb_typeof(item->'unitPrice') is distinct from 'number' then
        raise exception 'Revise todos os itens: nome, quantidade, unidade e preço unitário são obrigatórios.'; end if;
      v_nome := btrim(item->>'description'); unidade := lower(btrim(item->>'unit'));
      qtd := (item->>'quantity')::numeric; preco := (item->>'unitPrice')::numeric;
      if char_length(v_nome) not between 1 and 120 or v_nome is distinct from n.dados_extracao->'items'->>idx
        or unidade !~ '^[a-z0-9²³]{1,12}$' or qtd<=0 or qtd>999999999 or qtd<>round(qtd,3)
        or preco<0 or preco>999999999 or preco<>round(preco,4) then
        raise exception 'Revise todos os itens: nome, quantidade, unidade e preço unitário são obrigatórios.'; end if;
      soma := soma + round(qtd*preco,2);
    end loop;
    if soma>n.valor_total then raise exception 'A soma dos itens ultrapassa o total da nota.'; end if;
  end if;
  -- Mantém CNPJ, versão, revisão, mês fechado e todas as regras financeiras existentes.
  perform public.lancar_nota_financeiro(p_nota_id,p_empresa_id,p_versao,p_tipo);
  if n.natureza='cost' and p_tipo='professional' then
    for item,idx in select value,(ordinality-1)::integer from jsonb_array_elements(n.dados_extracao->'lineItems') with ordinality loop
      v_nome := btrim(item->>'description'); unidade := lower(btrim(item->>'unit'));
      if (select count(*) from public.insumos i where i.empresa_id=p_empresa_id and lower(btrim(i.nome))=lower(v_nome)) > 1 then
        raise exception 'Há insumos duplicados com esse nome. Revise o catálogo antes de lançar.'; end if;
      select * into s from public.insumos i where i.empresa_id=p_empresa_id and lower(btrim(i.nome))=lower(v_nome) for update;
      if not found then
        select * into s from public.salvar_insumo(p_empresa_id,null,null,v_nome,unidade,0,true);
      elsif lower(btrim(s.unidade_medida)) <> unidade then
        raise exception 'Existe insumo com esse nome e outra unidade. Revise o nome ou a unidade do item; não fazemos conversão automática.';
      end if;
      perform public.registrar_preco_insumo(p_empresa_id,s.id,gen_random_uuid(),'invoice',n.id,idx,
        null,(item->>'quantity')::numeric,(item->>'unitPrice')::numeric,null);
    end loop;
  end if;
end;
$$;
-- Clientes só podem usar o fluxo atômico. A função interna continua acessível ao dono.
revoke all on function public.lancar_nota_financeiro(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.lancar_nota_com_insumos(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.lancar_nota_com_insumos(uuid,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
