"use client";

import { useEffect, useState } from "react";
import { FinancialChart } from "./FinancialChart";
import { Notifications } from "./DashboardActions";
import { currency, percentage, type DashboardData } from "./types";
import styles from "./Dashboard.module.css";
import { financialUpdateEvent } from "@/src/lib/financial-updates";

const colors = [
  "#1b3a70",
  "#67aade",
  "#4caf50",
  "#c69331",
  "#8e6ca8",
  "#ca6f60",
];
function Metric({
  title,
  value,
  change,
  compare,
  cost = false,
}: {
  title: string;
  value: number;
  change: number | null;
  compare: boolean;
  cost?: boolean;
}) {
  const good = change !== null && (cost ? change <= 0 : change >= 0);
  return (
    <article className={styles.metric}>
      <h2>{title}</h2>
      <p className={styles.metricValue}>{currency(value)}</p>
      {compare && (
        <p className={styles.comparison}>
          {change === null ? (
            "Sem base no mês anterior"
          ) : (
            <>
              <strong className={good ? styles.positive : styles.negative}>
                {change > 0 ? "↑ " : change < 0 ? "↓ " : ""}
                {percentage(Math.abs(change))}
              </strong>{" "}
              vs mês anterior
            </>
          )}
        </p>
      )}
    </article>
  );
}

export function DashboardPanel() {
  const [month, setMonth] = useState("");
  const [months, setMonths] = useState("6");
  const [scope, setScope] = useState("professional");
  const [compare, setCompare] = useState(true);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    query?: string;
    data?: DashboardData;
    error?: string;
  }>({ key: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    query: string;
    name: string;
    rows: { date: string; value: number; unit: string; supplier: string }[];
  } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyPending, setHistoryPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const query = new URLSearchParams({
    months,
    scope,
    ...(month ? { month } : {}),
  }).toString();
  const key = `${query}:${revision}`;
  const loading = result.key !== key;
  const data = result.query === query ? result.data : undefined;
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < 2000) return;
      last = Date.now(); setRevision(v => v + 1);
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(financialUpdateEvent) : null;
    if (channel) channel.onmessage = refresh;
    window.addEventListener(financialUpdateEvent, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      channel?.close(); window.clearInterval(timer);
      window.removeEventListener(financialUpdateEvent, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/backend/dashboard?${query}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw Error(body.message ?? "Não foi possível carregar o painel.");
        return body as DashboardData;
      })
      .then((data) => { if (!controller.signal.aborted) setResult({ key, query, data }); })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult(previous => ({
            key,
            query,
            data: previous.query === query ? previous.data : undefined,
            error: error instanceof Error ? error.message : "Erro de conexão.",
          }));
      });
    return () => controller.abort();
  }, [key, query]);

  async function saveGoal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = Number(values.get("value"));
    const marginTarget =
      values.get("marginTarget") === ""
        ? null
        : Number(values.get("marginTarget"));
    setSaving(true);
    setSaveMessage("");
    try {
      const r = await fetch("/api/backend/dashboard/goal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, marginTarget }),
      });
      if (!r.ok) throw Error((await r.json()).message);
      setSaveMessage("Meta salva.");
      setRevision((v) => v + 1);
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function openHistory(id: string, name: string) {
    setHistory(null);
    setHistoryError("");
    setHistoryPending(true);
    try {
      const r = await fetch(`/api/backend/supplies/${id}/history?${query}`, {
        cache: "no-store",
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.message);
      setHistory({ query, name, rows: body });
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar o histórico.",
      );
    } finally {
      setHistoryPending(false);
    }
  }
  const category = data?.distribution.find((c) => c.id === selected);
  return (
    <>
      <div className={styles.filters}>
        <label>
          Mês de referência
          <input
            aria-label="Mês de referência"
            type="month"
            value={month || data?.filter.month || ""}
            onChange={(e) => {
              setMonth(e.target.value);
              setHistory(null);
              setSelected(null);
            }}
          />
        </label>
        <label>
          Visão
          <select
            aria-label="Visão"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setSelected(null);
              setHistory(null);
            }}
          >
            <option value="professional">Profissional</option>
            <option value="personal">Pessoal / retiradas</option>
            <option value="all">Todas as despesas</option>
          </select>
        </label>
        <label className={styles.compareToggle}>
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />{" "}
          Comparar com mês anterior
        </label>
        <button
          type="button"
          onClick={() => setRevision((v) => v + 1)}
          disabled={loading}
        >
          Atualizar dados
        </button>
        {data && <Notifications alerts={data.alerts} />}
      </div>
      {loading && (
        <p role="status" className={styles.notice}>
          Carregando dados da sua empresa...
        </p>
      )}
      {!loading && result.error && (
        <div role="alert" className={styles.notice}>
          <p>{result.error}</p>
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {data && (
        <>
          {data.empty && (
            <p role="status" className={styles.notice}>
              Nenhuma venda ou despesa confirmada neste mês. Os indicadores
              serão atualizados quando houver lançamentos.
            </p>
          )}
          <section className={styles.metrics} aria-label="Resumo financeiro">
            <Metric
              title="Lucro Líquido"
              value={data.metrics.profit}
              change={data.metrics.profitChange}
              compare={compare}
            />
            <Metric
              title="Receita do Mês"
              value={data.metrics.revenue}
              change={data.metrics.revenueChange}
              compare={compare}
            />
            <Metric
              title="Custos Profissionais"
              value={data.metrics.costs}
              change={data.metrics.costChange}
              compare={compare}
              cost
            />
            <article className={styles.metric}>
              <h2>Meta de Faturamento</h2>
              <div className={styles.targetValues}>
                <p>
                  {data.goal.value ? currency(data.goal.value) : "Não definida"}
                </p>
                <span>
                  {data.goal.percentage === null
                    ? "—"
                    : percentage(data.goal.percentage)}
                </span>
              </div>
              <progress
                className={styles.targetProgress}
                value={Math.min(100, Math.max(0, data.goal.percentage ?? 0))}
                max={100}
                aria-label="Progresso da meta de faturamento"
              />
              {data.canEditGoal && (
                <details className={styles.goalEditor}>
                  <summary>Editar meta</summary>
                  <form onSubmit={saveGoal}>
                    <label>
                      Meta mensal (R$)
                      <input
                        name="value"
                        type="number"
                        min="0"
                        max="999999999"
                        step="0.01"
                        defaultValue={data.goal.value}
                        required
                      />
                    </label>
                    <label>
                      Meta de margem (%)
                      <input
                        name="marginTarget"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue={data.marginTarget ?? ""}
                      />
                    </label>
                    <button disabled={saving}>
                      {saving ? "Salvando..." : "Salvar meta"}
                    </button>
                  </form>
                </details>
              )}
            </article>
          </section>
          {saveMessage && <p role="status">{saveMessage}</p>}
          <div className={styles.insights}>
            <p>
              <strong>Pró-labore / retiradas:</strong>{" "}
              {currency(data.metrics.withdrawals)}. Não entram no lucro
              operacional.
            </p>
            {compare && <p>{data.insight}</p>}
            <p>
              <strong>Projeção de faturamento:</strong>{" "}
              {data.goal.projection === null
                ? "Dados insuficientes para projeção. Continue registrando suas vendas: são necessários 15 dias distintos com vendas no mês."
                : `${currency(data.goal.projection)}${data.goal.projectedToReach === null ? "" : data.goal.projectedToReach ? " — ritmo suficiente para atingir a meta." : " — abaixo da meta no ritmo atual."}`}
            </p>
          </div>
          <section className={styles.evolution} aria-labelledby="cost-title">
            <div className={styles.chartHeading}>
              <h2 id="cost-title">Evolução dos Gastos</h2>
              <label>
                Período
                <select
                  className={styles.period}
                  value={months}
                  onChange={(e) => {
                    setMonths(e.target.value);
                    setHistory(null);
                  }}
                >
                  <option value="3">Últimos 3 meses</option>
                  <option value="6">Últimos 6 meses</option>
                  <option value="12">Últimos 12 meses</option>
                </select>
              </label>
            </div>
            <FinancialChart key={key} points={data.evolution} />
          </section>
          <section
            className={styles.bottomCharts}
            aria-label="Análises financeiras"
          >
            <article className={styles.bottomCard}>
              <h2>Distribuição de Gastos</h2>
              {!data.distribution.length ? (
                <p className={styles.notice}>
                  Sem despesas confirmadas nesta visão e período.
                </p>
              ) : (
                <>
                  <svg
                    className={styles.liveDonut}
                    viewBox="0 0 140 140"
                    role="group"
                    aria-label="Distribuição por categoria"
                  >
                    {data.distribution.map((c, i) => {
                      const start = data.distribution
                        .slice(0, i)
                        .reduce((sum, item) => sum + item.percentage, 0);
                      return (
                        <circle
                          key={c.id}
                          cx="70"
                          cy="70"
                          r="48"
                          fill="none"
                          stroke={colors[i % colors.length]}
                          strokeWidth="24"
                          pathLength="100"
                          strokeDasharray={`${c.percentage} ${100 - c.percentage}`}
                          strokeDashoffset={-start}
                          transform="rotate(-90 70 70)"
                          role="button"
                          tabIndex={0}
                          aria-label={`${c.name}: ${percentage(c.percentage)}, ${currency(c.value)}`}
                          onClick={() => {
                            setSelected(c.id);
                            setHistory(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected(c.id);
                            }
                          }}
                        >
                          <title>
                            {c.name}: {currency(c.value)}
                          </title>
                        </circle>
                      );
                    })}
                  </svg>
                  <ul className={styles.legend}>
                    {data.distribution.map((c, i) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(c.id);
                            setHistory(null);
                          }}
                          aria-pressed={selected === c.id}
                        >
                          <span
                            style={{
                              backgroundColor: colors[i % colors.length],
                            }}
                          />
                          {c.name}: {currency(c.value)} (
                          {percentage(c.percentage)})
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </article>
            <article className={styles.bottomCard}>
              <h2>Margem de Lucro</h2>
              <svg
                viewBox="0 0 180 105"
                className={styles.liveGauge}
                role="img"
                aria-label={
                  data.metrics.margin === null
                    ? "Margem indisponível: sem receita"
                    : `Margem de lucro: ${percentage(data.metrics.margin)}`
                }
              >
                <path
                  d="M 20 85 A 65 65 0 0 1 150 85"
                  fill="none"
                  stroke="#e4e8ed"
                  strokeWidth="18"
                />
                <path
                  d="M 20 85 A 65 65 0 0 1 150 85"
                  fill="none"
                  stroke={data.metrics.profit < 0 ? "#b52323" : "#4caf50"}
                  strokeWidth="18"
                  pathLength="100"
                  strokeDasharray={`${Math.min(100, Math.max(0, data.metrics.margin ?? 0))} 100`}
                />
                <text
                  x="85"
                  y="80"
                  textAnchor="middle"
                  fontSize="22"
                  fill="#1b3a70"
                >
                  {data.metrics.margin === null
                    ? "—"
                    : percentage(data.metrics.margin)}
                </text>
              </svg>
              <p className={styles.notice}>
                {data.metrics.margin === null
                  ? "Sem receita para calcular a margem."
                  : data.marginTarget === null
                    ? "(Receita − custos profissionais) ÷ receita. Configure sua meta em Editar meta."
                    : `${data.metrics.margin >= data.marginTarget ? "Meta de margem atingida" : "Abaixo da meta de margem"} (${percentage(data.marginTarget)}).`}
              </p>
            </article>
          </section>
          {category && (
            <section
              className={styles.detailPanel}
              aria-label="Detalhamento dos gastos"
            >
              <h2>{category.name}: 5 insumos de maior impacto</h2>
              {category.topSupplies.length ? (
                <ul>
                  {category.topSupplies.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={historyPending}
                        onClick={() => openHistory(s.id, s.name)}
                      >
                        {s.name} — {currency(s.value)} — Ver histórico
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Não há insumos vinculados às notas desta categoria.</p>
              )}
            </section>
          )}
          {historyPending && <p role="status">Carregando histórico...</p>}
          {historyError && <p role="alert">{historyError}</p>}
          {history && history.query === query && (
            <section className={styles.detailPanel}>
              <h2>Histórico: {history.name}</h2>
              {history.rows.length ? (
                <div className={styles.chartScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Preço unitário</th>
                        <th>Unidade</th>
                        <th>Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.date.split("-").reverse().join("/")}</td>
                          <td>{currency(r.value)}</td>
                          <td>{r.unit}</td>
                          <td>{r.supplier}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>
                  Histórico indisponível: realize o primeiro lançamento de nota
                  para este insumo.
                </p>
              )}
            </section>
          )}
          <p className={styles.dataNotice}>
            Dados reais de {data.companyName}, por data de emissão. Atualização automática a cada 30 segundos enquanto esta tela estiver visível. Atualizado às{" "}
            {new Date(data.updatedAt).toLocaleTimeString("pt-BR")}.
          </p>
        </>
      )}
    </>
  );
}
