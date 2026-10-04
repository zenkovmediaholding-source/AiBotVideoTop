import "dotenv/config";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { DemoProvider } from "./providers/demo.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import { Database } from "./db.js";
import type { VideoProvider } from "./providers/types.js";

const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

const bot=new Bot(token);
const provider:VideoProvider=process.env.AI_PROVIDER==="comfyui"
 ? new ComfyUIProvider(process.env.COMFYUI_URL??"http://127.0.0.1:8188")
 : new DemoProvider();
const db=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?new Database():null;

const menu=()=>new InlineKeyboard()
.text("🎬 AI Видео","video").text("📸 AI Фото","photo").row()
.text("🧍 Видео со мной","reference").text("✨ Референс","reference").row()
.text("💳 Кредиты","credits").text("📁 История","history").row()
.text("⚙️ Настройки","settings");

async function ensureUser(ctx:Context){
 const u=ctx.from;
 if(!u)return null;
 if(!db)return null;
 return db.upsertUser(u.id,u.username,u.first_name);
}
async function home(ctx:Context){
 await ensureUser(ctx);
 await ctx.reply("⚡️ <b>AiVideoTop</b>\n\nAI-студия для создания фото и видео.\n\n🆓 Сейчас доступен бесплатный режим. Платные модели подключим позже.\n\nВыбери режим:",{parse_mode:"HTML",reply_markup:menu()});
}
bot.command("start",home);

bot.callbackQuery("video",async ctx=>{await ctx.answerCallbackQuery();await ensureUser(ctx);await ctx.reply("🎬 <b>AI Видео</b>\n\nНапиши описание сцены. Запрос будет сохранён в истории.\n\n<i>Например: роскошный автомобиль едет по ночному Дубаю, кинематографичная камера, реалистичный свет.</i>",{parse_mode:"HTML"});});
bot.callbackQuery("photo",async ctx=>{await ctx.answerCallbackQuery();await ensureUser(ctx);await ctx.reply("📸 <b>AI Фото</b>\n\nОпиши изображение. Фото-модели подключим отдельным provider'ом.",{parse_mode:"HTML"});});
bot.callbackQuery("reference",async ctx=>{await ctx.answerCallbackQuery();await ensureUser(ctx);await ctx.reply("🧍 <b>Видео со мной</b>\n\nПришли фото-референс, затем описание сцены. Будем использовать image-to-video workflow.",{parse_mode:"HTML"});});
bot.callbackQuery("credits",async ctx=>{await ctx.answerCallbackQuery();const u=await ensureUser(ctx);await ctx.reply(`💳 <b>Кредиты</b>\n\nБаланс: ${u?.credits??0} кредитов.\n\nПокупка кредитов появится после подключения оплаты.`,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("⬅️ Назад","home")});});
bot.callbackQuery("history",async ctx=>{await ctx.answerCallbackQuery();const u=await ensureUser(ctx);if(!u||!db){await ctx.reply("📁 История будет доступна после подключения базы.");return;}const rows=await db.listGenerations(u.id);if(!rows?.length){await ctx.reply("📁 <b>История</b>\n\nПока генераций нет.",{parse_mode:"HTML"});return;}const text=rows.map((x:any,i:number)=>`${i+1}. ${x.type} — ${x.status}\n${x.prompt?.slice(0,80)??""}`).join("\n\n");await ctx.reply("📁 <b>Последние генерации</b>\n\n"+text,{parse_mode:"HTML"});});
bot.callbackQuery("settings",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("⚙️ <b>Настройки</b>\n\nФормат: 9:16\nКачество: стандарт\nДлительность: 5 сек\n\nРасширенные модели появятся позже.",{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("⬅️ Назад","home")});});
bot.callbackQuery("home",async ctx=>{await ctx.answerCallbackQuery();await home(ctx);});

bot.on("message:text",async ctx=>{
 const prompt=ctx.message.text.trim();
 if(prompt.startsWith("/"))return;
 const u=await ensureUser(ctx);
 await ctx.reply("⏳ Запрос принят. Сохраняю его...");
 let generationId:string|undefined;
 try{
  if(db&&u){const g=await db.createGeneration(u.id,"video",prompt,process.env.AI_PROVIDER??"demo");generationId=g.id;}
  const result=await provider.generateVideo({prompt});
  if(db&&generationId&&result.status==="completed"){ /* result update comes with provider storage later */ }
  if(result.status==="unavailable"){await ctx.reply("🧩 "+result.message+"\n\nЗапрос уже сохранён. Как только подключим генератор, эту архитектуру можно будет использовать без переделки бота.");return;}
  if(result.url)await ctx.replyWithVideo(result.url);else await ctx.reply("✅ Задача принята.");
 }catch(error){console.error(error);await ctx.reply("❌ Не удалось обработать запрос. Он сохранён, если база доступна.");}
});

bot.catch(err=>console.error("Bot error:",err.error));
bot.start({onStart:info=>console.log(`AiVideoTop started as @${info.username}`)});
