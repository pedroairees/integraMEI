import {
  invoicePrompt,
  invoiceSchema,
  parseProviderExtraction,
} from "./contract.ts";
import { OcrFailure, providerConfig, requestJson } from "./transport.ts";
import { pdfImages } from "./pdf-images.ts";

export class GroqInvoiceReader {
  readonly name = "groq" as const;
  // Only successful conversions are cached for retries of the same in-memory
  // upload. Weak keys allow collection after the request, without cross-user state.
  private images = new WeakMap<Buffer, string[]>();

  async read(file: Buffer, mime: string, signal = AbortSignal.timeout(20000)) {
    const { key, model } = providerConfig(
      process.env.GROQ_API_KEY,
      process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
    );
    if (signal.aborted) throw new OcrFailure("timeout");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(mime))
      throw new OcrFailure("bad_request");
    let images = this.images.get(file);
    if (!images) {
      images =
        mime === "application/pdf"
          ? await pdfImages(file, signal)
          : [`data:${mime};base64,${file.toString("base64")}`];
      this.images.set(file, images);
    }
    const response = await requestJson(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: `${invoicePrompt} Responda somente com um objeto JSON que respeite este schema: ${JSON.stringify(invoiceSchema)}`,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extraia a nota fiscal completa das imagens anexadas, na ordem das páginas. Retorne JSON.",
                },
                ...images.map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
              ],
            },
          ],
          response_format: { type: "json_object" },
          ...(model === "qwen/qwen3.8-27b" ? { reasoning_effort: "none" } : {}),
          // Three images already consume 6144 input tokens on this model.
          // Leave room for the JSON prompt under the free-tier per-minute budget.
          max_completion_tokens: images.length === 3 ? 1024 : 2048,
        }),
      },
    );
    const body = response as {
      choices?: {
        finish_reason?: string;
        message?: { content?: string; refusal?: string };
      }[];
    };
    const choice = body.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter")
      throw new OcrFailure("refused");
    if (
      choice?.finish_reason !== "stop" ||
      typeof choice.message?.content !== "string"
    )
      throw new OcrFailure("invalid_response");
    return parseProviderExtraction(choice.message.content);
  }
}
