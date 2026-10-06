import {
  invoicePrompt,
  invoiceSchema,
  parseProviderExtraction,
} from "./contract.ts";
import { OcrFailure, providerConfig, requestJson } from "./transport.ts";

export class OpenAIInvoiceReader {
  readonly name = "openai" as const;
  async read(file: Buffer, mime: string, signal = AbortSignal.timeout(20000)) {
    const { key, model } = providerConfig(
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_MODEL || "gpt-4.1-mini",
    );
    const dataUrl = `data:${mime};base64,${file.toString("base64")}`;
    const document =
      mime === "application/pdf"
        ? { type: "input_file", filename: "nota.pdf", file_data: dataUrl }
        : { type: "input_image", image_url: dataUrl, detail: "high" };
    const body = await requestJson("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal,
      body: JSON.stringify({
        model,
        store: false,
        instructions: invoicePrompt,
        input: [{ role: "user", content: [document] }],
        max_output_tokens: 8192,
        text: {
          format: {
            type: "json_schema",
            name: "invoice",
            strict: true,
            schema: invoiceSchema,
          },
        },
      }),
    });
    const response = body as {
      status?: string;
      output?: {
        type?: string;
        content?: { type?: string; text?: string }[];
      }[];
    };
    if (!Array.isArray(response.output))
      throw new OcrFailure("invalid_response");
    const parts = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []));
    if (parts.some((part) => part.type === "refusal"))
      throw new OcrFailure("refused");
    if (response.status !== "completed")
      throw new OcrFailure("invalid_response");
    return parseProviderExtraction(
      parts
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "")
        .join(""),
    );
  }
}
