"use client";
import { useEffect, useState } from "react";
export interface Supply {
  id: string;
  nome: string;
  unidade_medida: string;
  estoque_minimo: number;
  ativo: boolean;
  versao_cadastro: string;
}
export interface Price {
  id: string;
  date: string;
  value: number;
  unit: string;
  supplier: string;
  source: "manual" | "invoice";
}
export interface History {
  supply: Supply;
  units: string[];
  unit: string;
  points: Price[];
  minimum: Price | null;
  maximum: Price | null;
  average: number | null;
}
export interface CostInvoice {
  id: string;
  nome_arquivo: string;
  data_emissao: string;
  valor_total: number;
  dados_extracao: { supplier: string; items: string[] };
}
export async function suppliesRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/backend/supplies${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Não foi possível acessar os insumos.");
  return data as T;
}
export function useSuppliesResource<T>(path: string | null, revision = 0) {
  const key = `${path}|${revision}`;
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>({ key: "" });
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    suppliesRequest<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : "Falha na consulta.",
          });
      });
    return () => controller.abort();
  }, [path, key]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : undefined,
    loading: path !== null && result.key !== key,
  };
}
export const priceLabel = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 4,
  }).format(value);
export const dateLabel = (value: string) =>
  value.split("-").reverse().join("/");
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
