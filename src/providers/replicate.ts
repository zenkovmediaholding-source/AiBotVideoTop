import type { VideoProvider, VideoRequest, GenerationResult } from "./types.js";

const REPLICATE_API = "https://api.replicate.com/v1";
const MODEL = "leonardoai/motion-2.0";

type Prediction = { id: string; status: string; output?: unknown; error?: unknown };

function aspectRatio(ratio?: string): string {
  if (ratio === "16:9") return "16:9";
  if (ratio === "1:1") return "4:5";
  return "9:16";
}

function outputUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) { for (const item of output) { const url = outputUrl(item); if (url) return url; } }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["url", "video", "output"]) { const url = outputUrl(obj[key]); if (url) return url; }
  }
  return undefined;
}

export class ReplicateProvider implements VideoProvider {
  async generateVideo(input: VideoRequest): Promise<GenerationResult> {
    const token = process.env.REPLICATE_API_TOKEN?.trim();
    if (!token) return { status: "unavailable", message: "Replicate не настроен: добавь REPLICATE_API_TOKEN в Render." };

    const payload: Record<string, unknown> = { input: {\n      prompt: input.prompt,\n      aspect_ratio: aspectRatio(input.ratio),\n      prompt_enhance: true,\n      frame_interpolation: true,\n      vibe_style: "None",\n      lighting_style: "None",\n      shot_type_style: "None",\n      color_theme_style: "None",\n    } };\n    const videoInput = payload.input as Record<string, unknown>;\n    if (input.imageBuffer?.byteLength) {\n      videoInput.image = "data:image/jpeg;base64," + Buffer.from(input.imageBuffer).toString("base64");\n    }

    console.log("[replicate] starting " + MODEL);
    const created = await fetch(REPLICATE_API + "/models/" + MODEL + "/predictions", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify(payload),
    });
    if (!created.ok) { const body = await created.text(); throw new Error("Replicate create failed " + created.status + ": " + body.slice(0, 500)); }

    let prediction = (await created.json()) as Prediction;
    console.log("[replicate] prediction " + prediction.id + ": " + prediction.status);
    const deadline = Date.now() + 6 * 60 * 1000;
    while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
      if (Date.now() > deadline) throw new Error("Replicate generation timed out");
      await new Promise(resolve => setTimeout(resolve, 3000));
      const poll = await fetch(REPLICATE_API + "/predictions/" + prediction.id, { headers: { Authorization: "Bearer " + token } });
      if (!poll.ok) { const body = await poll.text(); throw new Error("Replicate poll failed " + poll.status + ": " + body.slice(0, 500)); }
      prediction = (await poll.json()) as Prediction;
      console.log("[replicate] " + prediction.id + ": " + prediction.status);
    }
    if (prediction.status !== "succeeded") throw new Error("Replicate generation " + prediction.status + ": " + String(prediction.error ?? "unknown error"));

    const url = outputUrl(prediction.output);
    if (!url) throw new Error("Replicate returned no video URL");
    const video = await fetch(url);
    if (!video.ok) throw new Error("Failed to download generated video: " + video.status);
    const buffer = new Uint8Array(await video.arrayBuffer());
    console.log("[replicate] completed " + prediction.id + ": " + buffer.byteLength + " bytes");
    return { status: "completed", buffer, filename: "aivideotop.mp4", mimeType: "video/mp4", message: "Generated with Replicate " + MODEL + " ($0.30/video)" };
  }
}