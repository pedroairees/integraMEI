"use client";
import { useEffect, useState } from "react";
import { financialUpdateEvent } from "@/src/lib/financial-updates";
import {
  decimal,
  money,
  pricingRequest,
  type PricingData,
  type PricingInput,
  type Product,
  type Quote,
} from "./pricing-api";
import styles from "./Screens.module.css";
import css from "./Pricing.module.css";
import { PricingComposition } from "./PricingComposition";

export function PricingView() {
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<{
    revision: number;
    data?: PricingData;
    error?: string;
  }>({ revision: -1 });
  const [draft, setDraft] = useState({
    name: "",
    baseCost: "",
    markup: "100",
    currentPrice: "",
    monthlyUnits: "0",
    ingredients: [] as { supplyId: string; quantity: string }[],
  });
  const [product, setProduct] = useState<{
    id: string;
    version: string | null;
    referenceCost: number | null;
  } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    quote?: Quote;
    error?: string;
  }>({ key: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const data = catalog.data;
  const loading = catalog.revision !== revision;
  useEffect(() => {
    const controller = new AbortController();
    pricingRequest<PricingData>("", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setCatalog({ revision, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setCatalog({
            revision,
            error:
              error instanceof Error ? error.message : "Falha na consulta.",
          });
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener(financialUpdateEvent, refresh);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(financialUpdateEvent);
      channel.onmessage = refresh;
    } catch {
      /* Focus refresh remains available. */
    }
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(financialUpdateEvent, refresh);
      channel?.close();
    };
  }, []);
  const baseCost = decimal(draft.baseCost),
    markup = decimal(draft.markup),
    monthlyUnits = decimal(draft.monthlyUnits, 0);
  const currentPrice =
    draft.currentPrice.trim() === "" ? null : decimal(draft.currentPrice);
  const valid =
    draft.name.trim() !== "" &&
    baseCost !== null &&
    markup !== null &&
    monthlyUnits !== null &&
    (draft.currentPrice === "" || currentPrice !== null) &&
    draft.ingredients.every(
      (i) => i.supplyId && decimal(i.quantity, 3) !== null,
    );
  const input: PricingInput | null = valid
    ? {
        name: draft.name.trim(),
        baseCost: baseCost!,
        markup: markup!,
        monthlyUnits: monthlyUnits!,
        currentPrice,
        ingredients: draft.ingredients.map((i) => ({
          supplyId: i.supplyId,
          quantity: decimal(i.quantity, 3)!,
        })),
      }
    : null;
  const payload = input ? JSON.stringify(input) : null;
  const key = `${payload}|${revision}`;
  useEffect(() => {
    if (!enabled || !payload) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      pricingRequest<Quote>("/quote", {
        method: "POST",
        body: payload,
        signal: controller.signal,
      })
        .then((quote) => {
          if (!controller.signal.aborted) setResult({ key, quote });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setResult({
              key,
              error:
                error instanceof Error ? error.message : "Falha no cálculo.",
            });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, payload, key]);
  const quote = enabled && result.key === key ? result.quote : undefined;
  const error = enabled && result.key === key ? result.error : undefined;
  function select(p?: Product) {
    setProduct(
      p
        ? { id: p.id, version: p.version, referenceCost: p.referenceCost }
        : null,
    );
    setDraft(
      p
        ? {
            name: p.name,
            baseCost: String(p.baseCost),
            markup: String(p.markup),
            currentPrice: p.currentPrice === null ? "" : String(p.currentPrice),
            monthlyUnits: String(p.monthlyUnits),
            ingredients: p.ingredients.map((i) => ({
              ...i,
              quantity: String(i.quantity),
            })),
          }
        : {
            name: "",
            baseCost: "",
            markup: "100",
            currentPrice: "",
            monthlyUnits: "0",
            ingredients: [],
          },
    );
    setEnabled(!!p);
    setMessage("");
  }
  async function save() {
    if (!input || !quote || busy) return;
    const target = product ?? {
      id: crypto.randomUUID(),
      version: null,
      referenceCost: null,
    };
    setProduct(target);
    setBusy(true);
    setMessage("");
    try {
      const saved = await pricingRequest<{
        id: string;
        version: string;
        quote: Quote;
      }>("/products", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          id: target.id,
          version: target.version,
        }),
      });
      setProduct({
        id: saved.id,
        version: saved.version,
        referenceCost: saved.quote.cost,
      });
      // Keep the selected option present while the catalog is revalidated.
      setCatalog((previous) =>
        previous.data
          ? {
              ...previous,
              data: {
                ...previous.data,
                products: [
                  ...previous.data.products.filter((p) => p.id !== saved.id),
                  {
                    ...input,
                    id: saved.id,
                    version: saved.version,
                    referenceCost: saved.quote.cost,
                    active:
                      previous.data.products.find((p) => p.id === saved.id)
                        ?.active ?? true,
                  },
                ],
              },
            }
          : previous,
      );
      setMessage(
        "Produto e composição salvos na sua empresa. Nenhuma venda foi lançada.",
      );
      setRevision((n) => n + 1);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  }
  const change = (
    field: "name" | "baseCost" | "markup" | "currentPrice" | "monthlyUnits",
    value: string,
  ) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setMessage("");
  };
  return (
    <div className={styles.pricing}>
      <div className={css.toolbar}>
        <label>
          Produtos salvos
          <select
            className={styles.input}
            value={product?.version ? product.id : ""}
            disabled={busy || loading}
            onChange={(e) =>
              select(data?.products.find((p) => p.id === e.target.value))
            }
          >
            <option value="">Novo produto</option>
            {data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.active ? " (inativo)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          Atualizar dados
        </button>
      </div>
      {loading && <p role="status">Atualizando custos e produtos…</p>}
      {!loading && catalog.error && (
        <p role="alert" className={css.error}>
          {catalog.error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setEnabled(true);
          setRevision((n) => n + 1);
        }}
      >
        <fieldset disabled={busy || !data} className={css.fields}>
          <div className={styles.productRow}>
            <label htmlFor="pricing-product">Produto</label>
            <input
              id="pricing-product"
              className={`${styles.input} ${styles.productInput}`}
              value={draft.name}
              onChange={(e) => change("name", e.target.value)}
              maxLength={160}
              required
              placeholder="Nome do produto"
            />
          </div>
          <div className={styles.priceInputs}>
            <div className={`${styles.card} ${styles.priceInput}`}>
              <label htmlFor="unit-cost">Custo base unitário (R$)</label>
              <div className={styles.priceValue}>
                <span>R$</span>
                <input
                  id="unit-cost"
                  inputMode="decimal"
                  value={draft.baseCost}
                  onChange={(e) => change("baseCost", e.target.value)}
                  pattern="[0-9]+([,.][0-9]{1,2})?"
                  maxLength={12}
                  placeholder="0,00"
                  required
                />
              </div>
            </div>
            <div className={`${styles.card} ${styles.priceInput}`}>
              <label htmlFor="profit-margin">Markup desejado (%)</label>
              <div className={styles.priceValue}>
                <input
                  id="profit-margin"
                  className={styles.marginInput}
                  inputMode="decimal"
                  value={draft.markup}
                  onChange={(e) => change("markup", e.target.value)}
                  pattern="[0-9]+([,.][0-9]{1,2})?"
                  maxLength={7}
                  required
                />
                <span>%</span>
              </div>
            </div>
          </div>
          <p className={css.help}>
            Sem composição, informe o custo total de uma unidade. Com insumos
            vinculados, informe apenas os custos adicionais por unidade, como
            embalagem e rateio de custos fixos, para não contar o mesmo custo
            duas vezes.
          </p>
          <PricingComposition
            items={draft.ingredients}
            supplies={data?.supplies ?? []}
            onChange={(ingredients) => setDraft((d) => ({ ...d, ingredients }))}
          />
          <div className={css.toolbar}>
            <label>
              Preço de venda atual (opcional)
              <input
                className={styles.input}
                inputMode="decimal"
                pattern="[0-9]+([,.][0-9]{1,2})?"
                maxLength={12}
                value={draft.currentPrice}
                onChange={(e) => change("currentPrice", e.target.value)}
              />
            </label>
            <label>
              Unidades previstas por mês
              <input
                className={styles.input}
                inputMode="numeric"
                pattern="[0-9]+"
                maxLength={7}
                required
                value={draft.monthlyUnits}
                onChange={(e) => change("monthlyUnits", e.target.value)}
              />
            </label>
          </div>
          <p className={css.help}>
            Fórmula documentada: custo total × (1 + impostos/100) × (1 +
            markup/100). Impostos configurados na empresa: {data?.tax ?? "—"}%.
            Markup é acréscimo sobre o custo; não é a margem sobre o preço de
            venda.
          </p>
          <button type="submit" className={styles.primary}>
            Sugerir Preço
          </button>
        </fieldset>
      </form>
      {enabled && !valid && (
        <p role="alert" className={css.error}>
          Preencha os campos com números válidos. Use até duas casas decimais
          nos valores e três nas quantidades.
        </p>
      )}
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      <section
        className={`${styles.card} ${styles.suggested}`}
        aria-label="Preço sugerido"
        aria-live="polite"
      >
        <h2>Preço Sugerido</h2>
        <p>{quote ? money(quote.suggestedPrice) : "—"}</p>
        <small>
          {enabled && valid && result.key !== key
            ? "Calculando…"
            : "Simulação: não altera o faturamento nem o estoque."}
        </small>
      </section>
      {quote && (
        <>
          {product?.referenceCost !== null &&
            product?.referenceCost !== undefined &&
            quote.cost !== product.referenceCost && (
              <p role="status" className={css.notice}>
                Seu custo{" "}
                {quote.cost > product.referenceCost ? "subiu" : "caiu"}{" "}
                {money(Math.abs(quote.cost - product.referenceCost))} desde o
                último salvamento. O novo preço sugerido é{" "}
                {money(quote.suggestedPrice)}.
              </p>
            )}
          <section className={`${styles.card} ${styles.market}`}>
            <h2>Análise da precificação</h2>
            <dl>
              <div>
                <dt>Custo total unitário</dt>
                <dd>{money(quote.cost)}</dd>
              </div>
              <div>
                <dt>Insumos na composição</dt>
                <dd>{money(quote.inputCost)}</dd>
              </div>
              <div>
                <dt>Impostos sobre o custo ({quote.tax}%)</dt>
                <dd>{money(quote.taxCost)}</dd>
              </div>
              <div>
                <dt>Lucro unitário estimado</dt>
                <dd>{money(quote.profit)}</dd>
              </div>
              <div>
                <dt>Margem estimada sobre a venda</dt>
                <dd>{quote.margin.toLocaleString("pt-BR")}%</dd>
              </div>
              <div>
                <dt>Receita mensal simulada</dt>
                <dd>{money(quote.monthlyRevenue)}</dd>
              </div>
              {quote.revenueDifference !== null && (
                <div>
                  <dt>Diferença para o preço atual / mês</dt>
                  <dd>{money(quote.revenueDifference)}</dd>
                </div>
              )}
            </dl>
            <p className={css.help}>
              Estimativa baseada nos custos informados e na fórmula do projeto,
              não uma apuração tributária. Não há pesquisa externa de preços nem
              previsão de vendas. Informe o volume mensal para simular receita.
            </p>
          </section>
        </>
      )}
      <div className={css.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!quote || busy || loading || !!catalog.error}
          onClick={save}
        >
          {busy ? "Salvando…" : "Salvar produto"}
        </button>
      </div>
      {message && (
        <p role="status" className={css.notice}>
          {message}
        </p>
      )}
    </div>
  );
}
