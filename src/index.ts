import "dotenv/config";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, unlink } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { Bot, InlineKeyboard, InputFile, webhookCallback, type Context } from "grammy";
import { DemoProvider } from "./providers/demo.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import { HuggingFaceProvider } from "./providers/huggingface.js";
import { ReplicateProvider } from "./providers/replicate.js";
import { ReplicatePhotoProvider } from "./providers/replicate-photo.js";
import { Database } from "./db.js";
import type { VideoProvider } from "./providers/types.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

const bot = new Bot(token);

const provider: VideoProvider =
  process.env.AI_PROVIDER === "replicate" ? new ReplicateProvider() :
  process.env.AI_PROVIDER === "huggingface" ? new HuggingFaceProvider() :
  process.env.AI_PROVIDER === "comfyui" ? new ComfyUIProvider(process.env.COMFYUI_URL ?? "http://127.0.0.1:8188") :
  new DemoProvider();

const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? new Database() : null;
const photoProvider = new ReplicatePhotoProvider();

type Session = {
  mode: "video" | "photo" | "reference" | "reference_video";
  ratio: string;
  duration: number;
  prompt?: string;
  imageFileIds?: string[];
  referenceVideoFileId?: string;
  quality?: "test" | "perfect";
};

const sessions = new Map<number, Session>();

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const safeAnswer = async (ctx: Context) => {
  try {
    await ctx.answerCallbackQuery();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes("query is too old") && !message.includes("query ID is invalid")) {
      console.error("Callback answer error:", e);
    }
  }
};

const main = () => new InlineKeyboard()
  .text("🎬 AI Видео", "video")
  .text("📸 AI Фото", "photo")
  .row()
  .text("🧍 Видео со мной", "reference")
  .text("🔥 Видео-референс", "reference_video")
  .row()
  .text("💳 Кредиты", "credits")
  .text("📁 История", "history")
  .row()
  .text("⚙️ Настройки", "settings");

const back = () => new InlineKeyboard().text("⬅️ Назад", "home");

const videoFormats = () => new InlineKeyboard()
  .text("📱 9:16", "ratio_916")
  .text("🖥 16:9", "ratio_169")
  .row()
  .text("◼️ 1:1", "ratio_11")
  .row()
  .text("⬅️ Назад", "home");

const videoDuration = () => new InlineKeyboard()
  .text("⚡ 5 сек", "dur_5")
  .text("🔥 10 сек", "dur_10")
  .row()
  .text("⬅️ Назад", "home");

const qualityChoice = () => new InlineKeyboard()
  .text("🧪 Бесплатный тест • 3 сек", "generate_test")
  .row()
  .text("💎 Идеальное • 1080p", "generate_perfect")
  .row()
  .text("✏️ Изменить", "edit_prompt")
  .row()
  .text("⬅️ Назад", "home");

const confirmPhoto = () => new InlineKeyboard()
  .text("🪄 Создать фото", "generate_photo")
  .text("✏️ Изменить", "edit_photo")
  .row()
  .text("⬅️ Назад", "home");

async function ensureUser(ctx: Context) {
  const u = ctx.from;
  if (!u || !db) return null;
  return db.upsertUser(u.id, u.username, u.first_name);
}

async function downloadTelegramFile(fileId: string, fallbackMime: string) {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram file path is unavailable");
  const media = await fetch("https://api.telegram.org/file/bot" + token + "/" + file.file_path);
  if (!media.ok) throw new Error("Failed to download Telegram file: " + media.status);
  const buffer = new Uint8Array(await media.arrayBuffer());
  const lower = file.file_path.toLowerCase();
  const mimeType = lower.endsWith(".webm") ? "video/webm" : lower.endsWith(".mov") ? "video/quicktime" : fallbackMime;
  return { buffer, mimeType };
}

async function home(ctx: Context) {
  await ensureUser(ctx);
  await ctx.reply(
    "⚡️ <b>AiVideoTop</b>\n\n" +
    "AI-студия для фото и видео.\n\n" +
    "🎬 Видео • 📸 Фото • 🧍 Видео со мной • 🔥 Видео-референс",
    { parse_mode: "HTML", reply_markup: main() }
  );
}

bot.command("start", home);

bot.callbackQuery("video", async ctx => {
  await safeAnswer(ctx);
  if (ctx.from) sessions.set(ctx.from.id, { mode: "video", ratio: "9:16", duration: 5 });
  await ctx.reply("🎬 <b>AI Видео</b>\n\nВыбери формат:", {
    parse_mode: "HTML",
    reply_markup: videoFormats()
  });
});

bot.callbackQuery("photo", async ctx => {
  await safeAnswer(ctx);
  if (ctx.from) sessions.set(ctx.from.id, { mode: "photo", ratio: "1:1", duration: 1 });
  await ctx.reply("📸 <b>AI Фото</b>\n\nНапиши, какое изображение создать.", {
    parse_mode: "HTML",
    reply_markup: back()
  });
});

bot.callbackQuery("reference", async ctx => {
  await safeAnswer(ctx);
  if (ctx.from) sessions.set(ctx.from.id, { mode: "reference", ratio: "9:16", duration: 5 });
  await ctx.reply(
    "🧍 <b>Видео со мной</b>\n\n" +
    "1. Пришли чёткое фото человека.\n" +
    "2. Потом опиши сцену и движение.\n\n" +
    "💡 Лучше использовать портрет/полный рост без сильных фильтров.",
    { parse_mode: "HTML", reply_markup: back() }
  );
});

bot.callbackQuery("reference_video", async ctx => {
  await safeAnswer(ctx);
  if (ctx.from) sessions.set(ctx.from.id, {
    mode: "reference_video",
    ratio: "9:16",
    duration: 5
  });
  await ctx.reply(
    "🔥 <b>Видео-референс</b>\n\n" +
    "Пришли короткое видео-пример (лучше 2–10 сек).\n\n" +
    "После него пришли 1–3 своих фото. Бот заменит человека в исходном видео, сохранив сцену, движение, камеру и звук.\n\n" +
    "🧪 Сначала запускаем короткий бесплатный тест. Если результат тебя устраивает — используем идеальный режим 1080p.",
    { parse_mode: "HTML", reply_markup: back() }
  );
});

bot.callbackQuery(/ratio_(.+)/, async ctx => {
  await safeAnswer(ctx);
  const s = sessions.get(ctx.from.id);
  if (!s) return home(ctx);
  s.ratio = ctx.match[1] === "916" ? "9:16" : ctx.match[1] === "169" ? "16:9" : "1:1";
  sessions.set(ctx.from.id, s);
  await ctx.reply("⏱ Теперь выбери длительность:", { reply_markup: videoDuration() });
});

bot.callbackQuery(/dur_(.+)/, async ctx => {
  await safeAnswer(ctx);
  const s = sessions.get(ctx.from.id);
  if (!s) return home(ctx);
  s.duration = Math.min(10, Math.max(2, Number(ctx.match[1]) || 5));
  sessions.set(ctx.from.id, s);
  await ctx.reply("✍️ Теперь напиши, что должно происходить в видео.", { reply_markup: back() });
});

bot.on("message:photo", async ctx => {
  const s = sessions.get(ctx.from.id);
  if (!s) {
    await ctx.reply("Сначала выбери режим генерации.");
    return;
  }

  if (s.mode === "reference" || s.mode === "reference_video") {
    const photo = ctx.message.photo.at(-1);
    if (photo) {
      s.imageFileIds = [...(s.imageFileIds ?? []), photo.file_id].slice(0, 3);
      sessions.set(ctx.from.id, s);
      const count = s.imageFileIds.length;
      await ctx.reply(
        s.mode === "reference_video"
          ? `✅ Фото ${count}/3 добавлено. Пришли ещё фото или напиши описание сцены и движения.`
          : `✅ Фото ${count}/3 получено. Пришли ещё фото или напиши сцену для видео.`,
        { reply_markup: back() }
      );
    }
    return;
  }

  await ctx.reply("Фото принимается только в режимах «🧍 Видео со мной» и «🔥 Видео-референс».");
});

bot.on("message:video", async ctx => {
  const s = sessions.get(ctx.from.id);
  if (!s || s.mode !== "reference_video") {
    await ctx.reply("Сначала выбери «🔥 Видео-референс».");
    return;
  }

  s.referenceVideoFileId = ctx.message.video.file_id;
  sessions.set(ctx.from.id, s);
  await ctx.reply(
    "🎞 <b>Видео получено.</b>\n\n" +
    "Если хочешь сохранить внешность конкретного человека — теперь пришли его фото.\n" +
    "Если фото не нужно, просто напиши промпт.",
    { parse_mode: "HTML", reply_markup: back() }
  );
});

bot.on("message:text", async ctx => {
  const prompt = ctx.message.text.trim();
  if (prompt.startsWith("/")) return;

  const s = sessions.get(ctx.from.id);
  if (!s) {
    await home(ctx);
    return;
  }

  if (s.mode === "reference_video" && !s.referenceVideoFileId) {
    await ctx.reply("Сначала пришли видео-пример для режима «🔥 Видео-референс».");
    return;
  }

  s.prompt = prompt;
  sessions.set(ctx.from.id, s);

  if (s.mode === "photo") {
    await ctx.reply(
      "📝 <b>Проверь заказ</b>\n\n" +
      "<b>Режим:</b> AI Фото\n" +
      "<b>Формат:</b> " + s.ratio + "\n\n" +
      "<b>Промпт:</b> " + escapeHtml(prompt.slice(0, 700)),
      { parse_mode: "HTML", reply_markup: confirmPhoto() }
    );
    return;
  }

  const mode =
    s.mode === "video" ? "AI Видео" :
    s.mode === "reference" ? "Видео со мной" :
    "🔥 Видео-референс";

  await ctx.reply(
    "📝 <b>Проверь заказ</b>\n\n" +
    "<b>Режим:</b> " + mode + "\n" +
    "<b>Формат:</b> " + s.ratio + "\n" +
    "<b>Длительность:</b> " + s.duration + " сек\n" +
    (s.imageFileIds?.length ? "<b>Фото:</b> " + s.imageFileIds.length + " шт.\n" : "") +
    (s.referenceVideoFileId ? "<b>Видео-референс:</b> добавлено\n" : "") +
    "\n<b>Промпт:</b> " + escapeHtml(prompt.slice(0, 700)) + "\n\n" +
    (s.mode === "reference_video"
      ? "\n💡 <b>Сначала выбери бесплатный тест.</b> Он реально прогоняет замену человека через ту же модель, но только первые 3 секунды.\n\nПосле проверки можно запускать <b>1080p</b>."
      : ""),
    { parse_mode: "HTML", reply_markup: qualityChoice() }
  );
});

bot.callbackQuery("edit_prompt", async ctx => {
  await safeAnswer(ctx);
  await ctx.reply("✏️ Напиши новый промпт:", { reply_markup: back() });
});

bot.callbackQuery("edit_photo", async ctx => {
  await safeAnswer(ctx);
  await ctx.reply("✏️ Напиши новый промпт для фото:", { reply_markup: back() });
});

async function trimVideoForTest(input: Uint8Array, seconds: number): Promise<Uint8Array> {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable on Render");
  const id = randomUUID();
  const inputPath = `/tmp/aivideotop-${id}-in.mp4`;
  const outputPath = `/tmp/aivideotop-${id}-out.mp4`;
  await writeFile(inputPath, input);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        "-y", "-i", inputPath, "-t", String(seconds),
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-movflags", "+faststart", outputPath
      ]);
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", code => code === 0 ? resolve() : reject(new Error("FFmpeg trim failed: " + stderr.slice(-1200))));
    });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}

async function runVideoGeneration(ctx: Context, s: Session, quality: "test" | "perfect") {
  if (!s.prompt) {
    await ctx.reply("Сначала нужен промпт.");
    return;
  }

  const u = await ensureUser(ctx);
  if (quality === "test" && u && db) {
    const alreadyUsed = await db.hasFreeReferenceTest(u.id);
    if (alreadyUsed) {
      await ctx.reply("🧪 Бесплатный тест уже использован. Для следующего запуска нужен режим 💎 Идеальное качество.");
      return;
    }
  }
  const prompt = s.prompt;
  const userId = ctx.from!.id;
  const isReference = s.mode === "reference_video";
  const label = quality === "test" ? "🧪 бесплатный тест • 3 сек • 720p" : "💎 идеальное качество • 1080p";
  await ctx.reply(
    "⏳ <b>Запускаю " + label + "...</b>\n\n" +
    (isReference ? "Замена человека по твоим фото.\n" : "AI-видео.\n") +
    "Это может занять несколько минут.",
    { parse_mode: "HTML" }
  );

  void (async () => {
    try {
      if (db && u) {
        await db.createGeneration(u.id, "video", prompt, quality === "test" ? "replicate:test" : "replicate:perfect");
      }

      const imageBuffers: Array<{buffer: Uint8Array; mimeType: string}> = [];
      for (const fileId of (s.imageFileIds ?? []).slice(0, 3)) {
        const media = await downloadTelegramFile(fileId, "image/jpeg");
        imageBuffers.push({ buffer: media.buffer, mimeType: media.mimeType });
      }

      let imageBuffer: Uint8Array | undefined;
      let imageMimeType: string | undefined;
      if (imageBuffers[0]) {
        imageBuffer = imageBuffers[0].buffer;
        imageMimeType = imageBuffers[0].mimeType;
      }

      let referenceVideoBuffer: Uint8Array | undefined;
      let referenceVideoMimeType: string | undefined;
      if (s.referenceVideoFileId) {
        const media = await downloadTelegramFile(s.referenceVideoFileId, "video/mp4");
        referenceVideoBuffer = media.buffer;
        referenceVideoMimeType = media.mimeType;
      }

      if (isReference && referenceVideoBuffer && quality === "test") {
        referenceVideoBuffer = await trimVideoForTest(referenceVideoBuffer, 3);
        console.log("[test] source video trimmed to 3 seconds");
      }

      const result = await provider.generateVideo({
        prompt,
        ratio: s.ratio,
        duration: quality === "test" ? 3 : s.duration,
        imageBuffer,
        imageMimeType,
        imageBuffers,
        referenceVideoBuffer,
        referenceVideoMimeType,
        quality,
      });

      if (result.buffer) {
        await ctx.replyWithVideo(new InputFile(result.buffer, result.filename ?? "aivideotop.mp4"));
      } else if (result.url) {
        await ctx.replyWithVideo(result.url);
      } else {
        await ctx.reply("❌ Генератор сейчас недоступен.");
      }
    } catch (e) {
      console.error("[generate] error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(
        "❌ <b>Генерация не удалась.</b>\n\n" +
        escapeHtml(msg.slice(0, 500)),
        { parse_mode: "HTML" }
      );
    } finally {
      sessions.delete(userId);
    }
  })();
}

bot.callbackQuery("generate_test", async ctx => {
  await safeAnswer(ctx);
  const s = sessions.get(ctx.from.id);
  if (!s || s.mode !== "reference_video") {
    await ctx.reply("Сначала выбери «🔥 Видео-референс».");
    return;
  }
  await runVideoGeneration(ctx, s, "test");
});

bot.callbackQuery("generate_perfect", async ctx => {
  await safeAnswer(ctx);
  const s = sessions.get(ctx.from.id);
  if (!s || s.mode !== "reference_video") {
    await ctx.reply("Сначала выбери «🔥 Видео-референс».");
    return;
  }
  // Payment is intentionally not enforced yet: first we verify the full 1080p pipeline end-to-end.
  await runVideoGeneration(ctx, s, "perfect");
});

bot.callbackQuery("generate_photo", async ctx => {
  await safeAnswer(ctx);
  const s = sessions.get(ctx.from.id);
  if (!s?.prompt || s.mode !== "photo") {
    await ctx.reply("Сначала создай промпт для фото.");
    return;
  }

  const u = await ensureUser(ctx);
  if (quality === "test" && u && db) {
    const alreadyUsed = await db.hasFreeReferenceTest(u.id);
    if (alreadyUsed) {
      await ctx.reply("🧪 Бесплатный тест уже использован. Для следующего запуска нужен режим 💎 Идеальное качество.");
      return;
    }
  }
  const prompt = s.prompt;
  await ctx.reply("⏳ <b>Создаю фото...</b>", { parse_mode: "HTML" });

  void (async () => {
    try {
      if (db && u) {
        await db.createGeneration(u.id, "photo", prompt, "replicate");
      }

      const result = await photoProvider.generatePhoto({
        prompt,
        ratio: s.ratio
      });

      if (result.buffer) {
        await ctx.replyWithPhoto(new InputFile(result.buffer, result.filename ?? "aivideotop.webp"));
      } else if (result.url) {
        await ctx.replyWithPhoto(result.url);
      } else {
        await ctx.reply("❌ Генератор фото сейчас недоступен.");
      }
    } catch (e) {
      console.error("[generate_photo] error:", e);
      await ctx.reply("❌ Не удалось создать фото. Попробуй другой промпт.");
    } finally {
      sessions.delete(ctx.from.id);
    }
  })();
});

bot.callbackQuery("credits", async ctx => {
  await safeAnswer(ctx);
  const u = await ensureUser(ctx);
  await ctx.reply(
    "💳 <b>Кредиты</b>\n\n" +
    "Баланс: " + (u?.credits ?? 0) + "\n\n" +
    "Система оплаты подключается следующим этапом.",
    { parse_mode: "HTML", reply_markup: back() }
  );
});

bot.callbackQuery("history", async ctx => {
  await safeAnswer(ctx);
  const u = await ensureUser(ctx);
  if (!u || !db) {
    await ctx.reply("📁 История временно недоступна.");
    return;
  }

  const rows = await db.listGenerations(u.id);
  if (!rows.length) {
    await ctx.reply("📁 <b>История пуста</b>", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(
    "📁 <b>Последние генерации</b>\n\n" +
    rows.map((x: any, i: number) =>
      (i + 1) + ". " + x.type + " • " + x.status + "\n" +
      escapeHtml(x.prompt?.slice(0, 100) ?? "")
    ).join("\n\n"),
    { parse_mode: "HTML", reply_markup: back() }
  );
});

bot.callbackQuery("settings", async ctx => {
  await safeAnswer(ctx);
  await ctx.reply(
    "⚙️ <b>Настройки</b>\n\n" +
    "Видео: 9:16 / 16:9 / 1:1\n" +
    "Длительность: 5 / 10 сек\n" +
    "Reference: P-Video-Replace • 720p тест / 1080p финал\n\n" +
    "💡 Для Reels/TikTok лучше 9:16.",
    { parse_mode: "HTML", reply_markup: back() }
  );
});

bot.callbackQuery("home", async ctx => {
  await safeAnswer(ctx);
  await home(ctx);
});

bot.catch(err => console.error("Bot error:", err.error));

const port = Number(process.env.PORT ?? 3000);
const botMode = process.env.BOT_MODE ?? "polling";
const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "");
const webhookPath = "/telegram/webhook";
const handleWebhook = webhookCallback(bot, "http", { timeoutMilliseconds: 9000 });

const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("AiVideoTop OK");
    return;
  }

  if (botMode === "webhook" && req.method === "POST" && req.url === webhookPath) {
    await handleWebhook(req, res);
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("AiVideoTop");
});

server.listen(port, "0.0.0.0", async () => {
  console.log("AiVideoTop health server listening on " + port);

  if (botMode === "webhook") {
    if (!publicUrl) throw new Error("PUBLIC_URL is required in webhook mode");
    await bot.api.setWebhook(publicUrl + webhookPath);
    console.log("AiVideoTop webhook enabled at " + publicUrl + webhookPath);
  } else {
    await bot.start({ onStart: info => console.log("AiVideoTop started as @" + info.username) });
  }
});
