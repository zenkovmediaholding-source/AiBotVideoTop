import "dotenv/config";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { DemoProvider } from "./providers/demo.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import type { VideoProvider } from "./providers/types.js";

const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
const bot=new Bot(token);
const provider:VideoProvider=process.env.AI_PROVIDER==="comfyui"?new ComfyUIProvider(process.env.COMFYUI_URL??"http://127.0.0.1:8188"):new DemoProvider();

const menu=()=>new InlineKeyboard()
.text("🎬 AI Видео","video").text("📸 AI Фото","photo").row()
.text("🧍 Видео со мной","reference").text("✨ Референс","reference").row()
.text("💳 Кредиты","credits").text("📁 История","history").row()
.text("⚙️ Настройки","settings");

async function home(ctx:Context){await ctx.reply("⚡️ <b>AiVideoTop</b>\n\nAI-студия для создания фото и видео.\n\nСейчас бот работает в бесплатном режиме. Платные генераторы подключим позже, когда появятся покупки.\n\nВыбери режим:",{parse_mode:"HTML",reply_markup:menu()});}
bot.command("start",home);
bot.callbackQuery("video",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("🎬 <b>AI Видео</b>\n\nНапиши описание сцены. Я сохраню запрос и подготовлю его к генерации.\n\n<i>Пример: роскошный автомобиль едет по ночному Дубаю, кинематографичная камера, реалистичный свет.</i>",{parse_mode:"HTML"});});
bot.callbackQuery("photo",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("📸 <b>AI Фото</b>\n\nМодуль фото подготовлен к подключению бесплатных/open-source моделей.",{parse_mode:"HTML"});});
bot.callbackQuery("reference",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("🧍 <b>Видео со мной</b>\n\nПришли фото-референс, затем описание сцены. Используем настоящий image-to-video workflow, а не простой face-overlay.",{parse_mode:"HTML"});});
for(const [key,text] of Object.entries({credits:"💳 <b>Кредиты</b>\n\nБаланс: 0 кредитов.\n\nПозже здесь появятся пакеты и оплата.",history:"📁 <b>История</b>\n\nИстория генераций будет храниться после подключения базы.",settings:"⚙️ <b>Настройки</b>\n\nМодель, формат, длительность и качество добавим сюда."})){bot.callbackQuery(key,async ctx=>{await ctx.answerCallbackQuery();await ctx.reply(text,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("⬅️ Назад","home")});});}
bot.callbackQuery("home",async ctx=>{await ctx.answerCallbackQuery();await home(ctx);});
bot.on("message:text",async ctx=>{const prompt=ctx.message.text.trim();if(prompt.startsWith("/"))return;await ctx.reply("⏳ Запрос принят. Проверяю доступный генератор...");const result=await provider.generateVideo({prompt});if(result.status==="unavailable"){await ctx.reply("🧩 "+result.message+"\n\nСам бот уже построен так, чтобы позже просто включить платный генератор.");return;}if(result.url)await ctx.replyWithVideo(result.url);else await ctx.reply("✅ Задача принята.");});
bot.catch(err=>console.error("Bot error:",err.error));
bot.start({onStart:info=>console.log(`AiVideoTop started as @${info.username}`)});
