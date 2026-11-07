-- US008: read-only financial exports and durable e-mail deduplication.
-- Generating a report does NOT close a month or change financial records.
begin;
create or replace function public.dados_relatorio(p_empresa uuid,p_inicio date,p_fim date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_inicio is null or p_fim is null or p_fim<p_inicio or p_fim-p_inicio>366 then raise exception 'Selecione um período de até 367 dias.'; end if;
 select jsonb_build_object('company',jsonb_build_object('name',e.razao_social,'cnpj',e.cnpj),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.date,r.id) from (
   select 'venda:'||v.id::text id,v.data date,v.valor_total amount,'revenue' kind,'professional' scope,
     'Venda registrada' label,'Vendas' category,null::jsonb file,false "invoice"
   from public.vendas v where v.empresa_id=p_empresa and v.data between p_inicio and p_fim
   union all
   select 'nota:'||n.id::text,n.data_emissao,n.valor_total,n.natureza,case when n.natureza='revenue' then 'professional' else n.tipo::text end,
     coalesce(nullif(n.dados_extracao->>'supplier',''),n.nome_arquivo,'Nota fiscal'),coalesce(c.nome,'Sem categoria'),
     case when n.caminho_arquivo is null then null else jsonb_build_object('id',n.id,'name',n.nome_arquivo,'path',n.caminho_arquivo,'mime',n.mime_arquivo,'size',n.tamanho_arquivo) end,true
   from public.notas_fiscais n left join public.categorias c on c.id=n.categoria_id and c.empresa_id=n.empresa_id
   where n.empresa_id=p_empresa and n.data_emissao between p_inicio and p_fim and n.exclusao_solicitada_em is null
     and (n.lancado_financeiro_em is not null or (n.natureza='cost' and n.status='confirmed'))
   limit 5001
 ) r),'[]'::jsonb)) into result from public.empresas e where e.id=p_empresa;
 if jsonb_array_length(result->'rows')>5000 then raise exception 'Muitos lançamentos. Reduza o período do relatório.'; end if;
 return result;
end $$;
revoke all on function public.dados_relatorio(uuid,date,date) from public,anon;
grant execute on function public.dados_relatorio(uuid,date,date) to authenticated;

create table if not exists public.relatorios_envios (
 id uuid primary key,empresa_id uuid not null references public.empresas(id),usuario_id uuid not null references auth.users(id),
 pedido_hash text not null,status text not null default 'processing' check(status in ('processing','sent','uncertain')),
 criado_em timestamptz not null default now(),concluido_em timestamptz
);
alter table public.relatorios_envios enable row level security;
revoke all on public.relatorios_envios from public,anon,authenticated;
create index if not exists relatorios_envios_rate on public.relatorios_envios(usuario_id,criado_em);
create or replace function public.reservar_envio_relatorio(p_empresa uuid,p_id uuid,p_hash text) returns text
language plpgsql security definer set search_path='' as $$
declare previous public.relatorios_envios;
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Solicitação inválida.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('report-email:'||auth.uid()::text,0));
 select * into previous from public.relatorios_envios where id=p_id;
 if found then
   if previous.usuario_id<>auth.uid() or previous.empresa_id<>p_empresa or previous.pedido_hash<>p_hash then raise exception 'Solicitação conflitante.'; end if;
   return previous.status;
 end if;
 if (select count(*) from public.relatorios_envios where usuario_id=auth.uid() and criado_em>now()-interval '1 hour')>=10 then raise exception 'Limite de 10 envios por hora. Tente mais tarde.'; end if;
 insert into public.relatorios_envios(id,empresa_id,usuario_id,pedido_hash) values(p_id,p_empresa,auth.uid(),p_hash);
 return 'reserved';
end $$;
create or replace function public.concluir_envio_relatorio(p_empresa uuid,p_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_status not in ('sent','uncertain') then raise exception 'Status inválido.'; end if;
 update public.relatorios_envios set status=p_status,concluido_em=now() where id=p_id and empresa_id=p_empresa and usuario_id=auth.uid() and status='processing';
end $$;
revoke all on function public.reservar_envio_relatorio(uuid,uuid,text),public.concluir_envio_relatorio(uuid,uuid,text) from public,anon;
grant execute on function public.reservar_envio_relatorio(uuid,uuid,text),public.concluir_envio_relatorio(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
