import {
  invoicePrompt,
  invoiceSchema,
  parseProviderExtraction,
} from "./contract.ts";
import { OcrFailure, providerConfig, requestJson } from "./transport.ts";

export class GeminiInvoiceReader {
  readonly name = "gemini" as const;
  async read(file: Buffer, mime: string, signal = AbortSignal.timeout(20000)) {
    const { key, model } = providerConfig(
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_MODEL || "gemini-3.8-flash",
    );
    const response = await requestJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: invoicePrompt,
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: mime,
                    data: file.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                supplier: { type: "STRING", nullable: true },
                cnpj: { type: "STRING", nullable: true },
                recipientCnpj: { type: "STRING", nullable: true },
                operation: {
                  type: "STRING",
                  enum: ["sale", "service", "other"],
                  nullable: true,
                },
                number: { type: "STRING", nullable: true },
                date: { type: "STRING", nullable: true },
                total: { type: "NUMBER", nullable: true },
                items: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: invoiceSchema.required,
            },
          },
        }),
      },
    );
    const body = response as {
      promptFeedback?: { blockReason?: string };
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
    };
    const candidate = body.candidates?.[0];
    if (
      body.promptFeedback?.blockReason ||
      [
        "SAFETY",
        "RECITATION",
        "BLOCKLIST",
        "PROHIBITED_CONTENT",
        "SPII",
        "IMAGE_SAFETY",
      ].includes(candidate?.finishReason ?? "")
    )
      throw new OcrFailure("refused");
    if (candidate?.finishReason !== "STOP")
      throw new OcrFailure("invalid_response");
    if (!Array.isArray(candidate.content?.parts))
      throw new OcrFailure("invalid_response");
    const text = candidate.content.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("");
    return parseProviderExtraction(text);
  }
}
