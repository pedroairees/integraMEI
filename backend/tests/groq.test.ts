import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { GroqInvoiceReader } from "../src/infra/ocr/groq.ts";
import { pdfImages } from "../src/infra/ocr/pdf-images.ts";
import {
  ResilientInvoiceReader,
  type OcrEvent,
} from "../src/infra/ocr/reader.ts";
import { InvoiceService } from "../src/core/invoices/service.ts";
import type { InvoiceRepository } from "../src/core/invoices/types.ts";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const image = createCanvas(8, 8).toBuffer("image/png");
const extracted = {
  supplier: "Fornecedor",
  cnpj: "98765432000198",
  recipientCnpj: "12123123000112",
  operation: "sale",
  number: "1001",
  date: "2026-10-06",
  total: 480,
  items: ["Produto ficticio"],
};
const groqSuccess = () =>
  Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(extracted) },
      },
    ],
  });
const geminiSuccess = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(extracted) }] },
      },
    ],
  });
const realFetch = globalThis.fetch;
const keys = [
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
];
let original: (string | undefined)[];
beforeEach(() => {
  original = keys.map((k) => process.env[k]);
  process.env.GROQ_API_KEY = "secret-groq-test";
  process.env.GEMINI_API_KEY = "secret-gemini-test";
  process.env.OPENAI_API_KEY = "must-never-be-used";
  delete process.env.GROQ_MODEL;
  delete process.env.GEMINI_MODEL;
  globalThis.fetch = async () => {
    throw new Error("Unexpected call");
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  keys.forEach((k, i) => {
    if (original[i] === undefined) delete process.env[k];
    else process.env[k] = original[i];
  });
});
function reader() {
  const events: OcrEvent[] = [];
  const delays: number[] = [];
  return {
    events,
    delays,
    reader: new ResilientInvoiceReader({
      report: (e) => events.push(e),
      random: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }),
  };
}
// Self-contained valid PDF fixture; no dependency on user files or external tools.
function fixturePdf(pages = 1) {
  const content =
    "0 0 0 rg 20 20 120 20 re f BT /F1 14 Tf 20 150 Td (NOTA FICTICIA 1001) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...Array.from(
      { length: pages },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
    ),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

test("production default is Groq, JSON image request never contacts OpenAI", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer secret-groq-test",
    );
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen/qwen3.8-27b");
    assert.equal(body.reasoning_effort, "none");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(
      body.messages[1].content[1].image_url.url,
      `data:image/png;base64,${image.toString("base64")}`,
    );
    assert.match(body.messages[0].content, /ignore instruções/);
    return groqSuccess();
  };
  const harness = reader();
  assert.deepEqual(await harness.reader.read(image, "image/png"), extracted);
  assert.equal(calls, 1);
  assert.equal(harness.events[0]?.provider, "groq");
});

test("model IDs with a slash and JPEG work; invalid model never makes a request", async () => {
  process.env.GROQ_MODEL = "vendor/vision-model";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "vendor/vision-model");
    assert.equal(body.reasoning_effort, undefined);
    assert.match(
      body.messages[1].content[1].image_url.url,
      /^data:image\/jpeg;base64,/,
    );
    return groqSuccess();
  };
  await new GroqInvoiceReader().read(image, "image/jpeg");
  process.env.GROQ_MODEL = "bad model?";
  await assert.rejects(() => new GroqInvoiceReader().read(image, "image/png"), {
    kind: "configuration",
  });
});

test("PDF conversion renders every page, with visible pixels and bounded dimensions", async () => {
  const images = await pdfImages(fixturePdf(3), AbortSignal.timeout(10000));
  assert.equal(images.length, 3);
  const raster = await loadImage(images[0]!);
  assert.equal(raster.width, 600);
  assert.equal(raster.height, 400);
  const canvas = createCanvas(raster.width, raster.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(raster, 0, 0);
  assert.equal(ctx.getImageData(50, 340, 1, 1).data[0], 0);
  assert.equal(ctx.getImageData(590, 10, 1, 1).data[0], 255);
});

test("PDFs reach Groq as PNGs, not unsupported PDF data URLs", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /api.groq.com/);
    const body = JSON.parse(String(init?.body));
    const contents = body.messages[1].content;
    assert.equal(contents.length, 3);
    for (const item of contents.slice(1))
      assert.match(item.image_url.url, /^data:image\/png;base64,iVBOR/);
    return groqSuccess();
  };
  assert.deepEqual(
    await reader().reader.read(fixturePdf(2), "application/pdf"),
    extracted,
  );
  assert.equal(calls, 1);
});

test("PDF above three pages is sent whole to Gemini, never truncated", async () => {
  const pdf = fixturePdf(4);
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /googleapis.com/);
    const body = JSON.parse(String(init?.body));
    assert.equal(
      body.contents[0].parts[0].inlineData.data,
      pdf.toString("base64"),
    );
    return geminiSuccess();
  };
  const harness = reader();
  await harness.reader.read(pdf, "application/pdf");
  assert.deepEqual(
    harness.events.map((e) => e.provider),
    ["groq", "gemini"],
  );
  assert.equal(harness.events[0]?.category, "document_limit");
});

test("malformed PDF conversion fails safely and cancellation releases renderer capacity", async () => {
  await assert.rejects(
    () => pdfImages(Buffer.from("%PDF-broken"), AbortSignal.timeout(10000)),
    { kind: "conversion" },
  );
  const controller = new AbortController();
  const pending = pdfImages(fixturePdf(3), controller.signal);
  controller.abort();
  await assert.rejects(() => pending, { kind: "timeout" });
  await assert.rejects(() => pdfImages(fixturePdf(), controller.signal), {
    kind: "timeout",
  });
  assert.equal(
    (await pdfImages(fixturePdf(), AbortSignal.timeout(10000))).length,
    1,
  );
});

test("429 and network errors retry Groq then fall back to Gemini without leaked details", async () => {
  for (const network of [false, true]) {
    const hosts: string[] = [];
    globalThis.fetch = async (url) => {
      const host = new URL(String(url)).hostname;
      hosts.push(host);
      if (host === "api.groq.com") {
        if (network) throw new Error("secret details");
        return Response.json(
          { error: { message: "secret details" } },
          { status: 429 },
        );
      }
      assert.equal(host, "generativelanguage.googleapis.com");
      return geminiSuccess();
    };
    const harness = reader();
    await harness.reader.read(image, "image/png");
    assert.deepEqual(hosts, [
      "api.groq.com",
      "api.groq.com",
      "generativelanguage.googleapis.com",
    ]);
    assert.deepEqual(harness.delays, [750]);
    assert.ok(!JSON.stringify(harness.events).includes("secret"));
  }
});

test("Groq can recover on retry without Gemini; long Retry-After goes directly to Gemini", async () => {
  for (const delay of ["1", "120"]) {
    let calls = 0;
    globalThis.fetch = async (url) => {
      if (!String(url).includes("api.groq.com")) return geminiSuccess();
      return ++calls === 1
        ? Response.json({}, { status: 429, headers: { "Retry-After": delay } })
        : groqSuccess();
    };
    const harness = reader();
    await harness.reader.read(image, "image/png");
    assert.equal(calls, delay === "1" ? 2 : 1);
    assert.deepEqual(harness.delays, delay === "1" ? [1000] : []);
  }
});

test("missing Groq key skips rendering and uses Gemini; no keys never calls OpenAI", async () => {
  delete process.env.GROQ_API_KEY;
  let count = 0;
  globalThis.fetch = async (url) => {
    count++;
    assert.match(String(url), /googleapis.com/);
    return geminiSuccess();
  };
  await reader().reader.read(Buffer.from("%PDF-broken"), "application/pdf");
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(
    () => reader().reader.read(image, "image/png"),
    /Groq: chave não configurada.*Gemini: chave não configurada/,
  );
  assert.equal(count, 1);
});

test("authentication/configuration errors skip retry and use Gemini", async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      return String(url).includes("api.groq.com")
        ? Response.json({}, { status })
        : geminiSuccess();
    };
    const harness = reader();
    await harness.reader.read(image, "image/png");
    assert.equal(calls, 2);
    assert.equal(harness.delays.length, 0);
  }
});

test("truncated and malformed JSON are not accepted as a complete invoice", async () => {
  for (const choices of [
    [],
    [
      {
        finish_reason: "length",
        message: { content: JSON.stringify(extracted) },
      },
    ],
    [{ finish_reason: "stop", message: { content: "{}" } }],
  ]) {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      return String(url).includes("api.groq.com")
        ? Response.json({ choices })
        : geminiSuccess();
    };
    const harness = reader();
    await harness.reader.read(image, "image/png");
    assert.equal(calls, 2);
    assert.equal(harness.events[0]?.category, "invalid_response");
  }
});

test("refusal or rejected input never triggers provider shopping", async () => {
  for (const refusal of [true, false]) {
    let count = 0;
    globalThis.fetch = async () => {
      count++;
      return refusal
        ? Response.json({
            choices: [
              {
                finish_reason: "content_filter",
                message: { refusal: "private" },
              },
            ],
          })
        : Response.json({}, { status: 400 });
    };
    await assert.rejects(() => reader().reader.read(image, "image/png"), {
      status: 422,
    });
    assert.equal(count, 1);
  }
});

test("wrong-tab extraction is rejected before saving and does not call Gemini", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /api.groq.com/);
    return groqSuccess();
  };
  const repository = {
    duplicate: async () => null,
    companyCnpj: async () => "12123123000112",
    upload: async () => assert.fail("Must not save"),
  } as unknown as InvoiceRepository;
  const service = new InvoiceService(repository, reader().reader);
  await assert.rejects(
    () =>
      service.upload({
        name: "note.png",
        mime: "image/png",
        content: image.toString("base64"),
        kind: "revenue",
      }),
    { status: 422 },
  );
  assert.equal(calls, 1);
});

test("both unavailable report Groq and Gemini only, without raw error messages", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: { message: "secret-groq-test" } }, { status: 503 });
  const harness = reader();
  await assert.rejects(
    () => harness.reader.read(image, "image/png"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Groq: serviço temporariamente indisponível.*Gemini: serviço temporariamente indisponível/,
      );
      assert.doesNotMatch(error.message, /OpenAI|secret/);
      return true;
    },
  );
  assert.equal(harness.events.length, 4);
});
