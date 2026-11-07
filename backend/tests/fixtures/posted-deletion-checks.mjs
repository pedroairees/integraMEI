// Extends the real PostgreSQL fixture, with its RLS, Storage policies and legacy triggers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function checkPostedDeletion(
  db,
  { a, b, company, draft, review },
) {
  await db.exec(`reset role;
    create table public.insumos(id uuid primary key default gen_random_uuid(),empresa_id uuid references public.empresas(id),nome text,unidade_medida text,estoque_minimo numeric default 0,ativo boolean default true,atualizado_em timestamptz default now());
    create table public.itens_nota_fiscal(id uuid primary key,nota_fiscal_id uuid references public.notas_fiscais(id),insumo_id uuid);
    create table public.historico_precos(id uuid primary key,item_nota_fiscal_id uuid);
    grant select on public.itens_nota_fiscal to authenticated;
  `);
  for (const name of [
    "20261018170000_supplies_management.sql",
    "20261019120000_invoice_auto_supplies.sql",
    "20261019140000_posted_invoice_deletion.sql",
    "20261019140000_posted_invoice_deletion.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../../../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec("set role authenticated");
  const noteRow = async (id) =>
    (await db.query("select * from public.notas_fiscais where id=$1", [id]))
      .rows[0];
  const reason = "Lançamento realizado por engano durante teste.";
  const begin = (
    n,
    why = reason,
    version = n.versao_arquivo,
    tenant = company,
  ) =>
    db.query("select public.iniciar_exclusao_nota($1,$2,$3,$4)", [
      n.id,
      tenant,
      version,
      why,
    ]);
  const finish = (n) =>
    db.query("select public.concluir_exclusao_nota($1,$2)", [n.id, company]);
  const create = async (
    kind = "cost",
    scope = "professional",
    posted = true,
  ) => {
    const id = await draft(kind);
    const version = await review(id, kind);
    await db.query(
      `update public.notas_fiscais set dados_extracao=jsonb_set(dados_extracao,'{lineItems}',$1) where id=$2`,
      [
        JSON.stringify([
          { description: "Item teste", quantity: 2, unit: "kg", unitPrice: 4 },
        ]),
        id,
      ],
    );
    if (posted)
      await db.query("select public.lancar_nota_com_insumos($1,$2,$3,$4)", [
        id,
        company,
        version,
        scope,
      ]);
    const n = await noteRow(id);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('invoice-documents',$1)",
      [n.caminho_arquivo],
    );
    return n;
  };
  // Isolated fixture only: represents the real Storage API deleting its metadata.
  const storageRemove = (n) =>
    db.query("delete from storage.objects where name=$1", [n.caminho_arquivo]);
  const priceCount = async () =>
    Number(
      (
        await db.query(
          "select count(*) as n from public.insumos_precos_registrados",
        )
      ).rows[0].n,
    );
  const cost = await create(),
    otherCost = await create();
  const supply = (await db.query("select * from public.insumos")).rows[0];
  await db.query(
    "select public.registrar_preco_insumo($1,$2,$3,'manual',null,null,'2025-01-15',1,7,'Compra manual')",
    [company, supply.id, randomUUID()],
  );
  assert.equal(await priceCount(), 3);
  await assert.rejects(() => begin(cost, "curta"), /justificativa/);
  await assert.rejects(() => begin(cost, reason, randomUUID()), /mudou/);
  await assert.rejects(
    () => begin(cost, reason, cost.versao_arquivo, randomUUID()),
    { code: "42501" },
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  await assert.rejects(() => begin(cost), { code: "42501" });
  await finish(cost); // Inaccessible ID is a safe no-op, never a cross-owner delete.
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
  await assert.rejects(
    () =>
      db.query("update public.notas_fiscais set valor_total=1 where id=$1", [
        cost.id,
      ]),
    /Nota lançada/,
  );
  await assert.rejects(
    () =>
      db.query(
        "update public.notas_fiscais set exclusao_solicitada_em=now(),exclusao_justificativa=$1 where id=$2",
        [reason, cost.id],
      ),
    /Nota lançada/,
  );
  await storageRemove(cost);
  assert.equal(
    (
      await db.query("select * from storage.objects where name=$1", [
        cost.caminho_arquivo,
      ])
    ).rows.length,
    1,
  );
  await assert.rejects(() => finish(cost), /justificativa/);
  await begin(cost);
  assert.ok((await noteRow(cost.id)).exclusao_solicitada_em);
  assert.equal(
    await priceCount(),
    2,
    "only the deleted note's price is removed, not manual/other purchases",
  );
  assert.equal(
    (await db.query("select * from public.insumos")).rows.length,
    1,
    "catalog is preserved",
  );
  assert.equal(
    (
      await db.query(
        "select * from public.notas_fiscais where id=$1 and exclusao_solicitada_em is null",
        [cost.id],
      )
    ).rows.length,
    0,
    "dashboard excludes a deletion pending storage cleanup",
  );
  await assert.rejects(() => finish(cost), /arquivo ainda/);
  await begin(cost, "Tentativa de trocar a justificativa original.");
  const audit = (
    await db.query(
      "select * from public.notas_exclusoes_auditoria where nota_id=$1",
      [cost.id],
    )
  ).rows[0];
  assert.equal(audit.justificativa, reason);
  assert.equal(audit.lancamento_removido.valor_total, 89.9);
  assert.equal(audit.precos_removidos.length, 1);
  assert.equal(audit.precos_removidos[0].valor_unitario, 4);
  assert.equal(audit.excluido_em, null);
  await storageRemove(cost);
  await assert.rejects(
    () => db.query("delete from public.notas_fiscais where id=$1", [cost.id]),
    /Nota lançada/,
  );
  await finish(cost);
  await finish(cost);
  assert.equal(await noteRow(cost.id), undefined);
  assert.ok(
    (
      await db.query(
        "select excluido_em from public.notas_exclusoes_auditoria where nota_id=$1",
        [cost.id],
      )
    ).rows[0].excluido_em,
  );
  await assert.rejects(
    () =>
      db.query(
        "delete from public.notas_exclusoes_auditoria where nota_id=$1",
        [cost.id],
      ),
    /permission denied/,
  );
  assert.ok(await noteRow(otherCost.id));
  for (const [kind, scope, posted] of [
    ["revenue", "professional", true],
    ["cost", "personal", true],
    ["cost", "professional", false],
  ]) {
    const n = await create(kind, scope, posted);
    await begin(n);
    await storageRemove(n);
    await finish(n);
    assert.equal(await noteRow(n.id), undefined);
  }
  assert.equal(await priceCount(), 2);
  const linked = await create();
  await db.exec("reset role");
  await db.query(
    "insert into public.itens_nota_fiscal(id,nota_fiscal_id) values($1,$2)",
    [randomUUID(), linked.id],
  );
  await db.exec("set role authenticated");
  await assert.rejects(() => begin(linked), /estoque/);
  assert.equal((await noteRow(linked.id)).exclusao_solicitada_em, null);
  const closed = await create();
  await db.exec("reset role");
  await db.query(
    "insert into public.fechamentos_mensais values($1,'2025-01-01')",
    [company],
  );
  await db.exec("set role authenticated");
  const before = await priceCount();
  await assert.rejects(() => begin(closed), /Mês encerrado/);
  assert.equal(await priceCount(), before);
  assert.equal((await noteRow(closed.id)).exclusao_solicitada_em, null);
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  assert.equal(
    (
      await db.query(
        "select * from public.notas_exclusoes_auditoria where nota_id=$1",
        [cost.id],
      )
    ).rows.length,
    0,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(() => begin(closed), /permission denied/);
  console.log(
    "PASS: posted cost/revenue/personal deletion; audited reversal + price cleanup atomic; catalog/manual/other purchases preserved; Storage retry; repeated deletion; stale version; owner isolation; closed month/legacy stock protected; immutable audit.",
  );
}
