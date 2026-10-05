import type { VideoProvider, VideoRequest, GenerationResult } from "./types.js";

async function normalizePrompt(prompt: string): Promise<string> {
  if (!/[А-Яа-яЁё]/.test(prompt)) return prompt;
  const token = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_TOKEN?.trim();
  if (!token) return prompt;
  try {
    const response = await fetch("https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-ru-en", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: prompt.slice(0, 1800) }),
    });
    if (!response.ok) return prompt;
    const data = await response.json() as unknown;
    const translated = Array.isArray(data) && data[0] && typeof data[0] === "object"
      ? String((data[0] as Record<string, unknown>).translation_text ?? "")
      : "";
    if (!translated) return prompt;
    return "Cinematic photorealistic video. " + translated + ". Natural human motion, realistic physics, consistent identity, smooth camera movement, detailed environment, no text or watermark.";
  } catch {
    return prompt;
  }
}

const REPLICATE_API = "https://api.replicate.com/v1";
const TEXT_MODEL = "leonardoai/motion-2.0";
const REFERENCE_MODEL = "wan-video/wan-2.7-r2v";

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

    const hasImageReference = Boolean(input.imageBuffer?.byteLength || input.imageBuffers?.length);
    const hasVideoReference = Boolean(input.referenceVideoBuffer?.byteLength);
    const hasReference = hasImageReference || hasVideoReference;
    const prompt = await normalizePrompt(input.prompt);
    console.log("[prompt] " + (prompt === input.prompt ? "using original prompt" : "translated Russian prompt to English"));

    const MODEL = hasReference ? REFERENCE_MODEL : TEXT_MODEL;
    const refInput: Record<string, unknown> = {
      prompt,
      negative_prompt: "face distortion, identity change, extra limbs, deformed hands, duplicate person, flicker, warped body, blurry face, unstable background, text, watermark",
      resolution: "1080p",
      aspect_ratio: aspectRatio(input.ratio),
      duration: Math.min(10, Math.max(2, input.duration ?? 5)),
      shot_type: "single",
    };

    if (hasImageReference) {
      const refs = input.imageBuffers?.length
        ? input.imageBuffers.slice(0, 3)
        : input.imageBuffer
          ? [{ buffer: input.imageBuffer, mimeType: input.imageMimeType || "image/jpeg" }]
          : [];
      refInput.reference_images = refs.map(ref =>
        "data:" + ref.mimeType + ";base64," + Buffer.from(ref.buffer).toString("base64")
      );
    }
    if (hasVideoReference) {
      refInput.reference_videos = [
        "data:" + (input.referenceVideoMimeType || "video/mp4") + ";base64," + Buffer.from(input.referenceVideoBuffer!).toString("base64"),
      ];
    }

    const payload: Record<string, unknown> = hasReference
      ? { input: refInput }
      : {
          input: {
            prompt: input.prompt,
            aspect_ratio: aspectRatio(input.ratio),
            prompt_enhance: true,
            frame_interpolation: true,
            vibe_style: "None",
            lighting_style: "None",
            shot_type_style: "None",
            color_theme_style: "None",
          },
        };

    console.log("[replicate] starting " + MODEL + (hasReference ? " with reference media" : ""));
    const created = await fetch(REPLICATE_API + "/models/" + MODEL + "/predictions", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify(payload),
    });
    if (!created.ok) {
      const body = await created.text();
      throw new Error("Replicate create failed " + created.status + ": " + body.slice(0, 500));
    }

    let prediction = (await created.json()) as Prediction;
    console.log("[replicate] prediction " + prediction.id + ": " + prediction.status);
    const deadline = Date.now() + 10 * 60 * 1000;

    while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
      if (Date.now() > deadline) throw new Error("Replicate generation timed out");
      await new Promise(resolve => setTimeout(resolve, 3000));
      const poll = await fetch(REPLICATE_API + "/predictions/" + prediction.id, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!poll.ok) {
        const body = await poll.text();
        throw new Error("Replicate poll failed " + poll.status + ": " + body.slice(0, 500));
      }
      prediction = (await poll.json()) as Prediction;
      console.log("[replicate] " + prediction.id + ": " + prediction.status);
    }

    if (prediction.status !== "succeeded") {
      throw new Error("Replicate generation " + prediction.status + ": " + String(prediction.error ?? "unknown error"));
    }

    const url = outputUrl(prediction.output);
    if (!url) throw new Error("Replicate returned no video URL");

    const video = await fetch(url);
    if (!video.ok) throw new Error("Failed to download generated video: " + video.status);

    const buffer = new Uint8Array(await video.arrayBuffer());
    console.log("[replicate] completed " + prediction.id + ": " + buffer.byteLength + " bytes");
    return {
      status: "completed",
      buffer,
      filename: "aivideotop.mp4",
      mimeType: "video/mp4",
      message: hasReference
        ? "Generated with Wan 2.7 R2V"
        : "Generated with Replicate " + MODEL,
    };
  }
}
