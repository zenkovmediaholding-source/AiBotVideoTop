import type { VideoProvider, VideoRequest, GenerationResult } from "./types.js";

const REPLICATE_API = "https://api.replicate.com/v1";
const TEXT_MODEL = "wan-video/wan-2.1-1.3b";
const IMAGE_MODEL = "wavespeedai/wan-2.1-i2v-480p";

type Prediction = { id: string; status: string; output?: unknown; error?: unknown };

function aspectRatio(ratio?: string): string {
  if (ratio === "16:9" || ratio === "1:1") return ratio;
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

    const hasImage = Boolean(input.imageBuffer?.byteLength);
    const model = hasImage ? IMAGE_MODEL : TEXT_MODEL;
    const payload: Record<string, unknown> = { input: { prompt: input.prompt } };
    const videoInput = payload.input as Record<string, unknown>;
    if (hasImage) {
      videoInput.image = "data:image/jpeg;base64," + Buffer.from(input.imageBuffer!).toString("base64");
    } else {
      videoInput.frame_num = Math.min(81, Math.max(49, Math.round((input.duration ?? 5) * 16)));
      videoInput.resolution = "480p";
      videoInput.aspect_ratio = aspectRatio(input.ratio);
      videoInput.sample_steps = 30;
      videoInput.sample_guide_scale = 6;
    }

    console.log("[replicate] starting " + model);
    const created = await fetch(REPLICATE_API + "/models/" + model + "/predictions", {
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
    return { status: "completed", buffer, filename: "aivideotop.mp4", mimeType: "video/mp4", message: "Generated with Replicate " + model };
  }
}