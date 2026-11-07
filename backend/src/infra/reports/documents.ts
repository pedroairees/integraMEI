import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { AppError } from "../../core/errors.ts";
import { reportLabels } from "../../core/reports/service.ts";
import type {
  Report,
  ReportFile,
  ReportRepository,
} from "../../core/reports/types.ts";
const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n,
  );
const date = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const scope = (s: string) =>
  s === "professional"
    ? "Profissional"
    : s === "personal"
      ? "Pessoal"
      : "Não classificado";
const methodology =
  "Somente lançamentos financeiros. Data de emissão das notas e data das vendas. Lucro = faturamento - custos profissionais. Retiradas pessoais e não classificados ficam separados. Esta exportação não fecha o mês.";
function generatedTime(r: Report) {
  const zone = r.company.timeZone || "America/Sao_Paulo";
  return `${new Date(r.generatedAt).toLocaleString("pt-BR", { timeZone: zone })} (${zone})`;
}
export function metrics(r: Report): [string, number, string][] {
  return [
    ...(r.input.type !== "cost"
      ? [
          ["Faturamento", r.totals.revenue, "revenue"] as [
            string,
            number,
            string,
          ],
        ]
      : []),
    ...(r.input.type !== "revenue"
      ? [
          ["Custos profissionais", r.totals.cost, "professional"] as [
            string,
            number,
            string,
          ],
        ]
      : []),
    ...(["profit", "full"].includes(r.input.type)
      ? [
          ["Lucro operacional", r.totals.profit, "profit"] as [
            string,
            number,
            string,
          ],
        ]
      : []),
    ...(r.input.scope === "all" && ["cost", "full"].includes(r.input.type)
      ? ([
          ["Retiradas pessoais", r.totals.personal, "personal"],
          ["Custos não classificados", r.totals.unclassified, "unclassified"],
        ] as [string, number, string][])
      : []),
  ];
}
// Built-in PDF fonts cover Portuguese. Unsupported glyphs are made explicit, not allowed to break export.
function pdfText(text: string, font: PDFFont) {
  return Array.from(
    String(text)
      .normalize("NFC")
      .replace(/[\r\n\t]/g, " "),
  )
    .map((c) => {
      try {
        font.encodeText(c);
        return c;
      } catch {
        return "?";
      }
    })
    .join("");
}
export async function reportPdf(r: Report): Promise<Buffer> {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0.12, 0.24, 0.45);
  let page = doc.addPage([595.28, 841.89]),
    y = 790;
  const wrap = (value: string, width: number, size = 9) => {
    const lines: string[] = [];
    let line = "";
    for (const word of pdfText(value, font).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      // Long identifiers can exceed a whole line even without spaces.
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  const text = (
    value: string,
    x: number,
    at: number,
    size = 10,
    strong = false,
  ) =>
    page.drawText(pdfText(value, strong ? bold : font), {
      x,
      y: at,
      size,
      font: strong ? bold : font,
      color: blue,
    });
  const paragraph = (value: string, size = 10) => {
    for (const line of wrap(value, 505, size)) {
      if (y < 65) {
        page = doc.addPage([595.28, 841.89]);
        y = 790;
      }
      text(line, 45, y, size);
      y -= size + 5;
    }
    y -= 6;
  };
  text("IntegraMEI", 45, y, 22, true);
  y -= 32;
  paragraph(reportLabels[r.input.type], 17);
  paragraph(`${r.company.name} | CNPJ ${r.company.cnpj}`);
  paragraph(
    `Período: ${date(r.input.start)} a ${date(r.input.end)} | ${r.input.scope === "all" ? "Todos os lançamentos" : "Somente profissional"}`,
  );
  paragraph(
    `Gerado em ${generatedTime(r)}`,
  );
  for (const [label, value] of metrics(r)) {
    text(label, 45, y, 11, true);
    const v = money(value);
    text(v, 550 - bold.widthOfTextAtSize(v, 11), y, 11, true);
    y -= 24;
  }
  y -= 8;
  paragraph(methodology, 9);
  const originalTexts = [
    r.company.name,
    ...r.rows.flatMap((row) => [row.label, row.category]),
  ];
  if (
    originalTexts.some(
      (value) =>
        pdfText(value, font) !==
        value.normalize("NFC").replace(/[\r\n\t]/g, " "),
    )
  )
    paragraph(
      "Caracteres não suportados pela fonte PDF aparecem como ?. O Excel preserva o texto original.",
      8,
    );
  const header = () => {
    page.drawRectangle({
      x: 45,
      y: y - 8,
      width: 505,
      height: 23,
      color: blue,
    });
    for (const [s, x] of [
      ["Data", 50],
      ["Lançamento / referência", 115],
      ["Classificação", 325],
      ["Valor (R$)", 477],
    ] as const)
      page.drawText(s, { x, y, size: 9, font: bold, color: rgb(1, 1, 1) });
    y -= 28;
  };
  header();
  for (const row of r.rows) {
    const details = wrap(
      `${row.kind === "revenue" ? "Faturamento" : "Custo"} - ${row.label}`,
      200,
    );
    const classification = wrap(`${scope(row.scope)} / ${row.category}`, 95);
    const lines = Math.max(details.length, classification.length);
    const height = lines * 12 + 34;
    if (y - height < 60) {
      page = doc.addPage([595.28, 841.89]);
      y = 790;
      text("IntegraMEI - continuação", 45, y, 12, true);
      y -= 25;
      header();
    }
    text(date(row.date), 50, y, 9);
    const value = money(Number(row.amount));
    text(value, 548 - font.widthOfTextAtSize(value, 9), y, 9);
    for (let i = 0; i < lines; i++) {
      if (y < 80) {
        page = doc.addPage([595.28, 841.89]);
        y = 790;
        header();
      }
      if (details[i]) text(details[i]!, 115, y, 9);
      if (classification[i]) text(classification[i]!, 325, y, 9);
      y -= 12;
    }
    text(row.id, 115, y, 7);
    y -= 34;
    page.drawLine({
      start: { x: 45, y: y + 15 },
      end: { x: 550, y: y + 15 },
      thickness: 0.4,
      color: rgb(0.8, 0.85, 0.9),
    });
  }
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`IntegraMEI | ${i + 1} / ${pages.length}`, {
      x: 45,
      y: 30,
      size: 8,
      font,
      color: blue,
    }),
  );
  return Buffer.from(await doc.save());
}
export async function reportXlsx(r: Report): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IntegraMEI";
  workbook.created = new Date(r.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const summary = workbook.addWorksheet("Resumo");
  const details = workbook.addWorksheet("Lançamentos", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
    },
  });
  details.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Natureza", key: "kind", width: 18 },
    { header: "Finalidade", key: "scope", width: 22 },
    { header: "Descrição", key: "label", width: 48 },
    { header: "Categoria", key: "category", width: 28 },
    { header: "Valor (R$)", key: "amount", width: 20 },
    { header: "Referência", key: "id", width: 45 },
  ];
  for (const row of r.rows) {
    const record = details.addRow({
      date: new Date(`${row.date}T12:00:00Z`),
      kind: row.kind === "revenue" ? "Faturamento" : "Custo",
      scope: scope(row.scope),
      label: row.label,
      category: row.category,
      amount: Number(row.amount),
      id: row.id,
    });
    record.alignment = { vertical: "top", wrapText: true };
    record.height = Math.max(
      30,
      Math.ceil(row.label.length / 45) * 15,
      Math.ceil(row.category.length / 26) * 15,
    );
  }
  details.getColumn("date").numFmt = "dd/mm/yyyy";
  details.getColumn("amount").numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  details.autoFilter = { from: "A1", to: `G${details.rowCount}` };
  details.getRow(1).height = 30;
  details.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  details.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3C73" },
  };
  summary.columns = [{ width: 35 }, { width: 36 }, { width: 24 }];
  summary.mergeCells("A1:C1");
  summary.getCell("A1").value = "IntegraMEI - " + reportLabels[r.input.type];
  summary.getCell("A1").font = {
    size: 18,
    bold: true,
    color: { argb: "FF1E3C73" },
  };
  summary.getRow(1).height = 32;
  const context = [
    r.company.name,
    `CNPJ ${r.company.cnpj}`,
    `Período: ${date(r.input.start)} a ${date(r.input.end)}`,
    `Visão: ${r.input.scope === "all" ? "Todos os lançamentos" : "Somente profissional"}`,
    `Gerado em ${generatedTime(r)}`,
  ];
  context.forEach((value, i) => {
    summary.mergeCells(i + 2, 1, i + 2, 3);
    summary.getCell(i + 2, 1).value = value;
    summary.getCell(i + 2, 1).alignment = { wrapText: true };
    summary.getRow(i + 2).height = Math.max(
      24,
      Math.ceil(value.length / 90) * 15,
    );
  });
  const last = details.rowCount,
    range = (col: string) => `'Lançamentos'!$${col}$2:$${col}$${last}`;
  const revenue = `SUMIFS(${range("F")},${range("B")},"Faturamento")`,
    cost = `SUMIFS(${range("F")},${range("B")},"Custo",${range("C")},"Profissional")`;
  metrics(r).forEach(([label, value, key], i) => {
    const n = i + 9;
    summary.getCell(n, 1).value = label;
    const formula =
      key === "revenue"
        ? revenue
        : key === "professional"
          ? cost
          : key === "profit"
            ? `${revenue}-${cost}`
            : `SUMIFS(${range("F")},${range("B")},"Custo",${range("C")},"${key === "personal" ? "Pessoal" : "Não classificado"}")`;
    summary.getCell(n, 2).value = {
      formula: `ROUND(${formula},2)`,
      result: value,
    };
    summary.getCell(n, 2).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
    summary.getRow(n).height = 28;
    summary.getRow(n).font = { bold: true };
  });
  const note = metrics(r).length + 11;
  summary.mergeCells(note, 1, note + 2, 3);
  summary.getCell(note, 1).value = methodology;
  summary.getCell(note, 1).alignment = { wrapText: true, vertical: "top" };
  summary.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
  };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function reportFiles(
  r: Report,
  repo: ReportRepository,
): Promise<ReportFile[]> {
  const stem = `integramei-${r.input.type}-${r.input.start}-${r.input.end}`;
  const files: ReportFile[] = [];
  if (r.input.format !== "xlsx")
    files.push({
      name: `${stem}.pdf`,
      mime: "application/pdf",
      content: await reportPdf(r),
    });
  if (r.input.format !== "pdf")
    files.push({
      name: `${stem}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: await reportXlsx(r),
    });
  if (r.input.originals) {
    const notes = r.rows.filter((row) => row.invoice);
    if (notes.some((row) => !row.file))
      throw new AppError(
        422,
        "Há notas sem arquivo original disponível. Gere sem originais ou revise as notas.",
      );
    if (notes.length > 30)
      throw new AppError(
        422,
        "Inclua no máximo 30 notas originais. Reduza o período ou gere sem originais.",
      );
    if (
      notes.reduce((sum, row) => sum + Number(row.file!.size), 0) >
      10 * 1024 * 1024
    )
      throw new AppError(
        422,
        "Os originais ultrapassam 10 MB. Reduza o período ou gere sem originais.",
      );
    for (const row of notes) {
      const f = row.file!;
      const ext = (
        {
          "application/pdf": "pdf",
          "image/png": "png",
          "image/jpeg": "jpg",
        } as Record<string, string>
      )[f.mime];
      if (!ext)
        throw new AppError(422, "Formato de nota original não suportado.");
      files.push({
        name: `nota-${f.id}.${ext}`,
        mime: f.mime,
        content: await repo.original(f),
      });
      if (files.reduce((s, f) => s + f.content.length, 0) > 10 * 1024 * 1024)
        throw new AppError(
          422,
          "Anexos ultrapassam 10 MB. Reduza o período ou gere sem originais.",
        );
    }
  }
  if (files.reduce((s, f) => s + f.content.length, 0) > 10 * 1024 * 1024)
    throw new AppError(422, "Relatório ultrapassa 10 MB. Reduza o período.");
  return files;
}
export async function downloadable(files: ReportFile[]): Promise<ReportFile> {
  if (files.length === 1) return files[0]!;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.content);
  return {
    name: "integramei-relatorio-e-anexos.zip",
    mime: "application/zip",
    content: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
  };
}
