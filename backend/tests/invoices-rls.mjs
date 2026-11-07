// Optional real PostgreSQL/RLS verification using an isolated PGlite installation.
// node backend/tests/invoices-rls.mjs <absolute path to @electric-sql/pglite/dist/index.js>
// No connection to Supabase or credentials. No persistent test database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  company = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    create table auth.users(id uuid primary key);
    create table public.usuarios(id uuid primary key, usuario_auth_id uuid);
    create table public.membros_empresa(empresa_id uuid, usuario_id uuid);
    create type public.tipo_gasto as enum ('professional','personal','unclassified');
    create table public.empresas(id uuid primary key, cnpj text);
    create table public.fechamentos_mensais(empresa_id uuid, mes_fechado date);
    create table public.notas_fiscais(id uuid primary key, empresa_id uuid, cnpj_emissor text, numero_documento text, data_emissao date, valor_total numeric, status text default 'processing', dados_extracao jsonb default '{}', caminho_arquivo text, criado_em timestamptz default now());
    alter table public.notas_fiscais add column tipo public.tipo_gasto not null default 'unclassified';
    alter table public.notas_fiscais add column fornecedor_id uuid, add column categoria_id uuid, add column atualizado_em timestamptz default now();
    create table public.fornecedores(id uuid primary key, empresa_id uuid);
    create table public.categorias(id uuid primary key, empresa_id uuid, tipo public.tipo_gasto);
    create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.usuarios u join public.membros_empresa m on m.usuario_id=u.id where u.usuario_auth_id=auth.uid() and m.empresa_id=$1) $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to authenticated;
    grant all on all tables in schema public, storage to authenticated;
    insert into auth.users values ('${a}'), ('${b}');
    insert into public.usuarios values ('${a}', '${a}'), ('${b}', '${b}');
    insert into public.membros_empresa values ('${company}', '${a}'), ('${company}', '${b}');
    insert into public.empresas values ('${company}', '12.345.678/0001-95');
    create policy dashboard_empresa_read on public.notas_fiscais for select to authenticated using(public.usuario_da_empresa(empresa_id));
  `);
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260928120000_invoice_uploads.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration); // Repeatable without removing data or colliding with policies.
  const deletion = await readFile(
    new URL(
      "../../supabase/migrations/20260928130000_invoice_deletion.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(deletion);
  await db.exec(deletion);
  const auditMigration = await readFile(
    new URL(
      "../../supabase/migrations/20261005120000_invoice_deletion_audit.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(auditMigration);
  await db.exec(auditMigration);
  const financialMigration = await readFile(new URL(
    "../../supabase/migrations/20261006120000_invoice_financial_posting.sql", import.meta.url,
  ), "utf8");
  await db.exec(financialMigration);
  await db.exec(financialMigration);
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${a}', false);`,
  );
  const path = `${a}/${company}/${id}.pdf`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values ('invoice-documents',$1)",
    [path],
  );
  await db.query(
    `insert into public.notas_fiscais(id,empresa_id,enviado_por,natureza,nome_arquivo,mime_arquivo,tamanho_arquivo,caminho_arquivo,hash_arquivo,status)
    values ($1,$2,$3,'cost','nota.pdf','application/pdf',25,$4,$5,'pending_review')`,
    [id, company, a, path, "a".repeat(64)],
  );
  assert.equal(
    (await db.query("select * from public.notas_fiscais")).rows.length,
    1,
  );
  await db.query(
    "update public.notas_fiscais set valor_total=12, dados_extracao=$1, revisado_em=now() where id=$2",
    [JSON.stringify({ supplier: "Teste", total: 12 }), id],
  );
  await assert.rejects(() =>
    db.exec(
      `update public.notas_fiscais set status='confirmed' where id='${id}'`,
    ),
  );
  await assert.rejects(() =>
    db.exec(
      `update public.notas_fiscais set enviado_por='${b}' where id='${id}'`,
    ),
  );
  await db.exec(
    "delete from storage.objects where bucket_id='invoice-documents'",
  );
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
    "referenced original cannot be deleted",
  );
  await assert.rejects(() =>
    db.query(
      "insert into storage.objects(bucket_id,name) values ('invoice-documents',$1)",
      [`${b}/${company}/evil.pdf`],
    ),
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`);
  assert.equal(
    (await db.query("select * from public.notas_fiscais")).rows.length,
    0,
    "even another company member cannot see private uploads",
  );
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  await db.exec(
    `update public.notas_fiscais set valor_total=999 where id='${id}'`,
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);`);
  assert.equal(
    Number(
      (await db.query("select valor_total from public.notas_fiscais")).rows[0]
        .valor_total,
    ),
    12,
  );
  const orphan = `${a}/${company}/orphan.pdf`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values ('invoice-documents',$1)",
    [orphan],
  );
  await db.query("delete from storage.objects where name=$1", [orphan]);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
  );
  console.log(
    "PASS: repeatable migration, tenant/owner RLS, private storage, immutable ownership, draft-only writes and orphan cleanup.",
  );
  await db.exec(
    `select set_config('request.jwt.claim.sub','${b}',false); delete from public.notas_fiscais where id='${id}';`,
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);`);
  assert.equal(
    (await db.query("select * from public.notas_fiscais")).rows.length,
    1,
  );
  await db.exec(`delete from public.notas_fiscais where id='${id}'`);
  assert.equal(
    (await db.query("select * from public.notas_fiscais")).rows.length,
    1,
    "cannot remove record before requesting deletion",
  );
  await assert.rejects(() =>
    db.exec(
      `update public.notas_fiscais set exclusao_solicitada_em=now() where id='${id}'`,
    ),
  );
  await assert.rejects(() =>
    db.exec(
      `update public.notas_fiscais set exclusao_solicitada_em=now(), exclusao_justificativa='    ' where id='${id}'`,
    ),
  );
  await db.exec(
    `update public.notas_fiscais set exclusao_solicitada_em=now(), exclusao_justificativa='Arquivo duplicado de teste' where id='${id}'`,
  );
  assert.equal(
    (
      await db.query(
        "select justificativa from public.notas_exclusoes_auditoria",
      )
    ).rows[0].justificativa,
    "Arquivo duplicado de teste",
  );
  await assert.rejects(() =>
    db.exec(
      "update public.notas_exclusoes_auditoria set justificativa='Motivo adulterado'",
    ),
  );
  await assert.rejects(() =>
    db.exec("delete from public.notas_exclusoes_auditoria"),
  );
  await assert.rejects(() =>
    db.exec(
      `insert into public.notas_exclusoes_auditoria(nota_id,empresa_id,solicitado_por,nome_arquivo,justificativa) values ('${b}','${company}','${a}','nota.pdf','Motivo inventado')`,
    ),
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`);
  assert.equal(
    (await db.query("select * from public.notas_exclusoes_auditoria")).rows
      .length,
    0,
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);`);
  await db.exec(
    `update public.notas_fiscais set valor_total=444 where id='${id}'`,
  );
  assert.equal(
    Number(
      (await db.query("select valor_total from public.notas_fiscais")).rows[0]
        .valor_total,
    ),
    12,
    "deletion freezes edits",
  );
  await db.exec(`delete from public.notas_fiscais where id='${id}'`);
  assert.equal(
    (await db.query("select * from public.notas_fiscais")).rows.length,
    1,
    "record stays until storage deletion is confirmed",
  );
  // In this isolated RLS fixture only: simulates Storage API's metadata removal.
  await db.query("delete from storage.objects where name=$1", [path]);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  await db.exec(`delete from public.notas_fiscais where id='${id}'`);
  assert.equal(
    (await db.query("select * from public.notas_fiscais")).rows.length,
    0,
  );
  console.log(
    "PASS: deletion is owner-only, freezes edits and requires file removal before deleting the row.",
  );
  const audit = (
    await db.query("select * from public.notas_exclusoes_auditoria")
  ).rows[0];
  assert.equal(audit.justificativa, "Arquivo duplicado de teste");
  assert.equal(audit.solicitado_por, a);
  assert.ok(audit.excluido_em);
  console.log(
    "PASS: required reason, immutable owner-only audit survives hard deletion.",
  );
  // A pre-migration pending deletion must require a reason before resuming.
  const legacyId = "33333333-3333-4333-8333-333333333333";
  const legacyPath = `${a}/${company}/${legacyId}.pdf`;
  await db.exec("reset role");
  await db.query(
    `insert into public.notas_fiscais(id,empresa_id,enviado_por,natureza,nome_arquivo,mime_arquivo,tamanho_arquivo,caminho_arquivo,hash_arquivo,status,exclusao_solicitada_em)
    values ($1,$2,$3,'cost','antiga.pdf','application/pdf',25,$4,$5,'pending_review',now())`,
    [legacyId, company, a, legacyPath, "b".repeat(64)],
  );
  await db.exec("set role authenticated");
  await db.query(
    "insert into storage.objects(bucket_id,name) values ('invoice-documents',$1)",
    [legacyPath],
  );
  await db.query("delete from storage.objects where name=$1", [legacyPath]);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
  );
  await assert.rejects(() =>
    db.exec(
      `update public.notas_fiscais set valor_total=99 where id='${legacyId}'`,
    ),
  );
  await db.exec(
    `update public.notas_fiscais set exclusao_justificativa='Concluir exclusão antiga solicitada por engano' where id='${legacyId}'`,
  );
  await db.query("delete from storage.objects where name=$1", [legacyPath]);
  await db.exec(`delete from public.notas_fiscais where id='${legacyId}'`);
  const legacyAudit = (
    await db.query(
      "select * from public.notas_exclusoes_auditoria where nota_id=$1",
      [legacyId],
    )
  ).rows[0];
  assert.ok(legacyAudit.excluido_em);
  console.log(
    "PASS: legacy pending deletion requires a reason and cannot edit financial fields.",
  );
  // Exercise the real posting function under authenticated role (not service_role).
  async function draft(kind = "cost", owner = a, hash = randomUUID().replaceAll("-", "").repeat(2)) {
    const note = randomUUID();
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
    await db.query(`insert into public.notas_fiscais(id,empresa_id,enviado_por,natureza,nome_arquivo,mime_arquivo,tamanho_arquivo,caminho_arquivo,hash_arquivo,status)
      values ($1,$2,$3,$4,'financeiro.pdf','application/pdf',25,$5,$6,'pending_review')`,
      [note, company, owner, kind, `${owner}/${company}/${note}.pdf`, hash]);
    return note;
  }
  async function review(note, kind = "cost", date = "2025-01-15") {
    const data = { supplier: "Fornecedor", cnpj: kind === "cost" ? "98765432000198" : "12345678000195",
      recipientCnpj: kind === "cost" ? "12345678000195" : "98765432000198", operation: "sale", date, total: 89.9, items: ["Item teste"] };
    await db.query(`update public.notas_fiscais set cnpj_emissor=$1, data_emissao=$2, valor_total=$3,
      dados_extracao=$4, revisado_em=now() where id=$5`, [data.cnpj, date, data.total, JSON.stringify(data), note]);
    return (await db.query("select versao_arquivo from public.notas_fiscais where id=$1", [note])).rows[0].versao_arquivo;
  }
  const post = (note, version, scope = "professional", tenant = company) => db.query(
    "select public.lancar_nota_financeiro($1,$2,$3,$4)", [note, tenant, version, scope]);
  const regression = await draft("revenue");
  const regressionVersion = await review(regression, "revenue");
  await db.exec("reset role");
  await db.exec(await readFile(new URL("./fixtures/invoice-legacy-triggers.sql", import.meta.url), "utf8"));
  await db.exec("set role authenticated");
  await assert.rejects(() => post(regression, regressionVersion), error =>
    error.code === "42P01" && error.message.includes("fechamentos_mensais"));
  assert.equal((await db.query("select lancado_financeiro_em from public.notas_fiscais where id=$1", [regression])).rows[0].lancado_financeiro_em, null);
  const schemaFix = await readFile(new URL(
    "../../supabase/migrations/20261018160000_invoice_trigger_schema_resolution.sql", import.meta.url,
  ), "utf8");
  await db.exec("reset role");
  // Fix only the first dependency in this isolated test to expose the second failure.
  const closedFunction = schemaFix.slice(schemaFix.indexOf("create or replace function"), schemaFix.indexOf("create or replace function public.app_validar_nota_fiscal"));
  await db.exec(closedFunction);
  await db.exec("set role authenticated");
  await assert.rejects(() => post(regression, regressionVersion), error =>
    error.code === "42704" && error.message.includes("tipo_gasto"));
  await db.exec("reset role");
  await db.exec(schemaFix);
  await db.exec(schemaFix); // Forward correction is repeatable and preserves records.
  await db.exec("set role authenticated");
  await post(regression, regressionVersion);
  assert.ok((await db.query("select lancado_financeiro_em from public.notas_fiscais where id=$1", [regression])).rows[0].lancado_financeiro_em);
  console.log("PASS: reproduced legacy trigger relation/type errors; same invoice posts after schema correction with all triggers enabled.");
  const financialHash = "c".repeat(64);
  const cost = await draft("cost", a, financialHash);
  const initialVersion = (await db.query("select versao_arquivo from public.notas_fiscais where id=$1", [cost])).rows[0].versao_arquivo;
  await assert.rejects(() => post(cost, initialVersion), /Revise/);
  const version = await review(cost);
  await assert.rejects(() => post(cost, randomUUID()), /Revise/);
  await assert.rejects(() => post(cost, version, "unclassified"), /Finalidade/);
  await assert.rejects(() => post(cost, version, "professional", randomUUID()), /Acesso negado/);
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`);
  await assert.rejects(() => post(cost, version), /Acesso negado/);
  await db.exec("select set_config('request.jwt.claim.sub','',false);");
  await assert.rejects(() => post(cost, version), /Acesso negado/);
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);`);
  await assert.rejects(() => db.query("update public.notas_fiscais set lancado_financeiro_em=now() where id=$1", [cost]), /permission denied/);
  await assert.rejects(() => db.query("update public.notas_fiscais set tipo='professional' where id=$1", [cost]), /permission denied/);
  await post(cost, version);
  const posted = (await db.query("select * from public.notas_fiscais where id=$1", [cost])).rows[0];
  assert.equal(posted.tipo, "professional");
  assert.equal(posted.lancado_financeiro_por, a);
  assert.ok(posted.lancado_financeiro_em);
  assert.equal(posted.status, "pending_review", "inventory confirmation is a separate workflow");
  await post(cost, version); // Same stale version after a lost reply: idempotent.
  assert.equal((await db.query("select versao_arquivo from public.notas_fiscais where id=$1", [cost])).rows[0].versao_arquivo, posted.versao_arquivo);
  await assert.rejects(() => db.query("update public.notas_fiscais set valor_total=999 where id=$1", [cost]), /já lançada/);
  await assert.rejects(() => db.query("update public.notas_fiscais set exclusao_solicitada_em=now(), exclusao_justificativa='Excluir teste lançado' where id=$1", [cost]), /já lançada/);
  await db.query("delete from public.notas_fiscais where id=$1", [cost]);
  assert.equal((await db.query("select id from public.notas_fiscais where id=$1", [cost])).rows.length, 1);
  const duplicate = await draft("cost", b, financialHash);
  const duplicateVersion = await review(duplicate);
  await assert.rejects(() => post(duplicate, duplicateVersion), /duplicate key/);
  assert.equal((await db.query("select lancado_financeiro_em from public.notas_fiscais where id=$1", [duplicate])).rows[0].lancado_financeiro_em, null);
  const personal = await draft();
  await post(personal, await review(personal), "personal");
  assert.equal((await db.query("select tipo from public.notas_fiscais where id=$1", [personal])).rows[0].tipo, "personal");
  const revenue = await draft("revenue");
  await post(revenue, await review(revenue, "revenue"));
  assert.equal((await db.query("select tipo from public.notas_fiscais where id=$1", [revenue])).rows[0].tipo, "unclassified");
  const closed = await draft();
  const closedVersion = await review(closed, "cost", "2024-01-15");
  await db.exec(`reset role; insert into public.fechamentos_mensais values ('${company}', '2024-01-01'); set role authenticated;`);
  await assert.rejects(() => post(closed, closedVersion), /Mês encerrado/);
  const wrongKind = await draft("cost");
  await assert.rejects(() => review(wrongKind, "revenue").then(v => post(wrongKind, v)), /CNPJ ou categoria/);
  const emptyItems = await draft();
  const emptyVersion = await review(emptyItems);
  await db.query(`update public.notas_fiscais set dados_extracao=jsonb_set(dados_extracao,'{items}','[" "]') where id=$1`, [emptyItems]);
  await assert.rejects(() => post(emptyItems, emptyVersion), /Itens ausentes/);
  const linked = await draft();
  const linkedVersion = await review(linked);
  const supplier = randomUUID(), foreignSupplier = randomUUID();
  const category = randomUUID(), foreignCategory = randomUUID();
  await db.exec("reset role");
  await db.query("insert into public.fornecedores values ($1,$2),($3,$4)", [supplier, company, foreignSupplier, randomUUID()]);
  await db.query("insert into public.categorias values ($1,$2,'personal'),($3,$4,'professional')", [category, company, foreignCategory, randomUUID()]);
  await assert.rejects(() => db.query("update public.notas_fiscais set fornecedor_id=$1 where id=$2", [foreignSupplier, linked]), /fornecedor deve pertencer/);
  await assert.rejects(() => db.query("update public.notas_fiscais set categoria_id=$1 where id=$2", [foreignCategory, linked]), /categoria deve pertencer/);
  await db.query("update public.notas_fiscais set fornecedor_id=$1, categoria_id=$2 where id=$3", [supplier, category, linked]);
  await assert.rejects(() => db.query("update public.notas_fiscais set status='confirmed' where id=$1", [linked]), /Use app_confirmar_nota_fiscal/);
  const functionSettings = (await db.query(`select proname, prosecdef, proconfig from pg_proc
    where oid in ('public.app_bloquear_mes_fechado()'::regprocedure,
      'public.app_validar_nota_fiscal()'::regprocedure,
      'public.lancar_nota_financeiro(uuid,uuid,uuid,text)'::regprocedure)`)).rows;
  for (const fn of functionSettings) {
    assert.ok(fn.proconfig.includes('search_path=""'), `${fn.proname} keeps an empty search_path`);
    assert.equal(fn.prosecdef, fn.proname === "lancar_nota_financeiro", "triggers stay security invoker");
  }
  await db.exec("set role authenticated");
  await assert.rejects(() => post(linked, linkedVersion), /mesmo escopo/);
  assert.equal((await db.query("select lancado_financeiro_em from public.notas_fiscais where id=$1", [linked])).rows[0].lancado_financeiro_em, null);
  await post(linked, linkedVersion, "personal");
  assert.ok((await db.query("select lancado_financeiro_em from public.notas_fiscais where id=$1", [linked])).rows[0].lancado_financeiro_em);
  await assert.rejects(() => db.query("update public.notas_fiscais set valor_total=12 where id=$1", [closed]), /meses encerrados/);
  console.log("PASS: supplier/category lookup inside secured RPC, tenant/scope checks, closed-month trigger, confirmation guard and unchanged security context.");
  console.log("PASS: financial posting, typed scope, duplicate/idempotence protection, ownership, permissions, immutable totals, review and closed-month guards.");
  const { checkPostedDeletion } = await import("./fixtures/posted-deletion-checks.mjs");
  await checkPostedDeletion(db, { a, b, company, draft, review });
} finally {
  await db.close();
}
