import { Client } from "@gradio/client";
import ffmpegPathModule from "ffmpeg-static";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { VideoProvider, VideoRequest, GenerationResult } from "./types.js";

const SPACE_ID = "multimodalart/self-forcing";
const ENDPOINT = process.env.HF_ENDPOINT?.trim() || "/video_generation_handler_streaming";

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
      filename: value.endsWith(".ts") ? "chunk.ts" : "aivideotop.mp4",
      mimeType: r.headers.get("content-type") ?? (value.endsWith(".ts") ? "video/mp2t" : "video/mp4")
    };
  }

  if (!isFileLike(value)) return null;
  const url = value.url ?? value.path;
  if (!url) return null;

  const r = await fetch(absoluteFileUrl(url));
  if (!r.ok) throw new Error(`Failed to fetch generated media: ${r.status}`);

  return {
    buffer: new Uint8Array(await r.arrayBuffer()),
    filename: value.orig_name ?? value.name ?? (url.endsWith(".ts") ? "chunk.ts" : "aivideotop.mp4"),
    mimeType: value.mime_type ?? r.headers.get("content-type") ?? (url.endsWith(".ts") ? "video/mp2t" : "video/mp4")
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

const ffmpegPath = ffmpegPathModule as unknown as string | null;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary is unavailable"));
      return;
    }
    const child = spawn(ffmpegPath, args, { stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1500)}`));
    });
  });
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
    const job = client.submit(ENDPOINT, [input.prompt, -1, 15]);
    const chunks: Uint8Array[] = [];
    const seen = new Set<string>();

    console.log(`[hf] streaming ${SPACE_ID}${ENDPOINT}`);

    for await (const message of job) {
      if (message.type === "status") {
        const status = message as { stage?: string; message?: string };
        console.log(`[hf] status: ${status.stage ?? "unknown"} ${status.message ?? ""}`);
        if (status.stage === "error") {
          throw new Error(status.message || "Hugging Face generator returned an error");
        }
        continue;
      }

      if (message.type === "data") {
        const media = await extractMedia(message.data);
        for (const item of media) {
          const key = `${item.filename}:${item.buffer.byteLength}:${item.buffer[0] ?? 0}`;
          if (!seen.has(key)) {
            seen.add(key);
            chunks.push(item.buffer);
            console.log(`[hf] received chunk ${chunks.length}: ${item.filename} (${item.buffer.byteLength} bytes)`);
          }
        }
      }
    }

    if (!chunks.length) {
      throw new Error("Hugging Face Self-Forcing returned no video chunks");
    }

    const workDir = await mkdtemp(join(tmpdir(), "aivideotop-"));
    try {
      const tsPath = join(workDir, "input.ts");
      const mp4Path = join(workDir, "output.mp4");
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      await writeFile(tsPath, combined);
      await runFfmpeg(["-y", "-i", tsPath, "-c", "copy", "-movflags", "+faststart", mp4Path]);
      const buffer = new Uint8Array(await readFile(mp4Path));

      return {
        status: "completed",
        buffer,
        filename: "aivideotop.mp4",
        mimeType: "video/mp4",
        message: "Generated by Wan 2.1 Self-Forcing on Hugging Face ZeroGPU"
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
