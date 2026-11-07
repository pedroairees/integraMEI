// Isolated PostgreSQL: node backend/tests/pricing-rls.mjs <pglite/dist/index.js>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const user = randomUUID(),
  company = randomUUID(),
  other = randomUUID(),
  supply = randomUUID(),
  foreign = randomUUID(),
  empty = randomUUID(),
  note = randomUUID(),
  product = randomUUID();
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.empresas(id uuid primary key,imposto_percentual numeric not null default 0);
 create table public.members(company_id uuid,user_id uuid);
 create function public.usuario_da_empresa(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.members where company_id=$1 and user_id=auth.uid())$$;
 create table public.produtos(id uuid primary key,empresa_id uuid references public.empresas,nome text,custo_base numeric,markup_padrao numeric,preco_venda numeric,ativo boolean default true,atualizado_em timestamptz default now());
 create table public.insumos(id uuid primary key,empresa_id uuid,nome text,unidade_medida text,ativo boolean default true);
 create table public.insumos_produto(produto_id uuid references public.produtos,insumo_id uuid references public.insumos,quantidade numeric,primary key(produto_id,insumo_id));
 create table public.notas_fiscais(id uuid primary key,empresa_id uuid,natureza text,tipo text,status text,lancado_financeiro_em timestamptz,exclusao_solicitada_em timestamptz);
 create table public.itens_nota_fiscal(id uuid primary key,nota_fiscal_id uuid);
 create table public.historico_precos(id uuid primary key,empresa_id uuid,insumo_id uuid,item_nota_fiscal_id uuid,unidade_medida text,data_compra date,valor_unitario numeric,criado_em timestamptz default now());
 create table public.insumos_precos_registrados(id uuid primary key default gen_random_uuid(),empresa_id uuid,insumo_id uuid,nota_fiscal_id uuid,origem text,unidade_medida text,data_compra date,valor_unitario numeric,criado_em timestamptz default now());
 grant usage on schema public,auth to authenticated,anon;
 grant all on all tables in schema public to authenticated,anon;
 create policy old_open on public.produtos for all using(true) with check(true);
 create policy old_open on public.insumos_produto for all using(true) with check(true);
 insert into public.empresas(id) values('${company}'),('${other}');
 insert into public.members values('${company}','${user}');
 insert into public.insumos values('${supply}','${company}','Farinha','kg',true),('${foreign}','${other}','Privado','kg',true),('${empty}','${company}','Sem preço','kg',true);
 insert into public.produtos(id,empresa_id,nome,custo_base,markup_padrao) values('${randomUUID()}','${other}','Segredo',1,100);
 insert into public.notas_fiscais values('${note}','${company}','cost','professional','pending_review',null,null);
 insert into public.insumos_precos_registrados(empresa_id,insumo_id,origem,unidade_medida,data_compra,valor_unitario) values('${company}','${supply}','manual','kg','2025-01-01',6);
 `);
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261019160000_product_pricing.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`,
  );
  const base = {
    name: "Bolo",
    baseCost: 20,
    markup: 100,
    currentPrice: 30,
    monthlyUnits: 10,
    ingredients: [],
  };
  const quote = async (input = base, tenant = company) =>
    (
      await db.query("select public.calcular_precificacao($1,$2) as result", [
        tenant,
        input,
      ])
    ).rows[0].result;
  const save = async (input = base, version = null, id = product) =>
    (
      await db.query(
        "select public.salvar_precificacao($1,$2,$3,$4) as result",
        [company, id, version, input],
      )
    ).rows[0].result;
  const options = async () =>
    (
      await db.query("select public.dados_precificacao($1) as result", [
        company,
      ])
    ).rows[0].result;
  assert.equal((await quote()).suggestedPrice, 40);
  assert.equal((await quote()).margin, 50);
  assert.equal((await quote()).monthlyRevenue, 400);
  assert.equal((await quote({ ...base, markup: 80 })).suggestedPrice, 36);
  assert.equal(
    (await quote({ ...base, baseCost: 0.1, markup: 50 })).suggestedPrice,
    0.15,
  );
  await assert.rejects(() => quote({ ...base, baseCost: 0 }), /Impossível/);
  await assert.rejects(() => quote({ ...base, markup: -1 }), /inválidos/);
  await assert.rejects(() => quote(base, other), { code: "42501" });
  const recipe = {
    ...base,
    baseCost: 2,
    ingredients: [{ supplyId: supply, quantity: 0.5 }],
  };
  assert.equal((await quote(recipe)).cost, 5);
  await assert.rejects(
    () =>
      quote({ ...recipe, ingredients: [{ supplyId: foreign, quantity: 1 }] }),
    { code: "42501" },
  );
  await assert.rejects(
    () => quote({ ...recipe, ingredients: [{ supplyId: empty, quantity: 1 }] }),
    /sem preço/,
  );
  await assert.rejects(
    () =>
      quote({
        ...recipe,
        ingredients: [...recipe.ingredients, ...recipe.ingredients],
      }),
    /repetido/,
  );
  await assert.rejects(
    () =>
      quote({
        ...recipe,
        ingredients: [{ supplyId: supply, quantity: 0.0001 }],
      }),
    /Quantidade/,
  );
  const saved = await save(recipe);
  assert.equal(saved.quote.suggestedPrice, 10);
  assert.equal((await options()).products.length, 1);
  assert.equal((await options()).products[0].ingredients[0].quantity, 0.5);
  await assert.rejects(() => save(recipe, null), /produto mudou/);
  await assert.rejects(
    () => save({ ...recipe, name: " BOLO " }, null, randomUUID()),
    /existe/,
  );
  await assert.rejects(
    () =>
      save(
        { ...recipe, ingredients: [{ supplyId: foreign, quantity: 1 }] },
        saved.version,
      ),
    { code: "42501" },
  );
  assert.equal((await options()).products[0].version, saved.version); // Failed edit rolled back.
  await assert.rejects(
    () => db.exec(`update public.produtos set custo_base=1`),
    /permission denied/,
  );
  await assert.rejects(
    () => db.exec(`delete from public.insumos_produto`),
    /permission denied/,
  );
  assert.equal(
    (await db.query("select * from public.produtos")).rows.length,
    1,
  ); // Restricts old broad RLS.
  await assert.rejects(
    () =>
      db.query("select * from public.precificacao_ultimo_preco($1,$2)", [
        company,
        supply,
      ]),
    /permission denied/,
  );
  await db.exec(`reset role;insert into public.insumos_precos_registrados(empresa_id,insumo_id,nota_fiscal_id,origem,unidade_medida,data_compra,valor_unitario) values
 ('${company}','${supply}','${note}','invoice','kg','2025-02-01',16),
 ('${company}','${supply}',null,'manual','g','2025-03-01',1000),
 ('${company}','${supply}',null,'manual','kg','2999-01-01',999);
 set role authenticated;`);
  assert.equal((await quote(recipe)).cost, 5); // Draft invoice, wrong units and future dates ignored.
  await db.exec(
    `reset role;update public.notas_fiscais set lancado_financeiro_em=now();set role authenticated;`,
  );
  assert.equal((await quote(recipe)).cost, 10);
  assert.equal((await options()).products[0].referenceCost, 5);
  await db.exec(
    `reset role;update public.notas_fiscais set tipo='personal';set role authenticated;`,
  );
  assert.equal((await quote(recipe)).cost, 5);
  await db.exec(
    `reset role;update public.notas_fiscais set tipo='professional',exclusao_solicitada_em=now();update public.empresas set imposto_percentual=10 where id='${company}';set role authenticated;`,
  );
  assert.equal((await quote(recipe)).suggestedPrice, 11);
  assert.equal((await quote(recipe)).taxCost, 0.5);
  const updated = await save({ ...base, baseCost: 25 }, saved.version);
  assert.notEqual(updated.version, saved.version);
  assert.equal((await options()).products[0].ingredients.length, 0);
  await assert.rejects(() => save(base, saved.version), /produto mudou/);
  await db.exec(
    `reset role;update public.insumos set ativo=false where id='${supply}';set role authenticated;`,
  );
  await assert.rejects(() => quote(recipe), /inativo/);
  await db.exec("reset role;set role anon");
  await assert.rejects(() => options(), /permission denied/);
  console.log(
    "PASS pricing: documented formula, precision, taxes, recipes, current purchases, posting/deletion filters, persistence, conflict and tenant isolation.",
  );
} finally {
  await db.close();
}
