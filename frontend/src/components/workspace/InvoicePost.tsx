"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoiceRequest, type SavedInvoice } from "./invoice-api";
import { notifyFinancialUpdate } from "@/src/lib/financial-updates";
import styles from "./Invoices.module.css";

export function InvoicePost({ invoice, onClose, onPosted }: {
  invoice: SavedInvoice; onClose: () => void; onPosted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState("professional");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await invoiceRequest(`/${invoice.id}/post`, { method: "POST", body: JSON.stringify({ version: invoice.versao_arquivo, scope }) });
      notifyFinancialUpdate(); onPosted();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível lançar a nota."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="post-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="post-title">Lançar no financeiro</h2>
      <p className={styles.filename}>{invoice.nome_arquivo}</p>
      <p>{invoice.natureza === "revenue" ? "Faturamento" : "Despesa"}: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(invoice.dados_extracao.total ?? 0)} — emissão em {invoice.dados_extracao.date?.split("-").reverse().join("/")}.</p>
      {invoice.natureza === "cost" && <label>Finalidade da despesa
        <select value={scope} disabled={busy} onChange={e => setScope(e.target.value)}>
          <option value="professional">Profissional — compõe os custos</option>
          <option value="personal">Pessoal / retirada — não reduz o lucro operacional</option>
        </select>
      </label>}
      <p>O valor entrará no dashboard no mês da emissão. Após confirmar, a nota não poderá ser editada ou excluída por esta tela. Este lançamento não movimenta estoque.</p>
      <label><input type="checkbox" required disabled={busy} /> Conferi os dados e confirmo este lançamento.</label>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" disabled={busy}>{busy ? "Lançando…" : "Confirmar lançamento"}</button>
      </div>
    </form>
  </dialog>;
}
