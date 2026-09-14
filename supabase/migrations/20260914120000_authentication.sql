-- Migração para o schema já existente no projeto Supabase (nomes em português).
-- Execute-a com a Supabase CLI ou pelo SQL Editor antes de usar o fluxo de cadastro.

begin;

alter table public.usuarios
  add column if not exists data_nascimento date,
  add column if not exists telefone text,
  add column if not exists documento_path text;

create unique index if not exists usuarios_usuario_auth_id_key
  on public.usuarios (usuario_auth_id)
  where usuario_auth_id is not null;

create or replace function public.criar_conta_ao_convidar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid;
  v_empresa_id uuid;
  v_cnpj text;
  v_nome_completo text;
  v_razao_social text;
  v_data_nascimento date;
  v_telefone text;
begin
  v_nome_completo := nullif(trim(new.raw_user_meta_data ->> 'nome_completo'), '');
  v_razao_social := nullif(trim(new.raw_user_meta_data ->> 'razao_social'), '');
  v_cnpj := regexp_replace(coalesce(new.raw_user_meta_data ->> 'cnpj', ''), '\D', '', 'g');
  v_data_nascimento := nullif(new.raw_user_meta_data ->> 'data_nascimento', '')::date;
  v_telefone := nullif(trim(new.raw_user_meta_data ->> 'telefone'), '');

  if new.email is null
    or v_nome_completo is null
    or v_razao_social is null
    or length(v_cnpj) <> 14
    or v_data_nascimento is null
    or v_telefone is null then
    raise exception 'Dados obrigatórios do cadastro ausentes.' using errcode = '22023';
  end if;

  insert into public.usuarios (
    usuario_auth_id,
    nome_completo,
    email,
    data_nascimento,
    telefone
  )
  values (
    new.id,
    v_nome_completo,
    new.email,
    v_data_nascimento,
    v_telefone
  )
  returning id into v_usuario_id;

  insert into public.empresas (razao_social, cnpj)
  values (v_razao_social, v_cnpj)
  returning id into v_empresa_id;

  insert into public.membros_empresa (empresa_id, usuario_id, papel)
  values (v_empresa_id, v_usuario_id, 'owner');

  return new;
end;
$$;

drop trigger if exists ao_criar_usuario_auth on auth.users;

create trigger ao_criar_usuario_auth
  after insert on auth.users
  for each row execute procedure public.criar_conta_ao_convidar();

alter table public.usuarios enable row level security;
alter table public.empresas enable row level security;
alter table public.membros_empresa enable row level security;

create or replace function public.usuario_da_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.membros_empresa membro
    join public.usuarios usuario on usuario.id = membro.usuario_id
    where membro.empresa_id = p_empresa_id
      and usuario.usuario_auth_id = auth.uid()
  );
$$;

create or replace function public.owner_da_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.membros_empresa membro
    join public.usuarios usuario on usuario.id = membro.usuario_id
    where membro.empresa_id = p_empresa_id
      and membro.papel = 'owner'
      and usuario.usuario_auth_id = auth.uid()
  );
$$;

grant execute on function public.usuario_da_empresa(uuid) to authenticated;
grant execute on function public.owner_da_empresa(uuid) to authenticated;

drop policy if exists "usuarios leem o próprio perfil" on public.usuarios;
create policy "usuarios leem o próprio perfil"
  on public.usuarios for select to authenticated
  using (usuario_auth_id = auth.uid());

drop policy if exists "usuarios atualizam o próprio perfil" on public.usuarios;
create policy "usuarios atualizam o próprio perfil"
  on public.usuarios for update to authenticated
  using (usuario_auth_id = auth.uid())
  with check (usuario_auth_id = auth.uid());

drop policy if exists "membros leem suas empresas" on public.empresas;
create policy "membros leem suas empresas"
  on public.empresas for select to authenticated
  using (public.usuario_da_empresa(id));

drop policy if exists "owners atualizam suas empresas" on public.empresas;
create policy "owners atualizam suas empresas"
  on public.empresas for update to authenticated
  using (public.owner_da_empresa(id))
  with check (public.owner_da_empresa(id));

drop policy if exists "membros leem membros das empresas" on public.membros_empresa;
create policy "membros leem membros das empresas"
  on public.membros_empresa for select to authenticated
  using (public.usuario_da_empresa(empresa_id));

drop policy if exists "owners inserem membros" on public.membros_empresa;
create policy "owners inserem membros"
  on public.membros_empresa for insert to authenticated
  with check (public.owner_da_empresa(empresa_id));

drop policy if exists "owners removem membros" on public.membros_empresa;
create policy "owners removem membros"
  on public.membros_empresa for delete to authenticated
  using (public.owner_da_empresa(empresa_id));

drop policy if exists "usuários leem seus documentos" on storage.objects;
create policy "usuários leem seus documentos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "usuários enviam seus documentos" on storage.objects;
create policy "usuários enviam seus documentos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "usuários atualizam seus documentos" on storage.objects;
create policy "usuários atualizam seus documentos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "usuários removem seus documentos" on storage.objects;
create policy "usuários removem seus documentos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
