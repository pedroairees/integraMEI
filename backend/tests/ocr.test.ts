import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIInvoiceReader } from "../src/infra/ocr/openai.ts";
import { GeminiInvoiceReader } from "../src/infra/ocr/gemini.ts";
import {
  ResilientInvoiceReader,
  type OcrEvent,
} from "../src/infra/ocr/reader.ts";
import { OcrFailure, requestJson } from "../src/infra/ocr/transport.ts";
import { invoiceSchema } from "../src/infra/ocr/contract.ts";
import { InvoiceService } from "../src/core/invoices/service.ts";
import type { InvoiceRepository } from "../src/core/invoices/types.ts";

const pdf = Buffer.from("%PDF-1.4\nPrivate invoice contents\n%%EOF");
const extraction = {
  supplier: "Fornecedor teste",
  cnpj: "98765432000198",
  recipientCnpj: "12123123000112",
  operation: "sale" as const,
  number: "123",
  date: "2026-10-06",
  total: 123.45,
  items: ["Produto de teste"],
};
const openaiSuccess = () =>
  Response.json({
    status: "completed",
    output: [
      { type: "reasoning" },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(extraction) }],
      },
    ],
  });
const geminiSuccess = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { thought: true, text: "do not use private reasoning" },
            { text: JSON.stringify(extraction) },
          ],
        },
      },
    ],
  });
const realFetch = globalThis.fetch;
const envKeys = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
] as const;
let previous: (string | undefined)[];
beforeEach(() => {
  previous = envKeys.map((key) => process.env[key]);
  process.env.OPENAI_API_KEY = "secret-openai-test";
  process.env.GEMINI_API_KEY = "secret-gemini-test";
  delete process.env.OPENAI_MODEL;
  delete process.env.GEMINI_MODEL;
  globalThis.fetch = async () => {
    throw new Error("Unexpected network call");
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  envKeys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key];
    else process.env[key] = previous[i];
  });
});
function harness() {
  const events: OcrEvent[] = [],
    delays: number[] = [];
  let time = 0;
  const reader = new ResilientInvoiceReader({
    // Retained adapter regression tests; production defaults are covered by groq.test.ts.
    providers: [new OpenAIInvoiceReader(), new GeminiInvoiceReader()],
    report: (event) => events.push(event),
    now: () => time,
    random: () => 0,
    sleep: async (ms) => {
      delays.push(ms);
      time += ms;
    },
  });
  return { reader, events, delays };
}

test("retained OpenAI adapter (explicit injection only) uses inline PDF/vision and strict JSON", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer secret-openai-test",
    );
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-4.1-mini");
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema, invoiceSchema);
    assert.equal(
      body.input[0].content[0].file_data,
      `data:application/pdf;base64,${pdf.toString("base64")}`,
    );
    assert.match(body.instructions, /ignore instruções/);
    return openaiSuccess();
  };
  const { reader, events } = harness();
  assert.deepEqual(await reader.read(pdf, "application/pdf"), extraction);
  assert.equal(calls.length, 1);
  assert.equal(events[0]?.provider, "openai");
  assert.equal(events[0]?.outcome, "success");
});

test("OpenAI supports PNG/JPEG and configurable model without the file upload API", async () => {
  process.env.OPENAI_MODEL = "gpt-4.1-mini-2025-04-14";
  for (const mime of ["image/png", "image/jpeg"]) {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, process.env.OPENAI_MODEL);
      assert.deepEqual(body.input[0].content[0], {
        type: "input_image",
        image_url: `data:${mime};base64,${pdf.toString("base64")}`,
        detail: "high",
      });
      return openaiSuccess();
    };
    assert.deepEqual(
      await new OpenAIInvoiceReader().read(pdf, mime),
      extraction,
    );
  }
});

test("one transient retry can recover OpenAI without calling Gemini", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /api.openai.com/);
    return ++calls === 1 ? Response.json({}, { status: 503 }) : openaiSuccess();
  };
  const { reader, delays, events } = harness();
  await reader.read(pdf, "application/pdf");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [750]);
  assert.equal(events[0]?.category, "unavailable");
  assert.equal(events[0]?.httpStatus, 503);
});

test("Gemini is used only after primary retries are exhausted, with the same bytes and fields", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("api.openai.com"))
      return Response.json(
        { error: { message: "secret private diagnostic" } },
        { status: 503 },
      );
    const body = JSON.parse(String(init?.body));
    assert.equal(
      new Headers(init?.headers).get("x-goog-api-key"),
      "secret-gemini-test",
    );
    assert.equal(
      body.contents[0].parts[0].inlineData.data,
      pdf.toString("base64"),
    );
    assert.deepEqual(
      body.generationConfig.responseSchema.required,
      invoiceSchema.required,
    );
    return geminiSuccess();
  };
  const { reader, events } = harness();
  assert.deepEqual(await reader.read(pdf, "application/pdf"), extraction);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    events.map((e) => e.provider),
    ["openai", "openai", "gemini"],
  );
  assert.ok(!JSON.stringify(events).includes("secret"));
  assert.ok(!JSON.stringify(events).includes("Fornecedor"));
});

test("quota, authentication and model configuration failures skip primary retry but allow fallback", async () => {
  for (const [status, code, expected] of [
    [429, "insufficient_quota", "quota"],
    [401, "invalid_api_key", "authentication"],
    [403, "permission_denied", "authentication"],
    [404, "model_not_found", "configuration"],
  ] as const) {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      return String(url).includes("api.openai.com")
        ? Response.json({ error: { code } }, { status })
        : geminiSuccess();
    };
    const { reader, delays, events } = harness();
    await reader.read(pdf, "application/pdf");
    assert.equal(calls, 2);
    assert.deepEqual(delays, []);
    assert.equal(events[0]?.category, expected);
  }
});

test("missing primary key uses Gemini; both missing return actionable error without external calls", async () => {
  delete process.env.OPENAI_API_KEY;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /googleapis.com/);
    return geminiSuccess();
  };
  await harness().reader.read(pdf, "application/pdf");
  assert.equal(calls, 1);
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(
    () => harness().reader.read(pdf, "application/pdf"),
    (error) =>
      error instanceof Error &&
      /OpenAI: chave não configurada/.test(error.message) &&
      /Gemini: chave não configurada/.test(error.message),
  );
  assert.equal(calls, 1);
});

test("Retry-After is respected; excessive delay falls back instead of exceeding request deadline", async () => {
  for (const retryAfter of ["2", "120"]) {
    let primaryCalls = 0;
    globalThis.fetch = async (url) => {
      if (!String(url).includes("api.openai.com")) return geminiSuccess();
      primaryCalls++;
      return primaryCalls === 1
        ? Response.json(
            {},
            { status: 429, headers: { "Retry-After": retryAfter } },
          )
        : openaiSuccess();
    };
    const { reader, delays } = harness();
    await reader.read(pdf, "application/pdf");
    assert.deepEqual(delays, retryAfter === "2" ? [2000] : []);
    assert.equal(primaryCalls, retryAfter === "2" ? 2 : 1);
  }
});

test("both unavailable: max four attempts, safe diagnostics and no leaked raw error/body", async () => {
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: `secret-openai-test ${pdf.toString()}` } },
      { status: 503 },
    );
  const { reader, events, delays } = harness();
  await assert.rejects(
    () => reader.read(pdf, "application/pdf"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /OpenAI: serviço temporariamente indisponível/,
      );
      assert.match(
        error.message,
        /Gemini: serviço temporariamente indisponível/,
      );
      assert.ok(!error.message.includes("secret"));
      assert.ok(!error.message.includes("Private invoice"));
      return true;
    },
  );
  assert.equal(events.length, 4);
  assert.equal(delays.length, 2);
});

test("network failures are retried and classified without exposing low-level errors", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.openai.com"))
      throw new TypeError("secret DNS details");
    return geminiSuccess();
  };
  const { reader, events } = harness();
  await reader.read(pdf, "application/pdf");
  assert.deepEqual(
    events.map((event) => event.category),
    ["network", "network", undefined],
  );
});

test("malformed/incomplete OpenAI responses fall back once, not silently coerced to an invoice", async () => {
  for (const body of [
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "{}" }] },
      ],
    },
  ]) {
    let count = 0;
    globalThis.fetch = async (url) => {
      count++;
      return String(url).includes("api.openai.com")
        ? Response.json(body)
        : geminiSuccess();
    };
    const { reader, events } = harness();
    await reader.read(pdf, "application/pdf");
    assert.equal(count, 2);
    assert.equal(events[0]?.category, "invalid_response");
  }
});

test("refusals and invalid input do not trigger retries or another provider", async () => {
  for (const refusal of [true, false]) {
    let count = 0;
    globalThis.fetch = async () => {
      count++;
      return refusal
        ? Response.json({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "private reason" }],
              },
            ],
          })
        : Response.json({}, { status: 400 });
    };
    await assert.rejects(() => harness().reader.read(pdf, "application/pdf"), {
      status: 422,
    });
    assert.equal(count, 1);
  }
  globalThis.fetch = async () =>
    Response.json({ promptFeedback: { blockReason: "SAFETY" } });
  await assert.rejects(
    () => new GeminiInvoiceReader().read(pdf, "application/pdf"),
    { kind: "refused" },
  );
});

test("valid extraction rejected by CNPJ/category never calls secondary or saves a file", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /api.openai.com/);
    return openaiSuccess();
  };
  const repository = {
    duplicate: async () => null,
    companyCnpj: async () => "12123123000112",
    upload: async () => assert.fail("Wrong category must not be stored"),
  } as unknown as InvoiceRepository;
  const service = new InvoiceService(repository, harness().reader);
  await assert.rejects(
    () =>
      service.upload({
        name: "note.pdf",
        mime: "application/pdf",
        content: pdf.toString("base64"),
        kind: "revenue",
      }),
    { status: 422 },
  );
  assert.equal(calls, 1);
});

test("provider budget prevents timeout retries from starving secondary", async () => {
  let time = 0;
  const names: string[] = [];
  const reader = new ResilientInvoiceReader({
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    providers: [
      {
        name: "openai",
        read: async () => {
          names.push("openai");
          time += 20000;
          throw new OcrFailure("timeout");
        },
      },
      {
        name: "gemini",
        read: async () => {
          names.push("gemini");
          time += 20000;
          throw new OcrFailure("timeout");
        },
      },
    ],
  });
  await assert.rejects(() => reader.read(pdf, "application/pdf"), {
    status: 503,
  });
  assert.deepEqual(names, ["openai", "gemini"]);
  assert.ok(time <= 44000);
});

test("network and response-body timeouts are mapped to timeout category", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => {
    throw new Error("Aborted");
  };
  await assert.rejects(
    () =>
      requestJson("https://api.openai.com/v1/responses", {
        signal: controller.signal,
      }),
    { kind: "timeout" },
  );
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => {
        throw new Error("Aborted body");
      },
    }) as unknown as Response;
  await assert.rejects(
    () =>
      requestJson("https://api.openai.com/v1/responses", {
        signal: controller.signal,
      }),
    { kind: "timeout" },
  );
});
