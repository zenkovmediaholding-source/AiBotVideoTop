import type { GenerationResult } from "./types.js";

const REPLICATE_API = "https://api.replicate.com/v1";
const MODEL = "black-forest-labs/flux-schnell";

type Prediction = {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
};

function outputUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = outputUrl(item);
      if (url) return url;
    }
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["url", "image", "output"]) {
      const url = outputUrl(obj[key]);
      if (url) return url;
    }
  }
  return undefined;
}

function aspectRatio(ratio?: string): string {
  if (ratio === "16:9") return "16:9";
  if (ratio === "9:16") return "9:16";
  return "1:1";
}

export class ReplicatePhotoProvider {
  async generatePhoto(input: { prompt: string; ratio?: string }): Promise<GenerationResult> {
    const token = process.env.REPLICATE_API_TOKEN?.trim();
    if (!token) {
      return { status: "unavailable", message: "Replicate не настроен." };
    }

    const created = await fetch(REPLICATE_API + "/models/" + MODEL + "/predictions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          prompt: input.prompt,
          go_fast: true,
          num_outputs: 1,
          aspect_ratio: aspectRatio(input.ratio),
          output_format: "webp",
          output_quality: 90,
        },
      }),
    });

    if (!created.ok) {
      const body = await created.text();
      throw new Error("Replicate photo create failed " + created.status + ": " + body.slice(0, 500));
    }

    let prediction = (await created.json()) as Prediction;
    const deadline = Date.now() + 3 * 60 * 1000;

    while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
      if (Date.now() > deadline) throw new Error("Replicate photo generation timed out");
      await new Promise(resolve => setTimeout(resolve, 1500));

      const poll = await fetch(REPLICATE_API + "/predictions/" + prediction.id, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!poll.ok) {
        const body = await poll.text();
        throw new Error("Replicate photo poll failed " + poll.status + ": " + body.slice(0, 500));
      }
      prediction = (await poll.json()) as Prediction;
    }

    if (prediction.status !== "succeeded") {
      throw new Error("Replicate photo generation " + prediction.status + ": " + String(prediction.error ?? "unknown error"));
    }

    const url = outputUrl(prediction.output);
    if (!url) throw new Error("Replicate returned no image URL");

    const image = await fetch(url);
    if (!image.ok) throw new Error("Failed to download generated image: " + image.status);

    const buffer = new Uint8Array(await image.arrayBuffer());
    console.log("[replicate-photo] completed " + prediction.id + ": " + buffer.byteLength + " bytes");

    return {
      status: "completed",
      buffer,
      filename: "aivideotop.webp",
      mimeType: "image/webp",
      message: "Generated with FLUX Schnell",
    };
  }
}
