import "dotenv/config";
import { Bot, InlineKeyboard, type Context } from "grammy";
import RunwayML from "@runwayml/sdk";

const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
const bot=new Bot(token);
const runway=process.env.RUNWAYML_API_SECRET ? new RunwayML({apiKey:process.env.RUNWAYML_API_SECRET}) : null;

const menu=()=>new InlineKeyboard()
.text("🎬 AI Видео","video").text("📸 AI Фото","photo").row()
.text("🧍 Видео со мной","reference").text("✨ Референс","reference").row()
.text("💳 Кредиты","credits").text("📁 История","history").row()
.text("⚙️ Настройки","settings");

async function home(ctx:Context){await ctx.reply("⚡️ <b>AiVideoTop</b>\n\nAI-студия для создания фото и видео.\n\nВыбери режим:",{parse_mode:"HTML",reply_markup:menu()});}
bot.command("start",home);

bot.callbackQuery("video",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("🎬 <b>AI Видео</b>\n\nНапиши описание сцены одним сообщением. Например:\n\n<i>Я иду по ночному Дубаю, камера плавно приближается, кинематографичный свет.</i>",{parse_mode:"HTML"});});
bot.callbackQuery("photo",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("📸 <b>AI Фото</b>\n\nМодуль фото подключим следующим этапом.",{parse_mode:"HTML"});});
bot.callbackQuery("reference",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("🧍 <b>Видео со мной</b>\n\nПришли фото-референс, затем опиши сцену. Будем использовать image-to-video, а не накладывать лицо поверх готового видео.",{parse_mode:"HTML"});});
for(const [key,text] of Object.entries({credits:"💳 <b>Кредиты</b>\n\nБаланс: 0 кредитов.",history:"📁 <b>История</b>\n\nПока генераций нет.",settings:"⚙️ <b>Настройки</b>\n\nСкоро здесь появятся модель, качество, формат и длительность."})){bot.callbackQuery(key,async ctx=>{await ctx.answerCallbackQuery();await ctx.reply(text,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("⬅️ Назад","home")});});}
bot.callbackQuery("home",async ctx=>{await ctx.answerCallbackQuery();await home(ctx);});

bot.on("message:text",async ctx=>{
 const prompt=ctx.message.text.trim();
 if(!runway){await ctx.reply("⚠️ Генерация пока не активирована. Нужно добавить RUNWAYML_API_SECRET в secrets сервера.");return;}
 await ctx.reply("⏳ Принял. Запускаю AI-генерацию...");
 try{
   const task=await runway.imageToVideo.create({
     model:process.env.DEFAULT_VIDEO_MODEL ?? "gen4.5",
     promptText:prompt,
     ratio:"720:1280",
     duration:5
   }).waitForTaskOutput();
   const raw=JSON.stringify(task);
   const urls=[...(raw.match(/https?:\\/\\/[^"\\s]+/g)??[])].map(u=>u.replace(/\\\\/g,""));
   const videoUrl=urls.find(u=>/\\.(mp4|webm)(\\?|$)/i.test(u));
   if(videoUrl) await ctx.replyWithVideo(videoUrl);
   else await ctx.reply("✅ Генерация завершена, но результат пока не удалось отправить автоматически. Очередь/хранилище подключим следующим этапом.");
 }catch(e){console.error(e);await ctx.reply("❌ Генерация не удалась. Проверь API key и параметры модели.");}
});

bot.catch(err=>console.error("Bot error:",err.error));
bot.start({onStart:info=>console.log(`AiVideoTop started as @${info.username}`)});
