-- Aplicar após 20260928130000_invoice_deletion.sql. Não apaga notas existentes.
begin;
alter table public.notas_fiscais add column if not exists exclusao_justificativa text;
grant update (exclusao_justificativa) on public.notas_fiscais to authenticated;

-- Sem FK para a nota: este histórico precisa sobreviver à exclusão definitiva.
-- Não armazena o documento nem os dados extraídos, apenas o motivo e a autoria.
create table if not exists public.notas_exclusoes_auditoria (
  nota_id uuid primary key,
  empresa_id uuid not null,
  solicitado_por uuid not null,
  nome_arquivo text not null,
  justificativa text not null check (char_length(btrim(justificativa)) between 10 and 1000),
  solicitado_em timestamptz not null default now(),
  excluido_em timestamptz
);
alter table public.notas_exclusoes_auditoria enable row level security;
revoke all on public.notas_exclusoes_auditoria from public, anon, authenticated;
grant select on public.notas_exclusoes_auditoria to authenticated;
drop policy if exists notas_auditoria_owner_read on public.notas_exclusoes_auditoria;
create policy notas_auditoria_owner_read on public.notas_exclusoes_auditoria for select to authenticated
using (solicitado_por = (select auth.uid()) and public.usuario_da_empresa(empresa_id));

create or replace function public.auditar_exclusao_nota()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Notas legadas, não enviadas por este fluxo, mantêm suas regras existentes.
  if old.enviado_por is null then
    if TG_OP = 'DELETE' then return old; else return new; end if;
  end if;
  if TG_OP = 'DELETE' then
    if old.exclusao_solicitada_em is null or old.exclusao_justificativa is null
      or not exists (select 1 from public.notas_exclusoes_auditoria a where a.nota_id = old.id) then
      raise exception 'Solicite a exclusão com uma justificativa antes de apagar a nota.';
    end if;
    update public.notas_exclusoes_auditoria set excluido_em = now() where nota_id = old.id;
    return old;
  end if;
  if old.exclusao_solicitada_em is not null then
    -- Permite somente acrescentar o motivo a uma exclusão antiga que ficou pendente.
    -- atualizado_em pode ser atualizado por triggers já existentes no projeto.
    if (to_jsonb(new) - 'exclusao_justificativa' - 'atualizado_em') is distinct from
       (to_jsonb(old) - 'exclusao_justificativa' - 'atualizado_em')
       or old.exclusao_justificativa is not null then
      raise exception 'Uma nota em exclusão não pode ser alterada.';
    end if;
  end if;
  if new.exclusao_solicitada_em is null then
    if new.exclusao_justificativa is not null then raise exception 'Justificativa exige solicitação de exclusão.'; end if;
    return new;
  end if;
  if auth.uid() is distinct from old.enviado_por or not public.usuario_da_empresa(old.empresa_id)
     or old.status <> 'pending_review' then raise exception 'Exclusão não autorizada.'; end if;
  new.exclusao_justificativa := btrim(new.exclusao_justificativa);
  if new.exclusao_justificativa is null or char_length(new.exclusao_justificativa) not between 10 and 1000 then
    raise exception 'Informe uma justificativa de 10 a 1.000 caracteres.';
  end if;
  -- Horário e autoria definidos no banco, não por campos enviados pelo navegador.
  if old.exclusao_solicitada_em is null then new.exclusao_solicitada_em := now(); end if;
  insert into public.notas_exclusoes_auditoria
    (nota_id, empresa_id, solicitado_por, nome_arquivo, justificativa)
  values (old.id, old.empresa_id, auth.uid(), old.nome_arquivo, new.exclusao_justificativa);
  return new;
end;
$$;
revoke all on function public.auditar_exclusao_nota() from public, anon, authenticated;
drop trigger if exists notas_exclusao_auditar on public.notas_fiscais;
create trigger notas_exclusao_auditar before update on public.notas_fiscais
for each row execute function public.auditar_exclusao_nota();
drop trigger if exists notas_exclusao_concluir_auditoria on public.notas_fiscais;
create trigger notas_exclusao_concluir_auditoria after delete on public.notas_fiscais
for each row execute function public.auditar_exclusao_nota();

drop policy if exists notas_exclusao_freeze on public.notas_fiscais;
create policy notas_exclusao_freeze on public.notas_fiscais as restrictive for update to authenticated
using (exclusao_solicitada_em is null or exclusao_justificativa is null) with check (true);

-- Bloqueia remoção do arquivo mesmo se uma exclusão antiga ainda não tiver motivo.
create or replace function public.arquivo_nota_em_exclusao(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notas_fiscais n
    join public.notas_exclusoes_auditoria a on a.nota_id = n.id
    where n.caminho_arquivo = p_path and n.enviado_por = auth.uid()
      and public.usuario_da_empresa(n.empresa_id)
      and n.status = 'pending_review' and n.exclusao_solicitada_em is not null
      and n.exclusao_justificativa is not null);
$$;
revoke all on function public.arquivo_nota_em_exclusao(text) from public, anon;
grant execute on function public.arquivo_nota_em_exclusao(text) to authenticated;
notify pgrst, 'reload schema';
commit;
