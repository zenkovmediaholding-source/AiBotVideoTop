import { Client } from "@gradio/client";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoProvider, VideoRequest, GenerationResult } from "./types.js";
const SPACE_ID = "multimodalart/self-forcing";
type ApiInfo = {
  named_endpoints?: Record<string, { parameters?: unknown[] }>;
};

function isFileLike(value: unknown): value is {
  url?: string;
  path?: string;
  name?: string;
  orig_name?: string;
  mime_type?: string;
} {
  return !!value && typeof value === "object" && (
    "url" in value || "path" in value || "name" in value || "orig_name" in value
  );
}

function absoluteFileUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${SPACE_ID.replace("/", "-")}.hf.space${url.startsWith("/") ? url : `/${url}`}`;
}

async function toBuffer(value: unknown): Promise<{ buffer: Uint8Array; filename: string; mimeType?: string } | null> {
  if (value instanceof Uint8Array) {
    return { buffer: value, filename: "aivideotop.mp4", mimeType: "video/mp4" };
  }

  if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/"))) {
    const r = await fetch(absoluteFileUrl(value));
    if (!r.ok) throw new Error(`Failed to fetch generated media: ${r.status}`);
    return {
      buffer: new Uint8Array(await r.arrayBuffer()),
      filename: value.endsWith(".mp4") ? "aivideotop.mp4" : "aivideotop.bin",
      mimeType: r.headers.get("content-type") ?? (value.endsWith(".mp4") ? "video/mp4" : undefined)
    };
  }

  if (!isFileLike(value)) return null;
  const url = value.url ?? value.path;
  if (!url) return null;

  const r = await fetch(absoluteFileUrl(url));
  if (!r.ok) throw new Error(`Failed to fetch generated media: ${r.status}`);

  return {
    buffer: new Uint8Array(await r.arrayBuffer()),
    filename: value.orig_name ?? value.name ?? "aivideotop.mp4",
    mimeType: value.mime_type ?? r.headers.get("content-type") ?? "video/mp4"
  };
}

async function extractMedia(data: unknown): Promise<{ buffer: Uint8Array; filename: string; mimeType?: string }[]> {
  const result: { buffer: Uint8Array; filename: string; mimeType?: string }[] = [];
  if (Array.isArray(data)) {
    for (const item of data) result.push(...await extractMedia(item));
    return result;
  }

  const direct = await toBuffer(data);
  if (direct) return [direct];

  if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      result.push(...await extractMedia(value));
    }
  }
  return result;
}

export class HuggingFaceProvider implements VideoProvider {
  private clientPromise: ReturnType<typeof Client.connect>;

  constructor() {
    const token = process.env.HF_TOKEN?.trim();
    this.clientPromise = Client.connect(SPACE_ID, token ? { token } : undefined);
  }

  async diagnose() {
    const client = await this.clientPromise;
    const info = await client.view_api() as ApiInfo;
    return Object.entries(info.named_endpoints ?? {}).map(([name, endpoint]) => ({
      name,
      parameters: endpoint.parameters?.length ?? 0
    }));
  }

  async generateVideo(input: VideoRequest): Promise<GenerationResult> {
    const client = await this.clientPromise;
    const endpoint = "/video_generation_handler_streaming";
    console.log(`[hf] generating streaming video ${SPACE_ID}${endpoint}`);

    const job = client.submit(endpoint, [input.prompt, -1, 15]);
    const chunks: Uint8Array[] = [];
    let chunkCount = 0;

    for await (const update of job) {
      const data = (update as { data?: unknown })?.data ?? update;
      const files = await extractMedia(data);
      for (const file of files) {
        const name = file.filename.toLowerCase();
        if (name.endsWith(".ts") || file.mimeType?.toLowerCase().includes("mpeg")) {
          chunkCount++;
          chunks.push(file.buffer);
          console.log(`[hf] received TS chunk ${chunkCount}: ${file.filename} (${file.buffer.byteLength} bytes)`);
        }
      }
    }

    if (!chunks.length) throw new Error("Hugging Face Self-Forcing returned no video chunks");

    const combined = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    console.log(`[hf] assembled ${chunkCount} TS chunks (${combined.byteLength} bytes)`);

    if (!ffmpegPath) throw new Error("ffmpeg is unavailable");
    const base = join(tmpdir(), `aivideotop-${Date.now()}`);
    const inputPath = `${base}.ts`;
    const outputPath = `${base}.mp4`;

    try {
      await fs.writeFile(inputPath, combined);
      await new Promise<void>((resolve, reject) => {
        execFile(String(ffmpegPath), ["-y", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", outputPath], (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            console.error("[hf] ffmpeg error:", stderr);
            reject(error);
          } else resolve();
        });
      });
      const mp4 = new Uint8Array(await fs.readFile(outputPath));
      console.log(`[hf] converted MP4: ${mp4.byteLength} bytes`);
      return {
        status: "completed",
        buffer: mp4,
        filename: "aivideotop.mp4",
        mimeType: "video/mp4",
        message: "Generated by Wan 2.1 Self-Forcing on Hugging Face ZeroGPU"
      };
    } finally {
      await fs.rm(inputPath, { force: true }).catch(() => {});
      await fs.rm(outputPath, { force: true }).catch(() => {});
    }
  }

}