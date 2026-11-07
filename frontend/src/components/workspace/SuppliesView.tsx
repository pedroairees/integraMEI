"use client";
import { useEffect, useState } from "react";
import { financialUpdateEvent } from "@/src/lib/financial-updates";
import { SupplyForm, SupplyPriceForm } from "./SupplyForms";
import { SupplyHistory } from "./SupplyHistory";
import {
  useSuppliesResource,
  today,
  type Supply,
  type History,
} from "./supplies-api";
import css from "./Supplies.module.css";

function range(period: string) {
  const end = today();
  const date = new Date(`${end}T12:00:00Z`);
  if (period === "30") date.setUTCDate(date.getUTCDate() - 29);
  else {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1 - Number(period));
  }
  return { start: date.toISOString().slice(0, 10), end };
}
export function SuppliesView() {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Supply | null>(null),
    [editor, setEditor] = useState<"new" | "edit" | "price" | null>(null);
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  const [period, setPeriod] = useState("6"),
    [dates, setDates] = useState(() => range("6")),
    [unit, setUnit] = useState("");
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(financialUpdateEvent, refresh);
    window.addEventListener("focus", refresh);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(financialUpdateEvent);
      channel.onmessage = refresh;
    } catch {
      /* Focus/manual refresh also work without BroadcastChannel. */
    }
    return () => {
      window.removeEventListener(financialUpdateEvent, refresh);
      window.removeEventListener("focus", refresh);
      channel?.close();
    };
  }, []);
  const list = useSuppliesResource<{ supplies: Supply[] }>(
    `?q=${encodeURIComponent(search)}&offset=${offset}`,
    revision,
  );
  const history = useSuppliesResource<History>(
    selected
      ? `/${selected.id}/prices?${new URLSearchParams({ ...dates, ...(unit ? { unit } : {}) })}`
      : null,
    revision,
  );
  function select(s: Supply) {
    setSelected(s);
    setUnit("");
    setEditor(null);
    setMessage("");
  }
  function saved(s: Supply) {
    setSelected(s);
    setUnit("");
    setEditor(null);
    setRevision((v) => v + 1);
    setMessage("Insumo salvo na sua empresa.");
  }
  return (
    <section className={css.root} aria-label="Insumos da empresa">
      <div className={css.toolbar}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query);
            setOffset(0);
          }}
          className={css.search}
        >
          <label>
            Pesquisar insumos
            <input
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome do insumo"
            />
          </label>
          <button type="submit">Pesquisar</button>
        </form>
        <button
          type="button"
          onClick={() => {
            setEditor("new");
            setMessage("");
          }}
        >
          Novo insumo
        </button>
        <button type="button" onClick={() => setRevision((v) => v + 1)}>
          Atualizar dados
        </button>
      </div>
      {list.loading && <p role="status">Carregando insumos…</p>}
      {list.error && (
        <p role="alert" className={css.error}>
          {list.error}
        </p>
      )}
      {list.data && (
        <>
          {list.data.supplies.length ? (
            <div className={css.catalog} aria-label="Catálogo de insumos">
              {list.data.supplies.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={selected?.id === s.id}
                  onClick={() => select(s)}
                >
                  {s.nome}{" "}
                  <small>
                    ({s.unidade_medida}){!s.ativo ? " • Inativo" : ""}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <p className={css.notice}>
              {search
                ? "Nenhum insumo encontrado para essa busca."
                : "Nenhum insumo cadastrado. Comece em Novo insumo."}
            </p>
          )}
          {(offset > 0 || list.data.supplies.length === 50) && (
            <div className={css.actions}>
              <button
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - 50))}
              >
                Anteriores
              </button>
              <button
                disabled={list.data.supplies.length < 50}
                onClick={() => setOffset((v) => v + 50)}
              >
                Próximos
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className={css.notice}>
          {message}
        </p>
      )}
      {editor === "new" && (
        <SupplyForm
          key="new"
          supply={null}
          onSaved={saved}
          onCancel={() => setEditor(null)}
        />
      )}
      {selected && (
        <>
          <div className={css.toolbar}>
            <h2>
              {selected.nome} {!selected.ativo && "(inativo)"}
            </h2>
            <button onClick={() => setEditor("edit")}>Editar insumo</button>
            <button
              disabled={!selected.ativo}
              onClick={() => setEditor("price")}
            >
              Registrar preço
            </button>
          </div>
          {editor === "edit" && (
            <SupplyForm
              key={selected.id}
              supply={selected}
              onSaved={saved}
              onCancel={() => setEditor(null)}
            />
          )}
          {editor === "price" && (
            <SupplyPriceForm
              key={selected.id}
              supply={selected}
              onCancel={() => setEditor(null)}
              onSaved={() => {
                setEditor(null);
                setRevision((v) => v + 1);
                setMessage(
                  "Preço salvo. O histórico usa a data da compra; confira o período selecionado.",
                );
              }}
            />
          )}
          <div className={css.filters}>
            <label>
              Período do histórico
              <select
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setUnit("");
                  if (e.target.value !== "custom")
                    setDates(range(e.target.value));
                }}
              >
                <option value="30">Últimos 30 dias</option>
                <option value="3">Últimos 3 meses</option>
                <option value="6">Últimos 6 meses</option>
                <option value="12">Últimos 12 meses</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
            {period === "custom" && (
              <>
                <label>
                  Data inicial
                  <input
                    type="date"
                    value={dates.start}
                    max={dates.end}
                    onChange={(e) => {
                      setUnit("");
                      setDates({ ...dates, start: e.target.value });
                    }}
                  />
                </label>
                <label>
                  Data final
                  <input
                    type="date"
                    value={dates.end}
                    min={dates.start}
                    max={today()}
                    onChange={(e) => {
                      setUnit("");
                      setDates({ ...dates, end: e.target.value });
                    }}
                  />
                </label>
              </>
            )}
            {history.data && (
              <label>
                Unidade do histórico
                <select
                  value={history.data.unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  {history.data.units.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {history.loading && <p role="status">Carregando histórico…</p>}
          {history.error && (
            <p role="alert" className={css.error}>
              {history.error}
            </p>
          )}
          {history.data && (
            <SupplyHistory
              key={`${selected.id}-${history.data.unit}`}
              history={history.data}
            />
          )}
        </>
      )}
      {!selected && !editor && !!list.data?.supplies.length && (
        <p className={css.notice}>
          Selecione um insumo para consultar seu histórico ou registrar uma
          compra.
        </p>
      )}
    </section>
  );
}
