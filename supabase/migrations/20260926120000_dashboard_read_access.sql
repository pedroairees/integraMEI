-- Supabase existente: tabelas em português. Não executar no schema inglês do Compose.
-- US004 / RNF-003. Apenas leitura das finanças pela empresa autenticada.
-- Preserva dados, triggers, tabelas, configurações e políticas existentes.
begin;

alter table public.empresas add column if not exists meta_margem_lucro_percentual numeric(5,2)
  check (meta_margem_lucro_percentual between 0 and 100);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'alertas','categorias','exportacoes_relatorio','fechamentos_mensais',
    'fornecedores','historico_precos','insumos','movimentacoes_estoque',
    'notas_fiscais','produtos','tarefas_compra','vendas'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('drop policy if exists dashboard_empresa_read on public.%I', table_name);
    execute format('create policy dashboard_empresa_read on public.%I for select to authenticated using (public.usuario_da_empresa(empresa_id))', table_name);
  end loop;
end $$;

alter table public.itens_nota_fiscal enable row level security;
alter table public.insumos_produto enable row level security;
revoke all on public.itens_nota_fiscal, public.insumos_produto from anon;
grant select on public.itens_nota_fiscal, public.insumos_produto to authenticated;
drop policy if exists dashboard_itens_read on public.itens_nota_fiscal;
create policy dashboard_itens_read on public.itens_nota_fiscal for select to authenticated
using (exists (select 1 from public.notas_fiscais n where n.id=nota_fiscal_id and public.usuario_da_empresa(n.empresa_id)));
drop policy if exists dashboard_composicao_read on public.insumos_produto;
create policy dashboard_composicao_read on public.insumos_produto for select to authenticated
using (exists (select 1 from public.produtos p where p.id=produto_id and public.usuario_da_empresa(p.empresa_id)));

-- Views must respect underlying RLS instead of the view owner's privileges.
do $$
declare view_name text;
begin
  foreach view_name in array array['v_dashboard_mensal','v_estoque_insumos','v_historico_precos_insumos','v_sugestoes_precos_produtos'] loop
    if to_regclass('public.'||view_name) is not null then
      execute format('alter view public.%I set (security_invoker = true)', view_name);
      execute format('revoke all on public.%I from anon', view_name);
    end if;
  end loop;
end $$;
commit;
