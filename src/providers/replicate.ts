import Replicate from "replicate";
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
    return "Cinematic photorealistic video. " + translated + ". Natural human motion, realistic physics, consistent identity, smooth camera movement, detailed environment, no text, no captions, no watermark.";
  } catch {
    return prompt;
  }
}

type FileLike = { url?: () => string };

function getOutputUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = getOutputUrl(item);
      if (url) return url;
    }
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (typeof obj.url === "function") return (obj.url as () => string)();
    for (const key of ["url", "video", "output"]) {
      const url = getOutputUrl(obj[key]);
      if (url) return url;
    }
  }
  return undefined;
}

export class ReplicateProvider implements VideoProvider {
  async generateVideo(input: VideoRequest): Promise<GenerationResult> {
    const token = process.env.REPLICATE_API_TOKEN?.trim();
    if (!token) {
      return { status: "unavailable", message: "Replicate не настроен: добавь REPLICATE_API_TOKEN в Render." };
    }

    const hasImageReference = Boolean(input.imageBuffer?.byteLength || input.imageBuffers?.length);
    const hasVideoReference = Boolean(input.referenceVideoBuffer?.byteLength);

    if (hasImageReference && hasVideoReference) {
      return this.generateReferenceReplacement(input, token);
    }

    // Text/image-to-video fallback for ordinary generation.
    const replicate = new Replicate({ auth: token });
    const prompt = await normalizePrompt(input.prompt);
    const output = await replicate.run("prunaai/p-video", {
      input: {
        prompt,
        image: input.imageBuffer
          ? new File([Buffer.from(input.imageBuffer)], "reference.jpg", { type: input.imageMimeType || "image/jpeg" })
          : undefined,
        duration: Math.min(10, Math.max(2, input.duration ?? 5)),
        resolution: "720p",
        aspect_ratio: input.ratio === "16:9" ? "16:9" : input.ratio === "1:1" ? "1:1" : "9:16",
        save_audio: true,
      },
    });

    const url = getOutputUrl(output);
    if (!url) throw new Error("Replicate returned no video URL");
    const video = await fetch(url);
    if (!video.ok) throw new Error("Failed to download generated video: " + video.status);
    return {
      status: "completed",
      buffer: new Uint8Array(await video.arrayBuffer()),
      filename: "aivideotop.mp4",
      mimeType: "video/mp4",
      message: "Generated with Replicate p-video",
    };
  }

  private async generateReferenceReplacement(input: VideoRequest, token: string): Promise<GenerationResult> {
    const replicate = new Replicate({ auth: token });
    const refs = input.imageBuffers?.length
      ? input.imageBuffers.slice(0, 3)
      : input.imageBuffer
        ? [{ buffer: input.imageBuffer, mimeType: input.imageMimeType || "image/jpeg" }]
        : [];

    if (!refs.length || !input.referenceVideoBuffer) {
      throw new Error("Reference replacement requires both a source video and at least one identity photo.");
    }

    console.log("[replicate] starting prunaai/p-video-replace with source video + " + refs.length + " identity images");

    const output = await replicate.run("prunaai/p-video-replace", {
      input: {
        video: new File(
          [Buffer.from(input.referenceVideoBuffer)],
          "source.mp4",
          { type: input.referenceVideoMimeType || "video/mp4" }
        ),
        images: refs.map((ref, index) =>
          new File([Buffer.from(ref.buffer)], "identity-" + (index + 1) + ".jpg", {
            type: ref.mimeType || "image/jpeg",
          })
        ),
        resolution: input.quality === "perfect" ? "1080p" : "720p",
        target_fps: "original",
        save_audio: true,
        ignore_audio: false,
        turbo: false,
        instruction_prompt: "Replace the person in the source video with the person from the identity reference images. Preserve the original scene, camera movement, timing, body motion, clothing style, lighting and background as closely as possible. Keep the person's face and identity consistent throughout the entire clip. Do not add any text, captions, logos, subtitles or birthday message.",
      },
    });

    const url = getOutputUrl(output);
    if (!url) throw new Error("Replicate returned no replacement video URL");

    const video = await fetch(url);
    if (!video.ok) throw new Error("Failed to download replacement video: " + video.status);

    const buffer = new Uint8Array(await video.arrayBuffer());
    console.log("[replicate] replacement completed: " + buffer.byteLength + " bytes");

    return {
      status: "completed",
      buffer,
      filename: "aivideotop-replaced.mp4",
      mimeType: "video/mp4",
      message: "Generated with Replicate p-video-replace",
    };
  }
}
