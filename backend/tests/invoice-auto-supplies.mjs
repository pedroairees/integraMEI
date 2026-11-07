// Real SQL in disposable PostgreSQL. No live Supabase access or user data.
// node backend/tests/invoice-auto-supplies.mjs <pglite/dist/index.js>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const user = randomUUID(),
  stranger = randomUUID(),
  company = randomUUID(),
  other = randomUUID();
const line = (description, quantity = 2, unit = "kg", unitPrice = 5) => ({
  description,
  quantity,
  unit,
  unitPrice,
});
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table public.empresas(id uuid primary key,cnpj text);
    create table public.members(company_id uuid,user_id uuid);
    create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.members where company_id=$1 and user_id=auth.uid())$$;
    create table public.insumos(id uuid primary key default gen_random_uuid(),empresa_id uuid references public.empresas(id),nome text,unidade_medida text,estoque_minimo numeric default 0,ativo boolean default true,atualizado_em timestamptz default now());
    create table public.notas_fiscais(id uuid primary key,empresa_id uuid,enviado_por uuid,natureza text,tipo text default 'unclassified',exclusao_solicitada_em timestamptz,revisado_em timestamptz,dados_extracao jsonb,data_emissao date,valor_total numeric,status text default 'pending_review',versao_arquivo uuid default gen_random_uuid(),hash_arquivo text,cnpj_emissor text);
    create table public.itens_nota_fiscal(id uuid primary key,nota_fiscal_id uuid,insumo_id uuid);
    create table public.historico_precos(id uuid primary key,item_nota_fiscal_id uuid);
    create table public.fechamentos_mensais(empresa_id uuid,mes_fechado date);
    grant usage on schema public,auth to authenticated;
    grant select on public.notas_fiscais, public.itens_nota_fiscal to authenticated;
    alter table public.notas_fiscais enable row level security;
    create policy own_notes on public.notas_fiscais to authenticated using(enviado_por=auth.uid() and public.usuario_da_empresa(empresa_id));
    insert into auth.users values ('${user}'),('${stranger}');
    insert into public.empresas values ('${company}','12345678000195'),('${other}','11111111000111');
    insert into public.members values ('${company}','${user}'),('${other}','${stranger}');
  `);
  for (const file of [
    "20261006120000_invoice_financial_posting.sql",
    "20261018170000_supplies_management.sql",
    "20261019120000_invoice_auto_supplies.sql",
    "20261019120000_invoice_auto_supplies.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  const login = () =>
    db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
    );
  const seed = async (
    lines = [line("Farinha"), line("Manteiga", 3, "un", 4)],
    extra = {},
  ) => {
    await db.exec("reset role");
    const n = {
      id: randomUUID(),
      version: randomUUID(),
      kind: "cost",
      reviewed: true,
      total: 100,
      date: "2025-06-10",
      ...extra,
    };
    const data = {
      supplier: "Fornecedor SQL",
      cnpj: n.kind === "cost" ? "98765432000198" : "12345678000195",
      recipientCnpj: n.kind === "cost" ? "12345678000195" : "98765432000198",
      operation: "sale",
      date: n.date,
      total: n.total,
      items: lines.map((l) => l.description),
      lineItems: lines,
      ...n.data,
    };
    await db.query(
      `insert into public.notas_fiscais(id,empresa_id,enviado_por,natureza,revisado_em,dados_extracao,data_emissao,valor_total,versao_arquivo,cnpj_emissor)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        n.id,
        company,
        user,
        n.kind,
        n.reviewed ? new Date() : null,
        JSON.stringify(data),
        n.date,
        n.total,
        n.version,
        data.cnpj,
      ],
    );
    await login();
    return n;
  };
  const post = (
    n,
    scope = "professional",
    tenant = company,
    version = n.version,
  ) =>
    db.query("select public.lancar_nota_com_insumos($1,$2,$3,$4)", [
      n.id,
      tenant,
      version,
      scope,
    ]);
  const count = async (table) =>
    Number(
      (await db.query(`select count(*) as n from public.${table}`)).rows[0].n,
    );
  const pending = await seed(undefined, { reviewed: false });
  await assert.rejects(() => post(pending), /Revise/);
  assert.equal(await count("insumos"), 0);
  const note = await seed();
  assert.equal(
    await count("insumos_precos_registrados"),
    0,
    "upload and review alone do not import",
  );
  await assert.rejects(
    () => post(note, "professional", company, randomUUID()),
    /Revise/,
  );
  await post(note);
  assert.equal(await count("insumos"), 2);
  assert.equal(await count("insumos_precos_registrados"), 2);
  await post(note);
  await post(note, "personal");
  assert.equal(
    await count("insumos_precos_registrados"),
    2,
    "retry creates nothing",
  );
  const history = (
    await db.query(
      "select * from public.insumos_precos_registrados order by indice_item",
    )
  ).rows;
  assert.equal(history[0].quantidade, "2.000");
  assert.equal(history[0].valor_unitario, "5.0000");
  assert.equal(history[0].fornecedor, "Fornecedor SQL");
  assert.equal(history[0].data_compra.toISOString().slice(0, 10), "2025-06-10");
  const second = await seed([line("farinha", 1, "KG", 6)]);
  await post(second);
  assert.equal(
    await count("insumos"),
    2,
    "same normalized name/unit reuses catalog",
  );
  assert.equal(await count("insumos_precos_registrados"), 3);
  assert.equal(
    await count("itens_nota_fiscal"),
    0,
    "no legacy fiscal/inventory rows created",
  );
  const conflict = await seed([
    line("Novo rollback"),
    line("Farinha", 1, "g", 1),
  ]);
  await assert.rejects(() => post(conflict), /outra unidade/);
  assert.equal(await count("insumos"), 2, "new catalog item rolled back too");
  assert.equal(await count("insumos_precos_registrados"), 3);
  assert.equal(
    (
      await db.query(
        "select lancado_financeiro_em from public.notas_fiscais where id=$1",
        [conflict.id],
      )
    ).rows[0].lancado_financeiro_em,
    null,
    "financial posting rolled back",
  );
  for (const [lines, extra] of [
    [[line("Bad", null)], {}],
    [[line("Bad", 0)], {}],
    [[line("Bad", 1.0001)], {}],
    [[line("Bad", 1, "kg", 1.00001)], {}],
    [[line("Bad", 1, "kg", -1)], {}],
    [[line("Bad", 1, "kg", 101)], {}],
    [[], {}],
    [[line("Mismatch")], { data: { items: ["Other"] } }],
    [[line("Old note")], { data: { lineItems: null } }],
  ]) {
    const bad = await seed(lines, extra);
    await assert.rejects(() => post(bad));
  }
  assert.equal(await count("insumos"), 2);
  await post(await seed([line("Personal only", null)]), "personal");
  await post(await seed([line("Revenue only", null)], { kind: "revenue" }));
  assert.equal(
    await count("insumos"),
    2,
    "no personal/revenue catalog entries",
  );
  const repeatLines = await seed([
    line("Farinha"),
    line("Farinha", 1, "kg", 6),
  ]);
  await post(repeatLines);
  assert.equal(await count("insumos"), 2);
  assert.equal(
    await count("insumos_precos_registrados"),
    5,
    "two purchases of same product stay distinct by line index",
  );
  await db.exec("reset role");
  await db.exec("update public.insumos set ativo=false where nome='Manteiga'");
  const inactive = await seed([line("Manteiga", 1, "un", 2)]);
  await assert.rejects(() => post(inactive), /Reative/);
  assert.equal(await count("insumos_precos_registrados"), 5);
  const closed = await seed([line("Closed")]);
  await db.exec("reset role");
  await db.query(
    "insert into public.fechamentos_mensais values ($1,'2025-06-01')",
    [company],
  );
  await login();
  await assert.rejects(() => post(closed), /Mês encerrado/);
  await assert.rejects(() => post(closed, "professional", other), {
    code: "42501",
  });
  await db.exec(
    `select set_config('request.jwt.claim.sub','${stranger}',false)`,
  );
  await assert.rejects(() => post(closed), { code: "42501" });
  assert.equal(await count("insumos"), 0);
  await login();
  await assert.rejects(
    () =>
      db.query(
        "select public.lancar_nota_financeiro($1,$2,$3,'professional')",
        [closed.id, company, closed.version],
      ),
    /permission denied/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(() => post(closed), /permission denied/);
  console.log(
    "PASS: atomic invoice posting + supplies; draft isolation; reuse; repeat-safe; rollback; unit/decimal/total validation; closed month; tenant isolation; old RPC inaccessible.",
  );
} finally {
  await db.close();
}
