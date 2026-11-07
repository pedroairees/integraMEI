// Isolated PostgreSQL: node backend/tests/supplies-rls.mjs <pglite/dist/index.js>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const a = randomUUID(),
  b = randomUUID(),
  company = randomUUID(),
  other = randomUUID(),
  note = randomUUID();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table public.empresas(id uuid primary key);
    create table public.members(company_id uuid,user_id uuid);
    create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.members where company_id=$1 and user_id=auth.uid())$$;
    create table public.insumos(id uuid primary key default gen_random_uuid(),empresa_id uuid not null references public.empresas(id),nome text not null,unidade_medida text not null,estoque_minimo numeric default 0,ativo boolean default true,atualizado_em timestamptz default now());
    create table public.notas_fiscais(id uuid primary key,empresa_id uuid,enviado_por uuid,natureza text,tipo text,lancado_financeiro_em timestamptz,exclusao_solicitada_em timestamptz,revisado_em timestamptz,dados_extracao jsonb,data_emissao date,valor_total numeric);
    create table public.itens_nota_fiscal(id uuid primary key,nota_fiscal_id uuid,insumo_id uuid);
    create table public.historico_precos(id uuid primary key,item_nota_fiscal_id uuid);
    create table public.fechamentos_mensais(empresa_id uuid,mes_fechado date);
    create policy old_broad_policy on public.insumos for all to authenticated using(true) with check(true);
    grant usage on schema public,auth to authenticated;
    grant all on all tables in schema public to authenticated;
    insert into auth.users values ('${a}'),('${b}');
    insert into public.empresas values ('${company}'),('${other}');
    insert into public.members values ('${company}','${a}'),('${other}','${b}');
    insert into public.notas_fiscais values ('${note}','${company}','${a}','cost','professional',now(),null,now(),'{"supplier":"Loja da nota","items":["Farinha","Manteiga"]}','2025-06-10',100);
  `);
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261018170000_supplies_management.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);`,
  );
  const save = (
    id = null,
    version = null,
    name = "Farinha",
    unit = "kg",
    minimum = 0,
    active = true,
    tenant = company,
  ) =>
    db.query("select * from public.salvar_insumo($1,$2,$3,$4,$5,$6,$7)", [
      tenant,
      id,
      version,
      name,
      unit,
      minimum,
      active,
    ]);
  const s = (await save()).rows[0];
  await assert.rejects(() => save(null, null, " farinha "), { code: "23505" });
  await assert.rejects(() => save(null, null, " "), /inválidos/);
  await assert.rejects(() => save(s.id, randomUUID()), /mudou/);
  await assert.rejects(
    () => save(s.id, s.versao_cadastro, "Farinha", "g"),
    /unidade/,
  );
  await assert.rejects(() => save(null, null, "Outro", "kg", 0, true, other), {
    code: "42501",
  });
  await assert.rejects(
    () =>
      db.query("update public.insumos set empresa_id=$1 where id=$2", [
        other,
        s.id,
      ]),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("delete from public.insumos where id=$1", [s.id]),
    /permission denied/,
  );
  const base = {
    id: randomUUID(),
    source: "manual",
    invoice: null,
    item: null,
    date: "2025-06-10",
    qty: 2,
    price: 4.75,
    supplier: "Loja manual",
    tenant: company,
    supply: s.id,
  };
  const add = (overrides = {}) => {
    const p = { ...base, ...overrides };
    return db.query(
      "select public.registrar_preco_insumo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        p.tenant,
        p.supply,
        p.id,
        p.source,
        p.invoice,
        p.item,
        p.date,
        p.qty,
        p.price,
        p.supplier,
      ],
    );
  };
  await add();
  await add();
  assert.equal(
    (await db.query("select * from public.insumos_precos_registrados")).rows
      .length,
    1,
  );
  await assert.rejects(() => add({ price: 99 }), { code: "23505" });
  for (const override of [
    { qty: 0 },
    { price: -1 },
    { price: "NaN" },
    { qty: "Infinity" },
    { qty: 0.0001 },
    { price: 1.00001 },
    { date: "2099-01-01" },
    { supplier: " " },
    { source: "bad" },
    { invoice: note },
  ])
    await assert.rejects(() => add({ id: randomUUID(), ...override }));
  const linked = {
    id: randomUUID(),
    source: "invoice",
    invoice: note,
    item: 0,
    date: null,
    supplier: null,
    qty: 10,
    price: 5,
  };
  await add(linked);
  await add(linked);
  const row = (
    await db.query(
      "select * from public.insumos_precos_registrados where id=$1",
      [linked.id],
    )
  ).rows[0];
  assert.equal(row.fornecedor, "Loja da nota");
  assert.equal(row.data_compra.toISOString().slice(0, 10), "2025-06-10");
  assert.equal(row.unidade_medida, "kg");
  assert.equal(
    (
      await db.query(
        "select valor_total from public.notas_fiscais where id=$1",
        [note],
      )
    ).rows[0].valor_total,
    "100",
  );
  await assert.rejects(() => add({ ...linked, id: randomUUID() }), {
    code: "23505",
  });
  await assert.rejects(
    () => add({ ...linked, id: randomUUID(), item: 1, price: 10 }),
    /ultrapassa/,
  );
  await assert.rejects(
    () => add({ ...linked, id: randomUUID(), item: 2 }),
    /Selecione/,
  );
  await assert.rejects(
    () => add({ ...linked, id: randomUUID(), invoice: randomUUID() }),
    { code: "42501" },
  );
  await db.exec("reset role");
  await db.query(
    "update public.notas_fiscais set natureza='revenue' where id=$1",
    [note],
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    () => add({ ...linked, id: randomUUID(), item: 1 }),
    /custo profissional/,
  );
  await db.exec("reset role");
  await db.query(
    "update public.notas_fiscais set natureza='cost',tipo='personal' where id=$1",
    [note],
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    () => add({ ...linked, id: randomUUID(), item: 1 }),
    /custo profissional/,
  );
  await db.exec("reset role");
  await db.query(
    "update public.notas_fiscais set tipo='professional' where id=$1",
    [note],
  );
  await db.query(
    "insert into public.fechamentos_mensais values ($1,'2025-06-01')",
    [company],
  );
  await db.exec("set role authenticated");
  await assert.rejects(() => add({ id: randomUUID() }), /Mês encerrado/);
  await assert.rejects(
    () => add({ ...linked, id: randomUUID(), item: 1 }),
    /Mês encerrado/,
  );
  const archived = (
    await save(s.id, s.versao_cadastro, "Farinha", "kg", 2, false)
  ).rows[0];
  await assert.rejects(
    () => add({ id: randomUUID(), date: "2025-07-01" }),
    /Reative/,
  );
  await save(s.id, archived.versao_cadastro, "Farinha", "kg", 2, true);
  await assert.rejects(
    () => db.exec("delete from public.insumos_precos_registrados"),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      db.exec(
        "update public.insumos_precos_registrados set valor_unitario=999",
      ),
    /permission denied/,
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`);
  assert.equal((await db.query("select * from public.insumos")).rows.length, 0);
  assert.equal(
    (await db.query("select * from public.insumos_precos_registrados")).rows
      .length,
    0,
  );
  await assert.rejects(() => add({ id: randomUUID() }), { code: "42501" });
  await assert.rejects(
    () => save(s.id, s.versao_cadastro, "Farinha", "kg", 0, true, other),
    { code: "42501" },
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(() => save(), /permission denied/);
  console.log(
    "PASS: migration repeatable; company isolation; controlled catalog edits; archive/reactivate; manual/invoice prices; idempotence; duplicate items; totals and closed-month guards; no financial writes.",
  );
} finally {
  await db.close();
}
