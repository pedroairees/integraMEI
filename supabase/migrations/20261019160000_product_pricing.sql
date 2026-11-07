-- US006 / RN-002. Apply after supplies_management and invoice_auto_supplies.
-- Preserves products and recipes; no sales, stock or financial postings are created.
begin;
alter table public.produtos add column if not exists versao_precificacao uuid not null default gen_random_uuid();
alter table public.produtos add column if not exists unidades_previstas integer not null default 0 check (unidades_previstas between 0 and 1000000);
alter table public.produtos add column if not exists custo_referencia numeric(14,2);

alter table public.produtos enable row level security;
alter table public.insumos_produto enable row level security;
revoke all on public.produtos, public.insumos_produto from anon, authenticated;
grant select on public.produtos, public.insumos_produto to authenticated;
-- Restrictive policies also constrain any older permissive policies.
drop policy if exists pricing_product_tenant on public.produtos;
create policy pricing_product_tenant on public.produtos as restrictive for all to authenticated
  using (public.usuario_da_empresa(empresa_id)) with check (public.usuario_da_empresa(empresa_id));
drop policy if exists pricing_recipe_tenant on public.insumos_produto;
create policy pricing_recipe_tenant on public.insumos_produto as restrictive for all to authenticated
  using (exists(select 1 from public.produtos p where p.id=produto_id and public.usuario_da_empresa(p.empresa_id)))
  with check (exists(select 1 from public.produtos p where p.id=produto_id and public.usuario_da_empresa(p.empresa_id))
    and exists(select 1 from public.insumos i join public.produtos p on p.empresa_id=i.empresa_id where p.id=produto_id and i.id=insumo_id));
drop policy if exists pricing_product_read on public.produtos;
create policy pricing_product_read on public.produtos for select to authenticated using(public.usuario_da_empresa(empresa_id));
drop policy if exists pricing_recipe_read on public.insumos_produto;
create policy pricing_recipe_read on public.insumos_produto for select to authenticated using(exists(select 1 from public.produtos p where p.id=produto_id and public.usuario_da_empresa(p.empresa_id)));

-- Internal helper. Latest professional purchase, in the supply's exact base unit.
-- A deleted invoice or unposted/personal purchase never contributes to this cost.
create or replace function public.precificacao_ultimo_preco(p_empresa uuid,p_insumo uuid)
returns table(preco numeric,data date) language sql stable security definer set search_path='' as $$
 select x.preco,x.data from (
   select h.valor_unitario preco,h.data_compra data,h.criado_em,h.id
   from public.insumos_precos_registrados h
   join public.insumos i on i.id=h.insumo_id and i.empresa_id=h.empresa_id
   left join public.notas_fiscais n on n.id=h.nota_fiscal_id and n.empresa_id=h.empresa_id
   where h.empresa_id=p_empresa and h.insumo_id=p_insumo and h.unidade_medida=i.unidade_medida
     and h.data_compra <= (now() at time zone 'America/Sao_Paulo')::date
     and (h.origem='manual' or (n.natureza='cost' and n.tipo='professional' and n.lancado_financeiro_em is not null and n.exclusao_solicitada_em is null))
   union all
   select h.valor_unitario,h.data_compra,h.criado_em,h.id
   from public.historico_precos h
   join public.insumos i on i.id=h.insumo_id and i.empresa_id=h.empresa_id
   join public.itens_nota_fiscal it on it.id=h.item_nota_fiscal_id
   join public.notas_fiscais n on n.id=it.nota_fiscal_id and n.empresa_id=h.empresa_id
   where h.empresa_id=p_empresa and h.insumo_id=p_insumo and h.unidade_medida=i.unidade_medida
     and h.data_compra <= (now() at time zone 'America/Sao_Paulo')::date
     and n.natureza='cost' and n.tipo='professional' and n.status='confirmed' and n.exclusao_solicitada_em is null
 ) x order by x.data desc,x.criado_em desc,x.id desc limit 1;
$$;
revoke all on function public.precificacao_ultimo_preco(uuid,uuid) from public,anon,authenticated;

create or replace function public.dados_precificacao(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if (select count(*) from public.produtos where empresa_id=p_empresa)>500 or (select count(*) from public.insumos where empresa_id=p_empresa)>2000 then
   raise exception 'Catálogo muito grande para esta tela.';
 end if;
 select jsonb_build_object('tax',e.imposto_percentual,
 'products',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'version',p.versao_precificacao,'name',p.nome,'baseCost',p.custo_base,'markup',p.markup_padrao,
   'currentPrice',p.preco_venda,'monthlyUnits',p.unidades_previstas,'referenceCost',p.custo_referencia,'active',p.ativo,
   'ingredients',coalesce((select jsonb_agg(jsonb_build_object('supplyId',ip.insumo_id,'quantity',ip.quantidade) order by ip.insumo_id) from public.insumos_produto ip where ip.produto_id=p.id),'[]'::jsonb)) order by p.nome,p.id)
   from public.produtos p where p.empresa_id=p_empresa),'[]'::jsonb),
 'supplies',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.nome,'unit',i.unidade_medida,'active',i.ativo,'price',v.preco,'date',v.data) order by i.nome,i.id)
   from public.insumos i left join lateral public.precificacao_ultimo_preco(p_empresa,i.id) v on true where i.empresa_id=p_empresa),'[]'::jsonb)) into result
 from public.empresas e where e.id=p_empresa;
 return result;
end $$;

create or replace function public.calcular_precificacao(p_empresa uuid,p_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base numeric; markup numeric; tax numeric; total numeric; inputs numeric:=0; price numeric; gross_cost numeric; profit numeric;
 units integer; current_price numeric; item jsonb; supply public.insumos; unit_price numeric; quantity numeric; seen uuid[]:='{}'; lines jsonb:='[]';
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if jsonb_typeof(p_dados) is distinct from 'object' or jsonb_typeof(p_dados->'ingredients') is distinct from 'array' then raise exception 'Dados de precificação inválidos.'; end if;
 base:=(p_dados->>'baseCost')::numeric; markup:=(p_dados->>'markup')::numeric; units:=(p_dados->>'monthlyUnits')::integer; current_price:=(p_dados->>'currentPrice')::numeric;
 if base is null or base<0 or base>999999999 or base<>round(base,2) or markup is null or markup<0 or markup>9999.99 or markup<>round(markup,2)
   or units is null or units<0 or units>1000000 or (current_price is not null and (current_price<0 or current_price>999999999 or current_price<>round(current_price,2)))
   or length(trim(coalesce(p_dados->>'name','')))=0 or length(trim(p_dados->>'name'))>160 or jsonb_array_length(p_dados->'ingredients')>50 then raise exception 'Dados de precificação inválidos.'; end if;
 for item in select value from jsonb_array_elements(p_dados->'ingredients') loop
   select * into supply from public.insumos where id=(item->>'supplyId')::uuid and empresa_id=p_empresa;
   if not found then raise exception 'Insumo não encontrado.' using errcode='42501'; end if;
   if not supply.ativo then raise exception 'Há insumo inativo na composição.'; end if;
   quantity:=(item->>'quantity')::numeric;
   if quantity is null or quantity<=0 or quantity>999999999 or quantity<>round(quantity,3) or supply.id=any(seen) then raise exception 'Quantidade inválida ou insumo repetido.'; end if;
   seen:=array_append(seen,supply.id);
   select preco into unit_price from public.precificacao_ultimo_preco(p_empresa,supply.id);
   if unit_price is null then raise exception 'Há insumo sem preço de compra na unidade cadastrada.'; end if;
   inputs:=inputs+quantity*unit_price;
   lines:=lines||jsonb_build_array(jsonb_build_object('name',supply.nome,'unit',supply.unidade_medida,'quantity',quantity,'price',unit_price,'cost',round(quantity*unit_price,2)));
 end loop;
 total:=round(base+inputs,2);
 if total<=0 then raise exception 'Impossível calcular: vincule insumos ou defina um custo base para este produto.'; end if;
 select imposto_percentual into tax from public.empresas where id=p_empresa;
 if tax is null or tax<0 or tax>100 then raise exception 'Confira o percentual de impostos da empresa.'; end if;
 -- Same documented convention as database/README.md. Tax is an uplift on cost.
 gross_cost:=total*(1+tax/100);
 price:=round(gross_cost*(1+markup/100),2);
 if total>999999999 or price>999999999 then raise exception 'O cálculo ultrapassa o valor permitido.'; end if;
 profit:=price-round(gross_cost,2);
 return jsonb_build_object('cost',total,'inputCost',round(inputs,2),'tax',tax,'taxCost',round(total*tax/100,2),
   'suggestedPrice',price,'profit',profit,'margin',round(profit/nullif(price,0)*100,2),
   'monthlyRevenue',price*units,'revenueDifference',case when current_price is null then null else (price-current_price)*units end,'lines',lines);
end $$;

create or replace function public.salvar_precificacao(p_empresa uuid,p_id uuid,p_versao uuid,p_dados jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.produtos; result jsonb; new_version uuid:=gen_random_uuid();
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_id is null then raise exception 'Dados de precificação inválidos.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_empresa::text,0));
 select * into existing from public.produtos where id=p_id for update;
 if found then
   if existing.empresa_id<>p_empresa then raise exception 'Acesso negado.' using errcode='42501'; end if;
   if p_versao is distinct from existing.versao_precificacao then raise exception 'O produto mudou. Atualize os dados antes de salvar.'; end if;
 elsif p_versao is not null then raise exception 'O produto mudou. Atualize os dados antes de salvar.';
 end if;
 if exists(select 1 from public.produtos where empresa_id=p_empresa and lower(trim(nome))=lower(trim(p_dados->>'name')) and id<>p_id) then
   raise exception 'Já existe um produto com esse nome.';
 end if;
 result:=public.calcular_precificacao(p_empresa,p_dados);
 insert into public.produtos(id,empresa_id,nome,custo_base,markup_padrao,preco_venda,unidades_previstas,custo_referencia,versao_precificacao)
 values(p_id,p_empresa,trim(p_dados->>'name'),(p_dados->>'baseCost')::numeric,(p_dados->>'markup')::numeric,(p_dados->>'currentPrice')::numeric,(p_dados->>'monthlyUnits')::integer,(result->>'cost')::numeric,new_version)
 on conflict(id) do update set nome=excluded.nome,custo_base=excluded.custo_base,markup_padrao=excluded.markup_padrao,preco_venda=excluded.preco_venda,
 unidades_previstas=excluded.unidades_previstas,custo_referencia=excluded.custo_referencia,versao_precificacao=new_version,atualizado_em=now();
 delete from public.insumos_produto where produto_id=p_id;
 insert into public.insumos_produto(produto_id,insumo_id,quantidade)
 select p_id,(value->>'supplyId')::uuid,(value->>'quantity')::numeric from jsonb_array_elements(p_dados->'ingredients');
 return jsonb_build_object('id',p_id,'version',new_version,'quote',result);
end $$;
revoke all on function public.dados_precificacao(uuid),public.calcular_precificacao(uuid,jsonb),public.salvar_precificacao(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.dados_precificacao(uuid),public.calcular_precificacao(uuid,jsonb),public.salvar_precificacao(uuid,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
