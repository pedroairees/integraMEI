"use client";
import { useRef, useState, type FormEvent } from "react";
import {
  suppliesRequest,
  useSuppliesResource,
  today,
  dateLabel,
  priceLabel,
  type Supply,
  type CostInvoice,
} from "./supplies-api";
import css from "./Supplies.module.css";

export function SupplyForm({
  supply,
  onSaved,
  onCancel,
}: {
  supply: Supply | null;
  onSaved: (s: Supply) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { supply: saved } = await suppliesRequest<{ supply: Supply }>(
        supply ? `/${supply.id}` : "",
        {
          method: supply ? "PATCH" : "POST",
          body: JSON.stringify({
            name: String(form.get("name")).trim(),
            unit:
              supply?.unidade_medida ??
              String(form.get("unit")).trim().toLowerCase(),
            minimum: Number(form.get("minimum")),
            active: form.get("active") === "on",
            ...(supply ? { version: supply.versao_cadastro } : {}),
          }),
        },
      );
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={css.editor}
      onSubmit={save}
      aria-label={supply ? "Editar insumo" : "Cadastrar insumo"}
    >
      <h2>{supply ? "Editar insumo" : "Novo insumo"}</h2>
      <fieldset disabled={busy}>
        <div className={css.fields}>
          <label>
            Nome do insumo
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={supply?.nome}
            />
          </label>
          <label>
            Unidade de medida
            <input
              name="unit"
              required
              maxLength={12}
              pattern="[a-z0-9²³]+"
              placeholder="kg, un, l…"
              defaultValue={supply?.unidade_medida}
              disabled={!!supply}
            />
          </label>
          <label>
            Estoque mínimo
            <input
              name="minimum"
              type="number"
              min="0"
              max="999999999"
              step="0.001"
              required
              defaultValue={supply?.estoque_minimo ?? 0}
            />
          </label>
        </div>
        <label className={css.check}>
          <input
            name="active"
            type="checkbox"
            defaultChecked={supply?.ativo ?? true}
          />{" "}
          Insumo ativo
        </label>
        <p>
          Use sempre a mesma unidade. Desativar preserva o histórico. O estoque
          mínimo é apenas uma configuração; este cadastro não movimenta estoque.
        </p>
        {error && (
          <p role="alert" className={css.error}>
            {error}
          </p>
        )}
        <div className={css.actions}>
          <button type="submit">{busy ? "Salvando…" : "Salvar insumo"}</button>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function SupplyPriceForm({
  supply,
  onSaved,
  onCancel,
}: {
  supply: Supply;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState("invoice"),
    [invoiceId, setInvoiceId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ body: string; id: string } | null>(null);
  const notes = useSuppliesResource<{ invoices: CostInvoice[] }>(
    source === "invoice" ? "/invoices" : null,
  );
  const invoice = notes.data?.invoices.find((n) => n.id === invoiceId);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const payload = {
      source,
      quantity: Number(form.get("quantity")),
      price: Number(form.get("price")),
      ...(source === "invoice"
        ? { invoiceId, itemIndex: Number(form.get("item")) }
        : {
            date: String(form.get("date")),
            supplier: String(form.get("supplier")).trim(),
          }),
    };
    const body = JSON.stringify(payload);
    if (request.current?.body !== body)
      request.current = { body, id: crypto.randomUUID() };
    try {
      await suppliesRequest(`/${supply.id}/prices`, {
        method: "POST",
        body: JSON.stringify({ ...payload, requestId: request.current.id }),
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao registrar preço.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={css.editor} onSubmit={save} aria-label="Registrar preço">
      <h2>Registrar preço — {supply.nome}</h2>
      <fieldset disabled={busy}>
        <label>
          Origem do preço
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setError("");
            }}
          >
            <option value="invoice">Nota de custo</option>
            <option value="manual">Registro manual</option>
          </select>
        </label>
        {source === "invoice" ? (
          <>
            <p>
              Selecione uma das 100 notas profissionais mais recentes, já
              revisadas e lançadas. Confira quantidade e preço no arquivo
              original. O item só pode ser vinculado uma vez.
            </p>
            {notes.loading && <p role="status">Carregando notas…</p>}
            {notes.error && (
              <p role="alert" className={css.error}>
                {notes.error}
              </p>
            )}
            {notes.data?.invoices.length === 0 && (
              <p>
                Nenhuma nota elegível. Revise e lance uma nota de custo
                profissional em Notas Fiscais, ou use o registro manual.
              </p>
            )}
            <label>
              Nota de custo
              <select
                required
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                <option value="">Selecione uma nota</option>
                {notes.data?.invoices.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome_arquivo} — {dateLabel(n.data_emissao)}
                  </option>
                ))}
              </select>
            </label>
            {invoice && (
              <>
                <p>
                  Fornecedor: {invoice.dados_extracao.supplier} • Total:{" "}
                  {priceLabel(invoice.valor_total)} • Data:{" "}
                  {dateLabel(invoice.data_emissao)}
                </p>
                <a href={`/api/backend/invoices/${invoice.id}/file`}>
                  Baixar nota para conferir os valores
                </a>
                <label>
                  Item da nota
                  <select name="item" key={invoice.id} required defaultValue="">
                    <option value="">
                      Selecione o item correspondente ao insumo
                    </option>
                    {invoice.dados_extracao.items.map((item, i) => (
                      <option value={i} key={i}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </>
        ) : (
          <div className={css.fields}>
            <label>
              Data da compra
              <input
                name="date"
                type="date"
                required
                min="2000-01-01"
                max={today()}
                defaultValue={today()}
              />
            </label>
            <label>
              Fornecedor
              <input name="supplier" required maxLength={200} />
            </label>
          </div>
        )}
        <div className={css.fields}>
          <label>
            Quantidade ({supply.unidade_medida})
            <input
              name="quantity"
              type="number"
              min="0.001"
              max="999999999"
              step="0.001"
              required
            />
          </label>
          <label>
            Preço unitário (R$/{supply.unidade_medida})
            <input
              name="price"
              type="number"
              min="0"
              max="999999999"
              step="0.0001"
              required
            />
          </label>
        </div>
        <label className={css.check}>
          <input type="checkbox" required /> Conferi a unidade e os valores que
          serão adicionados ao histórico.
        </label>
        <p>
          Registra somente o histórico de preços. Não altera a nota, o estoque
          nem lança outra despesa no dashboard. Notas de custo confirmadas no
          novo fluxo já registram seus itens automaticamente; o vínculo manual
          fica disponível para notas antigas ainda não importadas.
        </p>
        {error && (
          <p role="alert" className={css.error}>
            {error}
          </p>
        )}
        <div className={css.actions}>
          <button disabled={source === "invoice" && !invoice} type="submit">
            {busy ? "Registrando…" : "Salvar preço"}
          </button>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}
