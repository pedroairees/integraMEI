"use client";

import Image from "next/image";
import { Upload } from "lucide-react";
import { useState } from "react";
import styles from "./Screens.module.css";

// Reference data from frames 2188:77 / 2212:1220, never business records.
const exampleInvoices = [
  { supplier: "ZK Embalagens", date: "15/04/2026", value: "R$ 859,55" },
  { supplier: "Mercado XT LTDA", date: "13/04/2026", value: "R$ 359,28" },
  {
    supplier: "Mercado Bom Preço LTDA",
    date: "15/04/2026",
    value: "R$ 248,50",
  },
  { supplier: "JIF", date: "15/04/2026", value: "R$ 1.582,00" },
];

export function InvoicesView() {
  const [kind, setKind] = useState<"revenue" | "cost">("revenue");
  const [period, setPeriod] = useState("current");
  const [files, setFiles] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  return (
    <section className={styles.notes} aria-label="Anexo e consulta de notas">
      <div
        className={styles.noteTabs}
        role="group"
        aria-label="Tipo de nota fiscal"
      >
        <button
          type="button"
          aria-pressed={kind === "revenue"}
          className={`${styles.noteTab} ${styles.revenueTab}`}
          onClick={() => setKind("revenue")}
        >
          Faturamento
        </button>
        <button
          type="button"
          aria-pressed={kind === "cost"}
          className={`${styles.noteTab} ${styles.costTab}`}
          onClick={() => setKind("cost")}
        >
          Custos
        </button>
      </div>
      <ol className={styles.steps} aria-label="Etapas do envio">
        {["Capturar", "Registrar", "Confirmar"].map((step, index) => (
          <li key={step} aria-current={index === 0 ? "step" : undefined}>
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <p className={styles.uploadIntro}>
        Anexe a Nota Fiscal no espaço abaixo. Formatos aceitos: JPG, PNG e PDF.
      </p>
      <div className={styles.uploadLabel}>Envio de arquivos</div>
      <label className={styles.upload}>
        <Upload size={20} aria-hidden="true" />
        <span>Selecione o(s) arquivo(s)</span>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,application/pdf"
          aria-label="Selecionar notas fiscais"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            const valid = selected.every((file) =>
              ["image/jpeg", "image/png", "application/pdf"].includes(
                file.type,
              ),
            );
            setFiles(valid ? selected.map((file) => file.name) : []);
            setMessage(
              valid && selected.length
                ? "Arquivos selecionados apenas para prévia. O registro e a confirmação serão implementados na etapa de lógica; nada foi enviado."
                : valid
                  ? ""
                  : "Selecione somente arquivos JPG, PNG ou PDF.",
            );
            event.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((name, index) => (
            <li key={`${name}-${index}`}>{name}</li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      <div className={styles.notesHeading}>
        <h2>
          Últimas notas enviadas ({" "}
          <span className={kind === "revenue" ? styles.income : styles.expense}>
            {kind === "revenue" ? "ENTRADAS" : "SAÍDAS"}
          </span>{" "}
          )
        </h2>
        <select
          aria-label="Período das notas"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        >
          <option value="current">Mês Atual</option>
          <option value="previous">Mês Anterior</option>
          <option value="all">Todos os meses</option>
        </select>
      </div>
      {period === "previous" ? (
        <p role="status" className={styles.message}>
          Não há notas de exemplo para este período.
        </p>
      ) : (
        <div
          className={styles.invoiceGrid}
          aria-label="Notas demonstrativas do Figma"
          tabIndex={0}
        >
          {exampleInvoices.map((invoice) => (
            <article
              key={invoice.supplier}
              className={`${styles.card} ${styles.invoice}`}
            >
              <Image
                src="/assets/screens/invoice.png"
                alt="Miniatura ilustrativa de nota fiscal do Figma"
                width={96}
                height={153}
              />
              <dl>
                <dt>Fornecedor</dt>
                <dd>{invoice.supplier}</dd>
                <dt>Data</dt>
                <dd>{invoice.date}</dd>
                <dt>Valor</dt>
                <dd>{invoice.value}</dd>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
