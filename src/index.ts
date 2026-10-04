import "dotenv/config";
import { Bot, InlineKeyboard, type Context } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

const bot = new Bot(token);

const menu = () => new InlineKeyboard()
  .text("🎬 AI Видео","video").text("📸 AI Фото","photo").row()
  .text("🧍 Видео со мной","reference").text("✨ Референс","reference").row()
  .text("💳 Кредиты","credits").text("📁 История","history").row()
  .text("⚙️ Настройки","settings");

async function home(ctx: Context) {
  await ctx.reply(
    "⚡️ <b>AiVideoTop</b>\n\nТвоя AI-студия для создания фото и видео.\n\nВыбери, что хочешь создать:",
    {parse_mode:"HTML",reply_markup:menu()}
  );
}

bot.command("start", home);

const pages: Record<string,string> = {
  video: "🎬 <b>AI Видео</b>\n\nОпиши сцену, которую хочешь получить. Здесь будет подключена генерация через AI-модель.",
  photo: "📸 <b>AI Фото</b>\n\nПришли описание изображения или референс. Здесь будет подключена генерация.",
  reference: "🧍 <b>Видео со мной</b>\n\nПришли фотографию человека как референс. Используем reference/image-to-video workflow, а не простой face-overlay.",
  credits: "💳 <b>Кредиты</b>\n\nБаланс: 0 кредитов\n\nСистема кредитов подготовлена.",
  history: "📁 <b>История</b>\n\nПока генераций нет.",
  settings: "⚙️ <b>Настройки</b>\n\nЗдесь появятся модель, качество, формат и длительность."
};

for (const [key, text] of Object.entries(pages)) {
  bot.callbackQuery(key, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(text, {parse_mode:"HTML",reply_markup:new InlineKeyboard().text("⬅️ Назад","home")});
  });
}

bot.callbackQuery("home", async (ctx) => { await ctx.answerCallbackQuery(); await home(ctx); });
bot.catch((err) => console.error("Bot error:", err.error));
bot.start({onStart: (info) => console.log(`AiVideoTop started as @${info.username}`)});
