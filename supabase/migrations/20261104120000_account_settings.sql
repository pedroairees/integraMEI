-- Account settings belong to auth.uid(); company and identity are never chosen by the form.
begin;
create table if not exists public.preferencias_usuario (
  usuario_auth_id uuid primary key references auth.users(id) on delete cascade,
  alertas_email boolean not null default false,
  lembretes_notas boolean not null default true,
  alertas_estoque boolean not null default true,
  fuso_horario text not null default 'America/Sao_Paulo'
    check (fuso_horario in ('America/Sao_Paulo','America/Manaus','America/Rio_Branco')),
  atualizado_em timestamptz not null default now()
);
alter table public.preferencias_usuario enable row level security;
revoke all on public.preferencias_usuario from public,anon,authenticated;
grant select on public.preferencias_usuario to authenticated;
drop policy if exists preferencias_proprias on public.preferencias_usuario;
create policy preferencias_proprias on public.preferencias_usuario for select to authenticated
  using (usuario_auth_id=auth.uid());

create or replace function public.dados_configuracoes(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select jsonb_build_object('fullName',u.nome_completo,'phone',coalesce(u.telefone,''),'email',u.email,'cnpj',e.cnpj,
 'emailAlerts',coalesce(p.alertas_email,false),'invoiceReminders',coalesce(p.lembretes_notas,true),
 'lowStockAlerts',coalesce(p.alertas_estoque,true),'timeZone',coalesce(p.fuso_horario,'America/Sao_Paulo'))
 into result from public.usuarios u
 join public.membros_empresa m on m.usuario_id=u.id and m.empresa_id=p_empresa
 join public.empresas e on e.id=m.empresa_id
 left join public.preferencias_usuario p on p.usuario_auth_id=u.usuario_auth_id
 where u.usuario_auth_id=auth.uid();
 return result;
end $$;

create or replace function public.salvar_configuracoes(p_empresa uuid,p_dados jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.usuario_da_empresa(p_empresa) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_dados is null or jsonb_typeof(p_dados)<>'object' or
   not(p_dados ?& array['fullName','phone','emailAlerts','invoiceReminders','lowStockAlerts','timeZone']) or
   (p_dados-array['fullName','phone','emailAlerts','invoiceReminders','lowStockAlerts','timeZone'])<>'{}'::jsonb or
   jsonb_typeof(p_dados->'fullName')<>'string' or length(trim(p_dados->>'fullName')) not between 2 and 160 or (p_dados->>'fullName')~'[[:cntrl:]]' or
   jsonb_typeof(p_dados->'phone')<>'string' or (p_dados->>'phone')!~'^[0-9]{10,11}$' or
   jsonb_typeof(p_dados->'emailAlerts')<>'boolean' or jsonb_typeof(p_dados->'invoiceReminders')<>'boolean' or jsonb_typeof(p_dados->'lowStockAlerts')<>'boolean' or
   jsonb_typeof(p_dados->'timeZone')<>'string' or (p_dados->>'timeZone') not in ('America/Sao_Paulo','America/Manaus','America/Rio_Branco')
 then raise exception 'Dados inválidos.' using errcode='22023'; end if;
 update public.usuarios set nome_completo=trim(p_dados->>'fullName'),telefone=p_dados->>'phone',atualizado_em=now() where usuario_auth_id=auth.uid();
 if not found then raise exception 'Perfil não encontrado.'; end if;
 insert into public.preferencias_usuario(usuario_auth_id,alertas_email,lembretes_notas,alertas_estoque,fuso_horario)
 values(auth.uid(),(p_dados->>'emailAlerts')::boolean,(p_dados->>'invoiceReminders')::boolean,(p_dados->>'lowStockAlerts')::boolean,p_dados->>'timeZone')
 on conflict(usuario_auth_id) do update set alertas_email=excluded.alertas_email,lembretes_notas=excluded.lembretes_notas,
 alertas_estoque=excluded.alertas_estoque,fuso_horario=excluded.fuso_horario,atualizado_em=now();
 return public.dados_configuracoes(p_empresa);
end $$;
revoke all on function public.dados_configuracoes(uuid),public.salvar_configuracoes(uuid,jsonb) from public,anon;
grant execute on function public.dados_configuracoes(uuid),public.salvar_configuracoes(uuid,jsonb) to authenticated;

-- Login resolves the user's e-mail through public.usuarios. Sync only confirmed Auth changes.
create or replace function public.sincronizar_email_confirmado() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.email is distinct from old.email and new.email is not null then
   update public.usuarios set email=new.email,atualizado_em=now() where usuario_auth_id=new.id;
 end if;
 return new;
end $$;
drop trigger if exists ao_alterar_email_auth on auth.users;
create trigger ao_alterar_email_auth after update of email on auth.users for each row execute function public.sincronizar_email_confirmado();
revoke all on function public.sincronizar_email_confirmado() from public,anon,authenticated;
-- Profile edits go through the validated RPC; clients cannot bypass confirmation by editing email.
revoke update on public.usuarios from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
