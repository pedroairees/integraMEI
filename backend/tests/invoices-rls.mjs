// Optional real PostgreSQL/RLS verification using an isolated PGlite installation.
// node backend/tests/invoices-rls.mjs <absolute path to @electric-sql/pglite/dist/index.js>
// No connection to Supabase or credentials. No persistent test database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
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
    create table public.notas_fiscais(id uuid primary key, empresa_id uuid, cnpj_emissor text, numero_documento text, data_emissao date, valor_total numeric, status text default 'processing', dados_extracao jsonb default '{}', caminho_arquivo text, criado_em timestamptz default now());
    create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.usuarios u join public.membros_empresa m on m.usuario_id=u.id where u.usuario_auth_id=auth.uid() and m.empresa_id=$1) $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to authenticated;
    grant all on all tables in schema public, storage to authenticated;
    insert into auth.users values ('${a}'), ('${b}');
    insert into public.usuarios values ('${a}', '${a}'), ('${b}', '${b}');
    insert into public.membros_empresa values ('${company}', '${a}'), ('${company}', '${b}');
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
} finally {
  await db.close();
}
