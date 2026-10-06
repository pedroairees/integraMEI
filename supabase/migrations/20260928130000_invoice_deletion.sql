-- Após 20260928120000_invoice_uploads.sql. Não exclui dados existentes.
-- Exclusão efetiva ocorre apenas ao confirmar a ação na aplicação.
begin;
alter table public.notas_fiscais add column if not exists exclusao_solicitada_em timestamptz;
grant update (exclusao_solicitada_em) on public.notas_fiscais to authenticated;
grant delete on public.notas_fiscais to authenticated;

-- Uma nota em exclusão não pode ser editada por uma leitura concorrente.
drop policy if exists notas_exclusao_freeze on public.notas_fiscais;
create policy notas_exclusao_freeze on public.notas_fiscais as restrictive for update to authenticated
using (exclusao_solicitada_em is null) with check (true);
drop policy if exists notas_exclusao_delete on public.notas_fiscais;
create policy notas_exclusao_delete on public.notas_fiscais for delete to authenticated
using (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id)
  and status = 'pending_review' and exclusao_solicitada_em is not null
  and not exists (select 1 from storage.objects o where o.bucket_id = 'invoice-documents' and o.name = caminho_arquivo));

-- API de Storage apaga o arquivo real; nunca DELETE SQL em storage.objects.
-- SECURITY DEFINER evita recursão RLS entre notas_fiscais e storage.objects.
create or replace function public.arquivo_nota_em_exclusao(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notas_fiscais n
    where n.caminho_arquivo = p_path and n.enviado_por = auth.uid()
      and public.usuario_da_empresa(n.empresa_id)
      and n.status = 'pending_review' and n.exclusao_solicitada_em is not null);
$$;
revoke all on function public.arquivo_nota_em_exclusao(text) from public, anon;
grant execute on function public.arquivo_nota_em_exclusao(text) to authenticated;
drop policy if exists invoice_storage_delete_requested on storage.objects;
create policy invoice_storage_delete_requested on storage.objects for delete to authenticated
using (bucket_id = 'invoice-documents' and public.dono_arquivo_nota(name) and public.arquivo_nota_em_exclusao(name));

notify pgrst, 'reload schema';
commit;
