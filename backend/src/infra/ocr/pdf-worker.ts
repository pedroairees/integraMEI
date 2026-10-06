import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const assets = dirname(require.resolve("pdfjs-dist/package.json"));
const task = getDocument({
  data: workerData as Uint8Array,
  useSystemFonts: false,
  useWorkerFetch: false,
  cMapUrl: join(assets, "cmaps") + "/",
  cMapPacked: true,
  standardFontDataUrl: join(assets, "standard_fonts") + "/",
  wasmUrl: join(assets, "wasm") + "/",
  maxImageSize: 16_000_000,
  stopAtErrors: true,
  verbosity: 0,
});
try {
  const pdf = await task.promise;
  if (pdf.numPages > 3) {
    parentPort!.postMessage({ error: "document_limit" });
  } else {
    const images: string[] = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const original = page.getViewport({ scale: 1 });
      // About 144dpi for A4, bounded to 2000px on the longest side.
      const viewport = page.getViewport({
        scale: Math.min(2, 2000 / Math.max(original.width, original.height)),
      });
      if (
        !Number.isFinite(viewport.width) ||
        !Number.isFinite(viewport.height) ||
        viewport.width < 1 ||
        viewport.height < 1
      )
        throw new Error();
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      try {
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
          background: "rgb(255,255,255)",
        }).promise;
        const image = canvas.toBuffer("image/png");
        total += image.length;
        if (total > 10 * 1024 * 1024) throw new Error("document_limit");
        images.push(`data:image/png;base64,${image.toString("base64")}`);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
    }
    parentPort!.postMessage({ images });
  }
} catch (error) {
  parentPort!.postMessage({
    error:
      error instanceof Error && error.message === "document_limit"
        ? "document_limit"
        : "conversion",
  });
} finally {
  await task.destroy();
}
