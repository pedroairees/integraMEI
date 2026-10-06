import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "../src/core/errors.ts";
import {
  InvoiceService,
  MAX_FILE_SIZE,
  parseExtraction,
  validateUpload,
} from "../src/core/invoices/service.ts";
import type {
  ExtractedInvoice,
  Invoice,
  InvoiceFilter,
  InvoiceRepository,
} from "../src/core/invoices/types.ts";
import { SupabaseInvoiceRepository } from "../src/infra/supabase/invoices.ts";
import { GeminiInvoiceReader } from "../src/infra/ocr/gemini.ts";
import { OcrFailure } from "../src/infra/ocr/transport.ts";
import { buildApp } from "../src/web/app.ts";
import type { DashboardRepository } from "../src/core/dashboard/types.ts";

const pdf = Buffer.from("%PDF-1.4\nDocumento de teste\n%%EOF");
const payload = {
  name: "nota.pdf",
  mime: "application/pdf",
  content: pdf.toString("base64"),
  kind: "cost" as const,
};
const extraction: ExtractedInvoice = {
  supplier: "Fornecedor teste",
  cnpj: "12345678000195",
  recipientCnpj: "98765432000198",
  operation: "sale",
  date: "2026-09-01",
  total: 15.25,
  number: "42",
  items: ["Farinha"],
};
class MemoryRepository implements InvoiceRepository {
  async companyCnpj() {
    return "98765432000198";
  }
  records = new Map<string, Invoice>();
  files = new Map<string, Buffer>();
  failInsert = false;
  failUpload = false;
  lostReply = false;
  failRemoval = false;
  failFinish = false;
  list(filter: InvoiceFilter) {
    return Promise.resolve(
      [...this.records.values()]
        .filter((n) => n.natureza === filter.kind)
        .slice(filter.offset, filter.offset + 50),
    );
  }
  get(id: string) {
    const row = this.records.get(id);
    if (!row) throw new AppError(404, "Nota não encontrada.");
    return Promise.resolve(row);
  }
  duplicate(hash: string) {
    return Promise.resolve(
      [...this.records.values()].find((n) => n.hash_arquivo === hash) ?? null,
    );
  }
  filePath(id: string, extension: string) {
    return `owner/company/${id}.${extension}`;
  }
  upload(path: string, data: Buffer) {
    if (this.failUpload) throw new AppError(502, "Storage offline");
    this.files.set(path, data);
    return Promise.resolve();
  }
  removeFile(path: string) {
    if (this.failRemoval) throw new AppError(502, "Storage offline");
    this.files.delete(path);
    return Promise.resolve();
  }
  insert(invoice: Invoice) {
    if (this.failInsert) throw new AppError(502, "Database offline");
    this.records.set(invoice.id, invoice);
    if (this.lostReply) throw new AppError(502, "Lost response");
    return Promise.resolve(invoice);
  }
  download(invoice: Invoice) {
    return Promise.resolve(this.files.get(invoice.caminho_arquivo)!);
  }
  save(invoice: Invoice, data: ExtractedInvoice, reviewed: boolean) {
    if (
      this.records.get(invoice.id)?.exclusao_solicitada_em ||
      this.records.get(invoice.id)?.versao_arquivo !== invoice.versao_arquivo
    )
      throw new AppError(409, "Changed");
    const next = {
      ...invoice,
      dados_extracao: data,
      revisado_em: reviewed ? new Date().toISOString() : null,
      versao_arquivo: randomUUID(),
    };
    this.records.set(invoice.id, next);
    return Promise.resolve(next);
  }
  async beginDeletion(invoice: Invoice, reason: string) {
    const next = {
      ...invoice,
      exclusao_justificativa: invoice.exclusao_justificativa || reason,
      exclusao_solicitada_em:
        invoice.exclusao_solicitada_em || new Date().toISOString(),
    };
    this.records.set(invoice.id, next);
    return next;
  }
  async finishDeletion(invoice: Invoice) {
    if (this.failFinish) throw new AppError(502, "Database offline");
    this.records.delete(invoice.id);
  }
  async post(invoice: Invoice, scope: "professional" | "personal") {
    const next = { ...invoice, lancado_financeiro_em: new Date().toISOString(), tipo: scope };
    this.records.set(invoice.id, next); return next;
  }
}
const reader = { read: async () => extraction };
const reason = "Arquivo enviado por engano durante o teste.";

test("deletion removes file and record, is idempotent, and never deletes confirmed financial data", async () => {
  const repo = new MemoryRepository(),
    service = new InvoiceService(repo, reader);
  const { invoice } = await service.upload(payload);
  repo.records.set(invoice.id, { ...invoice, status: "confirmed" });
  await assert.rejects(() => service.delete(invoice.id, reason), {
    status: 409,
  });
  assert.equal(repo.files.size, 1);
  repo.records.set(invoice.id, invoice);
  await service.delete(invoice.id, reason);
  assert.equal(repo.files.size, 0);
  assert.equal(repo.records.size, 0);
  await service.delete(invoice.id, reason);
});
test("failed deletion is recoverable and never reports success or loses the retry record", async () => {
  const repo = new MemoryRepository(),
    service = new InvoiceService(repo, reader);
  const { invoice } = await service.upload(payload);
  repo.failRemoval = true;
  await assert.rejects(() => service.delete(invoice.id, reason));
  assert.equal(repo.files.size, 1);
  assert.ok((await repo.get(invoice.id)).exclusao_solicitada_em);
  await assert.rejects(() => service.read(invoice.id), { status: 409 });
  await assert.rejects(
    () => service.review(invoice.id, invoice.versao_arquivo, extraction),
    { status: 409 },
  );
  repo.failRemoval = false;
  repo.failFinish = true;
  await assert.rejects(() =>
    service.delete(invoice.id, "Outra justificativa diferente"),
  );
  assert.equal((await repo.get(invoice.id)).exclusao_justificativa, reason);
  assert.equal(repo.files.size, 0);
  assert.equal(repo.records.size, 1);
  repo.failFinish = false;
  await new InvoiceService(repo, reader).delete(invoice.id, reason);
  assert.equal(repo.records.size, 0);
});

test("upload saves the exact private file and an unconfirmed invoice; duplicate does not create copies", async () => {
  const repo = new MemoryRepository(),
    service = new InvoiceService(repo, reader);
  const result = await service.upload(payload);
  assert.equal(result.duplicate, false);
  assert.equal(result.invoice.status, "pending_review");
  assert.equal(result.invoice.dados_extracao.total, extraction.total);
  assert.deepEqual(await repo.download(result.invoice), pdf);
  const duplicate = await service.upload({
    ...payload,
    name: "renamed.pdf",
    kind: "cost",
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.invoice.id, result.invoice.id);
  assert.equal(repo.files.size, 1);
  // New service instance after login uses the same durable repository.
  assert.equal(
    (
      await new InvoiceService(repo, reader).repository.list({
        kind: "cost",
        period: "all",
        offset: 0,
      })
    ).length,
    1,
  );
});
test("validation rejects spoofed MIME, oversized, empty and traversal uploads before storage", async () => {
  const repo = new MemoryRepository(),
    service = new InvoiceService(repo, reader);
  for (const bad of [
    { ...payload, content: Buffer.from("<html>bad</html>").toString("base64") },
    { ...payload, mime: "image/png" },
    { ...payload, content: "" },
    { ...payload, name: "../other.pdf" },
    { ...payload, content: Buffer.alloc(MAX_FILE_SIZE + 1).toString("base64") },
  ])
    await assert.rejects(() => service.upload(bad), AppError);
  assert.equal(repo.files.size, 0);
  assert.equal(repo.records.size, 0);
  assert.equal(validateUpload(payload).extension, "pdf");
  // Large valid base64 must not exhaust the regexp stack.
  const large = Buffer.alloc(MAX_FILE_SIZE, 32);
  pdf.subarray(0, 8).copy(large);
  Buffer.from("%%EOF").copy(large, large.length - 5);
  assert.equal(
    validateUpload({ ...payload, content: large.toString("base64") }).file
      .length,
    MAX_FILE_SIZE,
  );
});
test("failed storage never writes a record; failed DB compensates; lost DB reply preserves referenced file", async () => {
  const repo = new MemoryRepository(),
    service = new InvoiceService(repo, reader);
  repo.failUpload = true;
  await assert.rejects(() => service.upload(payload));
  assert.equal(repo.records.size, 0);
  repo.failUpload = false;
  repo.failInsert = true;
  await assert.rejects(() => service.upload(payload));
  assert.equal(repo.files.size, 0);
  repo.failInsert = false;
  repo.lostReply = true;
  const result = await service.upload(payload);
  assert.equal(result.duplicate, false);
  assert.equal(repo.files.size, 1);
  assert.equal(repo.records.size, 1);
});
test("OCR failure rejects new uploads without storage writes; existing files survive read failure", async () => {
  const repo = new MemoryRepository();
  const service = new InvoiceService(repo, {
    read: async () => {
      throw new AppError(503, "OCR unavailable");
    },
  });
  await assert.rejects(() => service.upload(payload));
  assert.equal(repo.files.size, 0);
  assert.equal(repo.records.size, 0);
  const { invoice } = await new InvoiceService(repo, reader).upload(payload);
  await assert.rejects(() => service.read(invoice.id));
  assert.equal(repo.records.size, 1);
  assert.equal(repo.files.size, 1);
  await assert.rejects(() =>
    service.review(invoice.id, invoice.versao_arquivo, {
      ...extraction,
      items: [],
    }),
  );
  const saved = await service.review(
    invoice.id,
    invoice.versao_arquivo,
    extraction,
  );
  assert.equal(saved.status, "pending_review");
  assert.ok(saved.revisado_em);
  await assert.rejects(() => service.read(invoice.id), { status: 409 });
  await assert.rejects(
    () => service.review(invoice.id, invoice.versao_arquivo, extraction),
    { status: 409 },
  );
});
test("OCR requires human review and cannot overwrite a simultaneous review", async () => {
  const repo = new MemoryRepository();
  const { invoice } = await new InvoiceService(repo, reader).upload(payload);
  let finish!: (data: ExtractedInvoice) => void;
  const service = new InvoiceService(repo, {
    read: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const reading = service.read(invoice.id);
  await new Promise((resolve) => setImmediate(resolve));
  await service.review(invoice.id, invoice.versao_arquivo, {
    ...extraction,
    total: 25,
  });
  finish(extraction);
  await assert.rejects(() => reading, { status: 409 });
  assert.equal((await repo.get(invoice.id)).dados_extracao.total, 25);
});
test("untrusted OCR is bounded, dates validated and no invented missing values", () => {
  const parsed = parseExtraction({
    ...extraction,
    date: "2026-02-31",
    cnpj: "bad",
    total: -4,
    items: [null, "", "Item"],
  });
  assert.equal(parsed.date, null);
  assert.equal(parsed.total, null);
  assert.equal(parsed.cnpj, null);
  assert.deepEqual(parsed.items, ["Item"]);
  assert.throws(() => parseExtraction(parsed, true), { status: 422 });
});

test("category is determined by the company's role before persistence, never the tab or filename", async () => {
  for (const [data, kind, accepted] of [
    [extraction, "cost", true],
    [extraction, "revenue", false],
    [
      {
        ...extraction,
        cnpj: extraction.recipientCnpj,
        recipientCnpj: extraction.cnpj,
      },
      "revenue",
      true,
    ],
    [
      { ...extraction, cnpj: extraction.recipientCnpj, recipientCnpj: null },
      "revenue",
      true,
    ],
    [
      {
        ...extraction,
        cnpj: extraction.recipientCnpj,
        recipientCnpj: extraction.cnpj,
      },
      "cost",
      false,
    ],
    [{ ...extraction, recipientCnpj: null }, "cost", false],
    [{ ...extraction, recipientCnpj: extraction.cnpj }, "cost", false],
    [{ ...extraction, cnpj: extraction.recipientCnpj }, "revenue", false],
    [{ ...extraction, cnpj: "00000000000000" }, "cost", false],
    [{ ...extraction, operation: "other" }, "cost", false],
    [{ ...extraction, operation: null }, "cost", false],
  ] as const) {
    const repo = new MemoryRepository();
    const service = new InvoiceService(repo, { read: async () => data });
    if (accepted) await service.upload({ ...payload, kind });
    else
      await assert.rejects(() => service.upload({ ...payload, kind }), {
        status: 422,
      });
    assert.equal(repo.files.size, accepted ? 1 : 0);
    assert.equal(repo.records.size, accepted ? 1 : 0);
  }
});

test("duplicates and manual review cannot bypass category validation; deletion always requires reason", async () => {
  const repo = new MemoryRepository(),
    service = new InvoiceService(repo, reader);
  const { invoice } = await service.upload(payload);
  await assert.rejects(() => service.upload({ ...payload, kind: "revenue" }), {
    status: 422,
  });
  for (const patch of [
    { cnpj: extraction.recipientCnpj },
    { recipientCnpj: null },
    { operation: "other" },
  ])
    await assert.rejects(
      () =>
        service.review(invoice.id, invoice.versao_arquivo, {
          ...extraction,
          ...patch,
        }),
      { status: 422 },
    );
  for (const invalid of ["", "          ", "curto", "x".repeat(1001)])
    await assert.rejects(() => service.delete(invoice.id, invalid), {
      status: 400,
    });
  assert.equal(repo.files.size, 1);
  assert.equal((await repo.get(invoice.id)).exclusao_solicitada_em, undefined);
  repo.records.set(invoice.id, { ...invoice, natureza: "revenue" });
  await assert.rejects(() => service.read(invoice.id), { status: 422 });
  await assert.rejects(
    () => service.review(invoice.id, invoice.versao_arquivo, extraction),
    { status: 422 },
  );
});
test("Supabase queries always filter owner + company, including guessed IDs", async () => {
  const calls: URL[] = [];
  const client = createClient("http://supabase.test", "test-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        return Response.json([]);
      },
    },
  });
  const repo = new SupabaseInvoiceRepository(client, "owner-a", "company-a");
  await repo.list({ kind: "cost", period: "all", offset: 0 });
  await assert.rejects(() => repo.get(randomUUID()), { status: 404 });
  await repo.duplicate("f".repeat(64));
  for (const url of calls) {
    assert.equal(url.searchParams.get("enviado_por"), "eq.owner-a");
    assert.equal(url.searchParams.get("empresa_id"), "eq.company-a");
  }
});
test("invoice API enforces session, schema, download isolation and no-store", async () => {
  const a = new MemoryRepository(),
    b = new MemoryRepository();
  const app = await buildApp(
    async (token) => {
      if (!["a", "b"].includes(token)) throw new AppError(401, "Invalid");
      return {
        tenant: { companyId: token, profileId: token, role: "owner" },
        repository: {} as DashboardRepository,
        invoices: token === "a" ? a : b,
      };
    },
    { invoiceReader: reader },
  );
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/invoices" })).statusCode,
      401,
    );
    const headers = { authorization: "Bearer a" };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/invoices",
          headers,
          payload: { ...payload, enviado_por: "b" },
        })
      ).statusCode,
      400,
    );
    const upload = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers,
      payload,
    });
    assert.equal(upload.statusCode, 201);
    const invoice = upload.json().invoice;
    for (const reason of [undefined, "    ", "short", "x".repeat(1001)]) {
      const response = await app.inject({
        method: "DELETE",
        url: `/v1/invoices/${invoice.id}`,
        headers,
        ...(reason === undefined ? {} : { payload: { reason } }),
      });
      assert.equal(response.statusCode, 400);
    }
    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/v1/invoices/${invoice.id}`,
      headers: { authorization: "Bearer b" },
      payload: { reason },
    });
    assert.equal(foreignDelete.statusCode, 200);
    assert.equal(a.files.size, 1);
    const file = await app.inject({
      method: "GET",
      url: `/v1/invoices/${invoice.id}/file`,
      headers,
    });
    assert.equal(file.statusCode, 200);
    assert.deepEqual(file.rawPayload, pdf);
    assert.match(file.headers["content-disposition"] as string, /^attachment/);
    assert.equal(file.headers["cache-control"], "private, no-store");
    for (const [method, suffix] of [
      ["GET", "file"],
      ["POST", "read"],
    ] as const)
      assert.equal(
        (
          await app.inject({
            method,
            url: `/v1/invoices/${invoice.id}/${suffix}`,
            headers: { authorization: "Bearer b" },
          })
        ).statusCode,
        404,
      );
    assert.deepEqual(
      (
        await app.inject({
          method: "GET",
          url: "/v1/invoices?kind=cost",
          headers: { authorization: "Bearer b" },
        })
      ).json().invoices,
      [],
    );
    const read = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoice.id}/read`,
      headers,
    });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().invoice.dados_extracao.total, 15.25);
  } finally {
    await app.close();
  }
});
test("Gemini adapter handles missing key without exposing secrets or calling provider", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      () => new GeminiInvoiceReader().read(pdf, "application/pdf"),
      { kind: "not_configured" },
    );
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
  }
});

test("Gemini adapter sends document bytes, requests structured data and masks provider failures", async () => {
  const previous = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  try {
    globalThis.fetch = async (url, init) => {
      assert.ok(
        String(url).startsWith(
          "https://generativelanguage.googleapis.com/v1beta/models/",
        ),
      );
      assert.ok(!String(url).includes("test-key"));
      const body = JSON.parse(String(init?.body));
      assert.equal(
        body.contents[0].parts[0].inlineData.data,
        pdf.toString("base64"),
      );
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(extraction) }] },
          },
        ],
      });
    };
    assert.deepEqual(
      await new GeminiInvoiceReader().read(pdf, "application/pdf"),
      extraction,
    );
    globalThis.fetch = async () =>
      Response.json({ error: "private provider diagnostic" }, { status: 429 });
    await assert.rejects(
      () => new GeminiInvoiceReader().read(pdf, "application/pdf"),
      (error) =>
        error instanceof OcrFailure &&
        error.httpStatus === 429 &&
        !error.message.includes("private"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});
