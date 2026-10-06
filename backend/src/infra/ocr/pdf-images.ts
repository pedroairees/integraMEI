import { Worker } from "node:worker_threads";
import { OcrFailure } from "./transport.ts";

// Bound expensive native rendering separately from HTTP concurrency. Never write
// document data to disk or expose PDF.js diagnostics (which can contain input).
let activeWorkers = 0;
export async function pdfImages(
  file: Buffer,
  signal: AbortSignal,
): Promise<string[]> {
  if (signal.aborted) throw new OcrFailure("timeout");
  if (activeWorkers >= 2) throw new OcrFailure("unavailable");
  activeWorkers++;
  let worker: Worker | undefined;
  try {
    worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts") ? "./pdf-worker.ts" : "./pdf-worker.js",
        import.meta.url,
      ),
      {
        workerData: new Uint8Array(file),
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        stdout: true,
        stderr: true,
        env: {}, // Rendering does not need API credentials.
        execArgv: [], // Do not inherit --env-file, inspectors or --input-type.
      },
    );
    worker.stdout.resume();
    worker.stderr.resume();
    return await new Promise<string[]>((resolve, reject) => {
      const abort = () => reject(new OcrFailure("timeout"));
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      worker!.once(
        "message",
        (message: { images?: string[]; error?: string }) => {
          cleanup();
          if (message.error || !message.images?.length) {
            reject(
              new OcrFailure(
                message.error === "document_limit"
                  ? "document_limit"
                  : "conversion",
              ),
            );
          } else resolve(message.images);
        },
      );
      worker!.once("error", () => {
        cleanup();
        reject(new OcrFailure("conversion"));
      });
      worker!.once("exit", () => {
        cleanup();
        reject(new OcrFailure("conversion"));
      });
    });
  } finally {
    try {
      await worker?.terminate();
    } finally {
      activeWorkers--;
    }
  }
}
