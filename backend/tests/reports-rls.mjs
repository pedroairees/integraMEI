import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const company = randomUUID(),
  other = randomUUID(),
  user = randomUUID(),
  otherUser = randomUUID();
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.empresas(id uuid primary key,razao_social text,cnpj text);create table public.members(empresa uuid,usuario uuid);
 create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.members where empresa=$1 and usuario=auth.uid())$$;
 create table public.vendas(id uuid primary key default gen_random_uuid(),empresa_id uuid,data date,valor_total numeric);
 create table public.categorias(id uuid primary key,empresa_id uuid,nome text);
 create table public.notas_fiscais(id uuid primary key default gen_random_uuid(),empresa_id uuid,data_emissao date,valor_total numeric,natureza text,tipo text,status text,lancado_financeiro_em timestamptz,exclusao_solicitada_em timestamptz,categoria_id uuid,dados_extracao jsonb,nome_arquivo text,caminho_arquivo text,mime_arquivo text,tamanho_arquivo integer);
 grant usage on schema public,auth to authenticated,anon;
 insert into auth.users values('${user}'),('${otherUser}');insert into public.empresas values('${company}','Minha empresa','123'),('${other}','Segredo','456');insert into public.members values('${company}','${user}'),('${other}','${otherUser}');
 insert into public.vendas(empresa_id,data,valor_total) values('${company}','2026-10-01',10),('${company}','2026-11-01',200),('${other}','2026-10-01',999);
 insert into public.notas_fiscais(empresa_id,data_emissao,valor_total,natureza,tipo,status,lancado_financeiro_em,exclusao_solicitada_em) values
 ('${company}','2026-10-31',20,'revenue','unclassified','pending_review',now(),null),
 ('${company}','2026-10-31',3,'cost','professional','confirmed',now(),null),
 ('${company}','2026-10-31',5,'cost','personal','confirmed',null,null),
 ('${company}','2026-10-31',100,'cost','professional','pending_review',null,null),
 ('${company}','2026-10-31',100,'cost','professional','pending_review',now(),now());`);
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261102120000_reports.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`,
  );
  const data = async (c = company) =>
    (
      await db.query("select public.dados_relatorio($1,$2,$3) d", [
        c,
        "2026-10-01",
        "2026-10-31",
      ])
    ).rows[0].d;
  const report = await data();
  assert.equal(report.company.name, "Minha empresa");
  assert.equal(report.rows.length, 4);
  assert.equal(
    report.rows.reduce((s, r) => s + r.amount, 0),
    38,
  );
  await assert.rejects(() => data(other), { code: "42501" });
  const reserve = async (
    id = randomUUID(),
    hash = "a".repeat(64),
    c = company,
  ) =>
    (
      await db.query("select public.reservar_envio_relatorio($1,$2,$3) s", [
        c,
        id,
        hash,
      ])
    ).rows[0].s;
  const id = randomUUID();
  assert.equal(await reserve(id), "reserved");
  assert.equal(await reserve(id), "processing");
  await assert.rejects(() => reserve(id, "b".repeat(64)), /conflitante/);
  await db.query("select public.concluir_envio_relatorio($1,$2,$3)", [
    company,
    id,
    "sent",
  ]);
  assert.equal(await reserve(id), "sent");
  await assert.rejects(
    () => db.query("select * from public.relatorios_envios"),
    /permission denied/,
  );
  await db.exec(
    `select set_config('request.jwt.claim.sub','${otherUser}',false);`,
  );
  await assert.rejects(() => reserve(id, "a".repeat(64), other), /conflitante/);
  await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);`);
  for (let i = 0; i < 9; i++) await reserve();
  await assert.rejects(() => reserve(), /10 envios/);
  await db.exec("reset role;set role anon");
  await assert.rejects(() => data(), /permission denied/);
  console.log(
    "PASS report SQL: period boundaries, unposted/deleted exclusions, no double count, isolation, durable idempotency, rate limit.",
  );
} finally {
  await db.close();
}
