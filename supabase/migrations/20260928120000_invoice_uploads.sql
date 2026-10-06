-- Executar no Supabase com schema português, após as migrations anteriores.
-- Registro privado de documentos e revisão. Não confirma despesas nem altera saldos.
begin;

alter table public.notas_fiscais
  add column if not exists enviado_por uuid references auth.users(id),
  add column if not exists natureza text not null default 'cost' check (natureza in ('revenue','cost')),
  add column if not exists nome_arquivo text,
  add column if not exists mime_arquivo text check (mime_arquivo in ('application/pdf','image/jpeg','image/png')),
  add column if not exists tamanho_arquivo integer check (tamanho_arquivo > 0 and tamanho_arquivo <= 5242880),
  add column if not exists hash_arquivo text check (hash_arquivo ~ '^[a-f0-9]{64}$'),
  add column if not exists revisado_em timestamptz,
  add column if not exists versao_arquivo uuid not null default gen_random_uuid();

create unique index if not exists notas_arquivo_unico on public.notas_fiscais(enviado_por, empresa_id, hash_arquivo) where hash_arquivo is not null;
create index if not exists notas_arquivo_listagem on public.notas_fiscais(enviado_por, empresa_id, natureza, criado_em desc, id desc);
alter table public.notas_fiscais enable row level security;
revoke all on public.notas_fiscais from anon;
-- Nenhuma escrita financeira liberada: somente criação de rascunho e revisão.
revoke insert, update on public.notas_fiscais from authenticated;
grant select on public.notas_fiscais to authenticated;
grant insert (id, empresa_id, enviado_por, natureza, nome_arquivo, mime_arquivo, tamanho_arquivo, caminho_arquivo, hash_arquivo, criado_em, status, revisado_em, versao_arquivo, dados_extracao) on public.notas_fiscais to authenticated;
grant update (dados_extracao, cnpj_emissor, numero_documento, data_emissao, valor_total, revisado_em, versao_arquivo) on public.notas_fiscais to authenticated;

drop policy if exists notas_arquivo_owner_guard on public.notas_fiscais;
create policy notas_arquivo_owner_guard on public.notas_fiscais as restrictive for all to authenticated
using (enviado_por is null or (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id)))
with check (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id));
drop policy if exists notas_arquivo_select on public.notas_fiscais;
create policy notas_arquivo_select on public.notas_fiscais for select to authenticated
using (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id));
drop policy if exists notas_arquivo_insert on public.notas_fiscais;
create policy notas_arquivo_insert on public.notas_fiscais for insert to authenticated
with check (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id)
  and status = 'pending_review' and revisado_em is null
  and mime_arquivo is not null and tamanho_arquivo is not null and hash_arquivo is not null
  and length(nome_arquivo) between 1 and 200
  and caminho_arquivo = enviado_por::text || '/' || empresa_id::text || '/' || id::text ||
    case mime_arquivo when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end);
drop policy if exists notas_arquivo_update on public.notas_fiscais;
create policy notas_arquivo_update on public.notas_fiscais for update to authenticated
using (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id) and status = 'pending_review')
with check (enviado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id) and status = 'pending_review' and octet_length(dados_extracao::text) <= 131072);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-documents', 'invoice-documents', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Subpastas: auth.uid / empresa.id / UUID.ext. Sem URL pública.
create or replace function public.dono_arquivo_nota(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (storage.foldername(p_path))[1] = auth.uid()::text
    and exists (select 1 from public.usuarios u join public.membros_empresa m on m.usuario_id = u.id
      where u.usuario_auth_id = auth.uid() and m.empresa_id::text = (storage.foldername(p_path))[2]);
$$;
revoke all on function public.dono_arquivo_nota(text) from public, anon;
grant execute on function public.dono_arquivo_nota(text) to authenticated;

drop policy if exists invoice_storage_guard on storage.objects;
create policy invoice_storage_guard on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'invoice-documents' or public.dono_arquivo_nota(name))
with check (bucket_id <> 'invoice-documents' or public.dono_arquivo_nota(name));
drop policy if exists invoice_storage_select on storage.objects;
create policy invoice_storage_select on storage.objects for select to authenticated
using (bucket_id = 'invoice-documents' and public.dono_arquivo_nota(name));
drop policy if exists invoice_storage_insert on storage.objects;
create policy invoice_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'invoice-documents' and public.dono_arquivo_nota(name));
-- Apenas compensação de upload cujo registro falhou; não apaga arquivos vinculados.
drop policy if exists invoice_storage_cleanup on storage.objects;
create policy invoice_storage_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'invoice-documents' and public.dono_arquivo_nota(name)
  and not exists (select 1 from public.notas_fiscais n where n.enviado_por = auth.uid() and n.caminho_arquivo = name));

notify pgrst, 'reload schema';
commit;
