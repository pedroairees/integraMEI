import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExtraction,
  validateSupplyLines,
} from "../src/core/invoices/service.ts";
import {
  parseProviderExtraction,
  invoiceSchema,
} from "../src/infra/ocr/contract.ts";

const data = {
  supplier: "Loja",
  cnpj: "98765432000198",
  recipientCnpj: "12345678000195",
  operation: "sale",
  date: "2025-06-10",
  total: 10,
  number: "1",
  items: ["Farinha"],
  lineItems: [
    { description: "Farinha", quantity: 2, unit: "KG", unitPrice: 5 },
  ],
};
test("OCR preserves structured lines without guessing and normalizes units", () => {
  assert.ok(invoiceSchema.required.includes("lineItems"));
  const parsed = parseProviderExtraction(JSON.stringify(data));
  assert.deepEqual(parsed.lineItems, [
    { description: "Farinha", quantity: 2, unit: "kg", unitPrice: 5 },
  ]);
  assert.doesNotThrow(() => validateSupplyLines(parsed));
  for (const change of [
    { quantity: null },
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 1.0001 },
    { unitPrice: 1.00001 },
    { unitPrice: "5" },
    { unit: null },
  ]) {
    const bad = parseExtraction({
      ...data,
      lineItems: [{ ...data.lineItems[0], ...change }],
    });
    assert.throws(() => validateSupplyLines(bad), { status: 422 });
  }
});
test("legacy descriptions remain reviewable, but cannot auto-import missing or mismatched lines", () => {
  assert.throws(() => parseProviderExtraction(JSON.stringify({ ...data, items: Array(201).fill("Farinha") })), { kind: "invalid_response" });
  for (const change of [
    { lineItems: undefined },
    { lineItems: [] },
    { items: ["Outro"] },
    { total: 9.99 },
  ])
    assert.throws(
      () => validateSupplyLines(parseExtraction({ ...data, ...change })),
      { status: 422 },
    );
  assert.doesNotThrow(() =>
    parseExtraction({ ...data, lineItems: undefined }, true),
  );
});
test("line totals use exact decimal cents, including half-cent rounding and free items", () => {
  for (const [price, total] of [
    [0.005, 0.01],
    [1.005, 1.01],
    [0, 0],
  ]) {
    const parsed = parseExtraction({
      ...data,
      total,
      lineItems: [{ ...data.lineItems[0], quantity: 1, unitPrice: price }],
    });
    assert.doesNotThrow(() => validateSupplyLines(parsed));
  }
});
