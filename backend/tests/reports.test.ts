import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { buildApp } from "../src/web/app.ts";
import { prepareReport, validateReport } from "../src/core/reports/service.ts";
import {
  reportPdf,
  reportXlsx,
  reportFiles,
  downloadable,
} from "../src/infra/reports/documents.ts";
import { smtpMailer } from "../src/infra/reports/mail.ts";
import type { DashboardRepository } from "../src/core/dashboard/types.ts";
import type {
  ReportInput,
  ReportRepository,
  ReportSource,
  ReportFile,
} from "../src/core/reports/types.ts";
const input: ReportInput = {
  start: "2026-10-01",
  end: "2026-10-31",
  type: "full",
  scope: "all",
  format: "pdf",
  originals: false,
};
const source: ReportSource = {
  company: {
    name: "Empresa de Teste - Açúcar & Café",
    cnpj: "12.123.123/0001-12",
  },
  rows: [
    {
      id: "sale-1",
      date: "2026-10-01",
      kind: "revenue",
      scope: "professional",
      amount: 1000.1,
      label: "Venda balcão",
      category: "Vendas",
      file: null,
      invoice: false,
    },
    {
      id: "cost-1",
      date: "2026-10-31",
      kind: "cost",
      scope: "professional",
      amount: 200.2,
      label: "Compra de matéria-prima e embalagens",
      category: "Produção",
      file: null,
      invoice: true,
    },
    {
      id: "personal-1",
      date: "2026-10-14",
      kind: "cost",
      scope: "personal",
      amount: 100,
      label: "Retirada pessoal",
      category: "Pessoal",
      file: null,
      invoice: true,
    },
    {
      id: "unknown-1",
      date: "2026-10-14",
      kind: "cost",
      scope: "unclassified",
      amount: 20,
      label: "A revisar",
      category: "Sem categoria",
      file: null,
      invoice: true,
    },
  ],
};
test("reports date validation, selected types and personal segregation use cents without fake empty results", () => {
  for (const range of [
    { start: "2026-02-30" },
    { end: "2025-01-01" },
    { start: "2020-01-01" },
  ])
    assert.throws(() => validateReport({ ...input, ...range }));
  const report = prepareReport(source, input);
  assert.deepEqual(report.totals, {
    revenue: 1000.1,
    cost: 200.2,
    personal: 100,
    unclassified: 20,
    profit: 799.9,
  });
  assert.equal(
    prepareReport(source, { ...input, type: "profit" }).rows.length,
    2,
  );
  assert.equal(
    prepareReport(source, { ...input, type: "cost", scope: "professional" })
      .rows.length,
    1,
  );
  assert.equal(
    prepareReport(source, { ...input, type: "revenue" }).rows.length,
    1,
  );
  assert.throws(
    () => prepareReport({ ...source, rows: [] }, input),
    /Nada para exportar/,
  );
});
test("PDF and XLSX exports preserve typed data, formulas, strings and valid ZIP attachments", async () => {
  const report = prepareReport(source, input);
  const pdf = await reportPdf(report);
  assert.equal((await PDFDocument.load(pdf)).getPages().length, 1);
  const xlsx = await reportXlsx(report),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(xlsx as never);
  assert.equal(book.worksheets.length, 2);
  assert.ok(
    book.getWorksheet("Lançamentos")!.getCell("A2").value instanceof Date,
  );
  assert.equal(book.getWorksheet("Resumo")!.getCell("B11").result, 799.9);
  assert.match(book.getWorksheet("Resumo")!.getCell("B11").formula, /SUMIFS/);
  const regional = await reportXlsx({
    ...report, generatedAt: "2026-11-04T16:00:00.000Z",
    company: { ...report.company, timeZone: "America/Manaus" },
  });
  await book.xlsx.load(regional as never);
  assert.match(String(book.getWorksheet("Resumo")!.getCell("A6").value), /12:00:00.*America\/Manaus/);
  const special = await reportXlsx(
    prepareReport(
      {
        ...source,
        rows: [
          { ...source.rows[0]!, label: '=HYPERLINK("https://invalid.test")' },
        ],
      },
      input,
    ),
  );
  await book.xlsx.load(special as never);
  assert.equal(
    book.getWorksheet("Lançamentos")!.getCell("D2").type,
    ExcelJS.ValueType.String,
  );
  const zip = await downloadable([
    { name: "a.pdf", mime: "application/pdf", content: pdf },
    { name: "b.xlsx", mime: "xlsx", content: xlsx },
  ]);
  assert.equal(
    Object.keys((await JSZip.loadAsync(zip.content)).files).length,
    2,
  );
  const originalId = randomUUID();
  const withOriginal = prepareReport(
    {
      ...source,
      rows: [
        {
          ...source.rows[1]!,
          file: {
            id: originalId,
            name: "untrusted-name.pdf",
            path: `user/company/${originalId}.pdf`,
            mime: "application/pdf",
            size: pdf.length,
          },
        },
      ],
    },
    { ...input, originals: true },
  );
  const files = await reportFiles(withOriginal, {
    original: async () => pdf,
  } as unknown as ReportRepository);
  assert.deepEqual(
    files.map((file) => file.name),
    ["integramei-full-2026-10-01-2026-10-31.pdf", `nota-${originalId}.pdf`],
  );
  const originalsZip = await JSZip.loadAsync(
    (await downloadable(files)).content,
  );
  assert.deepEqual(
    await originalsZip.file(`nota-${originalId}.pdf`)!.async("nodebuffer"),
    pdf,
  );
  await mkdir("../tmp/reports-check", { recursive: true });
  await writeFile("../tmp/reports-check/relatorio.pdf", pdf);
  await writeFile("../tmp/reports-check/relatorio.xlsx", xlsx);
  const long = prepareReport(
    {
      ...source,
      rows: Array.from({ length: 100 }, (_, i) => ({
        ...source.rows[i % 4]!,
        id: `note-${i}`,
        label: "Compra de produção ".repeat(10),
      })),
    },
    input,
  );
  const multipage = await reportPdf(long);
  assert.ok((await PDFDocument.load(multipage)).getPages().length > 2);
  await writeFile("../tmp/reports-check/multipage.pdf", multipage);
});
test("HTTP exports require auth; sending attaches actual formats, deduplicates requests and reports uncertainty honestly", async () => {
  const ledger = new Map<string, string>();
  let sends = 0;
  let sent: ReportFile[] = [];
  let fail = false;
  const repository: ReportRepository = {
    source: async () => source,
    original: async () => Buffer.from("file"),
    reserve: async (id) => {
      const v = ledger.get(id);
      if (v) return v;
      ledger.set(id, "processing");
      return "reserved";
    },
    finish: async (id, status) => {
      ledger.set(id, status);
    },
  };
  const app = await buildApp(
    async () => ({
      tenant: {
        companyId: randomUUID(),
        profileId: randomUUID(),
        role: "owner",
      },
      repository: {} as DashboardRepository,
      reports: repository,
    }),
    {
      reportMailer: {
        configured: true,
        send: async (_to, files) => {
          sends++;
          sent = files;
          if (fail) throw Error("SMTP secret internal failure");
        },
      },
    },
  );
  const headers = { authorization: "Bearer local" },
    payload = {
      ...input,
      format: "both",
      recipient: "accountant@example.test",
      requestId: randomUUID(),
    };
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/reports/download",
          payload: input,
        })
      ).statusCode,
      401,
    );
    for (const patch of [
      { companyId: randomUUID() },
      { recipient: "bad\r\nBcc:other@example.test" },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/reports/email",
            headers,
            payload: { ...payload, ...patch },
          })
        ).statusCode,
        400,
      );
    const download = await app.inject({
      method: "POST",
      url: "/v1/reports/download",
      headers,
      payload: input,
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-type"], "application/pdf");
    assert.match(download.rawPayload.toString("ascii", 0, 4), /%PDF/);
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/reports/email",
            headers,
            payload,
          })
        ).statusCode,
        200,
      );
    assert.equal(sends, 1);
    assert.deepEqual(
      sent.map((f) => f.name.split(".").pop()),
      ["pdf", "xlsx"],
    );
    fail = true;
    const bad = { ...payload, requestId: randomUUID() };
    const r = await app.inject({
      method: "POST",
      url: "/v1/reports/email",
      headers,
      payload: bad,
    });
    assert.equal(r.statusCode, 502);
    assert.ok(!r.body.includes("secret"));
    assert.equal(ledger.get(bad.requestId), "uncertain");
    await assert.rejects(
      () =>
        reportFiles(
          prepareReport(source, { ...input, originals: true }),
          repository,
        ),
      /sem arquivo original/,
    );
  } finally {
    await app.close();
  }
  assert.equal(smtpMailer({}).configured, false);
});
