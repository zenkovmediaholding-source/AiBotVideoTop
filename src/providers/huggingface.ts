import { Client, handle_file } from "@gradio/client";
import type { VideoProvider, VideoRequest, GenerationResult } from "./types.js";

type ApiParameter = {
  label?: string;
  parameter_name?: string;
  component?: string;
  type?: string;
  default?: unknown;
  example?: unknown;
  choices?: unknown[];
  value?: unknown;
};

type ApiInfo = {
  named_endpoints?: Record<string, { parameters?: ApiParameter[] }>;
};

const SPACE_ID = process.env.HF_SPACE_ID ?? "numanajmal0/wan-video-api";
const SAFE_MODEL = process.env.HF_MODEL?.trim();

function nameOf(p: ApiParameter) {
  return String(p.parameter_name ?? p.label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function pickChoice(p: ApiParameter) {
  const choices = Array.isArray(p.choices) ? p.choices.filter(x => typeof x === "string") as string[] : [];
  const safe = choices.find(x => !/nsfw|18\+|adult|porn/i.test(x));
  return SAFE_MODEL || safe || choices[0];
}

function dimensions(ratio = "9:16") {
  if (ratio === "16:9") return { width: 832, height: 480 };
  if (ratio === "1:1") return { width: 640, height: 640 };
  return { width: 480, height: 832 };
}

function frames(duration = 5) {
  return duration >= 8 ? 129 : 81;
}

function valueFor(p: ApiParameter, input: VideoRequest, imageRef?: unknown) {
  const n = nameOf(p);
  const d = dimensions(input.ratio);
  if (/model|checkpoint|ckpt/.test(n)) return pickChoice(p) ?? p.default ?? p.value;
  if (/negative.*prompt|negative_prompt/.test(n)) return "low quality, blurry, distorted, watermark, text";
  if (/prompt|description|text/.test(n)) return input.prompt;
  if (/image|reference|input.*video|init/.test(n) && imageRef !== undefined) return imageRef;
  if (/width/.test(n)) return d.width;
  if (/height/.test(n)) return d.height;
  if (/num.*frame|frames|frame.*count/.test(n)) return frames(input.duration);
  if (/duration|seconds|length/.test(n)) return input.duration;
  if (/fps|frame.*rate/.test(n)) return 16;
  if (/step/.test(n)) return 20;
  if (/guidance|cfg/.test(n)) return 5;
  if (/seed/.test(n)) return -1;
  if (/aspect|ratio/.test(n)) return input.ratio;
  return p.default ?? p.value ?? p.example ?? undefined;
}

function isFileLike(value: unknown): value is { url?: string; path?: string; name?: string; orig_name?: string; mime_type?: string } {
  return !!value && typeof value === "object" && (
    "url" in value || "path" in value || "name" in value || "orig_name" in value
  );
}

async function toBuffer(value: unknown): Promise<{ buffer: Uint8Array; filename: string; mimeType?: string } | null> {
  if (value instanceof Uint8Array) return { buffer: value, filename: "aivideotop.mp4", mimeType: "video/mp4" };
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    const r = await fetch(value);
    if (!r.ok) throw new Error(`Failed to fetch generated media: ${r.status}`);
    return { buffer: new Uint8Array(await r.arrayBuffer()), filename: "aivideotop.mp4", mimeType: r.headers.get("content-type") ?? "video/mp4" };
  }
  if (!isFileLike(value)) return null;
  const url = value.url ?? value.path;
  if (!url) return null;
  const absolute = /^https?:\/\//i.test(url) ? url : `https://${SPACE_ID.replace("/", "-")}.hf.space${url.startsWith("/") ? url : `/${url}`}`;
  const r = await fetch(absolute);
  if (!r.ok) throw new Error(`Failed to fetch generated media: ${r.status}`);
  return {
    buffer: new Uint8Array(await r.arrayBuffer()),
    filename: value.orig_name ?? value.name ?? "aivideotop.mp4",
    mimeType: value.mime_type ?? r.headers.get("content-type") ?? "video/mp4"
  };
}

async function findMedia(data: unknown): Promise<{ buffer: Uint8Array; filename: string; mimeType?: string } | null> {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = await findMedia(item);
      if (found) return found;
    }
    return null;
  }
  const direct = await toBuffer(data);
  if (direct) return direct;
  if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      const found = await findMedia(value);
      if (found) return found;
    }
  }
  return null;
}

export class HuggingFaceProvider implements VideoProvider {
  private clientPromise: ReturnType<typeof Client.connect>;

  constructor() {
    const token = process.env.HF_TOKEN?.trim();
    this.clientPromise = Client.connect(SPACE_ID, token ? { token } : undefined);
  }

  async generateVideo(input: VideoRequest): Promise<GenerationResult> {
    const client = await this.clientPromise;
    const info = await client.view_api() as ApiInfo;
    const endpoint = info.named_endpoints?.["/generate"];
    if (!endpoint?.parameters?.length) {
      throw new Error("Hugging Face Space /generate schema is unavailable");
    }

    let imageRef: unknown;
    if (input.imageBuffer) {
      imageRef = handle_file(Buffer.from(input.imageBuffer));
    }

    const values = endpoint.parameters.map(p => valueFor(p, input, imageRef));
    const result = await client.predict("/generate", values);
    const media = await findMedia(result.data);

    if (!media) {
      throw new Error("Hugging Face /generate returned no video file");
    }

    return {
      status: "completed",
      buffer: media.buffer,
      filename: media.filename,
      mimeType: media.mimeType,
      message: "Generated by Wan 2.1 on Hugging Face ZeroGPU"
    };
  }
}
