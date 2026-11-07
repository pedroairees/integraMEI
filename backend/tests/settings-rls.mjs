import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const u = randomUUID(),
  v = randomUUID(),
  c = randomUUID(),
  d = randomUUID(),
  p = randomUUID(),
  q = randomUUID();
const input = {
  fullName: "Nome atualizado",
  phone: "61987654321",
  emailAlerts: true,
  invoiceReminders: false,
  lowStockAlerts: false,
  timeZone: "America/Manaus",
};
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_change text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.usuarios(id uuid primary key,usuario_auth_id uuid unique,nome_completo text,telefone text,email text,atualizado_em timestamptz default now());
 create table public.empresas(id uuid primary key,cnpj text);create table public.membros_empresa(usuario_id uuid,empresa_id uuid);
 create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.membros_empresa m join public.usuarios u on u.id=m.usuario_id where empresa_id=$1 and u.usuario_auth_id=auth.uid())$$;
 grant usage on schema public,auth to authenticated,anon;grant update on public.usuarios to authenticated;
 insert into auth.users values('${u}','one@example.test',null),('${v}','two@example.test',null);
 insert into public.usuarios values('${p}','${u}','Primeiro','61912345678','one@example.test',now()),('${q}','${v}','Segundo','61900000000','two@example.test',now());
 insert into public.empresas values('${c}','12345678000195'),('${d}','98765432000198');insert into public.membros_empresa values('${p}','${c}'),('${q}','${d}');`);
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261104120000_account_settings.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${u}',false);`,
  );
  const get = async (company = c) =>
    (await db.query("select public.dados_configuracoes($1) d", [company]))
      .rows[0].d;
  const save = async (data = input, company = c) =>
    (
      await db.query("select public.salvar_configuracoes($1,$2) d", [
        company,
        data,
      ])
    ).rows[0].d;
  assert.equal((await get()).fullName, "Primeiro");
  assert.equal((await get()).emailAlerts, false);
  assert.equal((await save()).phone, input.phone);
  assert.equal((await get()).timeZone, "America/Manaus");
  await assert.rejects(() => get(d), { code: "42501" });
  await assert.rejects(() => save(input, d), { code: "42501" });
  for (const patch of [
    { email: "spoof@example.test" },
    { fullName: null },
    { phone: "123" },
    { timeZone: "bad" },
    { emailAlerts: null },
    { invoiceReminders: "true" },
  ])
    await assert.rejects(() => save({ ...input, ...patch }), { code: "22023" });
  await assert.rejects(
    () =>
      db.exec(
        `update public.usuarios set email='spoof@example.test' where id='${p}'`,
      ),
    /permission denied/,
  );
  await assert.rejects(
    () => db.exec(`update public.preferencias_usuario set alertas_email=false`),
    /permission denied/,
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${v}',false);`);
  assert.equal((await get(d)).fullName, "Segundo");
  assert.equal(
    (await db.query("select * from public.preferencias_usuario")).rows.length,
    0,
  );
  await db.exec(
    `reset role; update auth.users set email_change='new@example.test' where id='${u}'`,
  );
  assert.equal(
    (await db.query("select email from public.usuarios where id=$1", [p]))
      .rows[0].email,
    "one@example.test",
  );
  await db.exec(
    `update auth.users set email='new@example.test' where id='${u}'`,
  );
  assert.equal(
    (await db.query("select email from public.usuarios where id=$1", [p]))
      .rows[0].email,
    "new@example.test",
  );
  await db.exec("set role anon");
  await assert.rejects(() => get(), /permission denied/);
  console.log(
    "PASS settings SQL: own profile, persistence, isolation, validation, permissions and confirmed email synchronization.",
  );
} finally {
  await db.close();
}
