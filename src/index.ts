import "dotenv/config";
import { createServer } from "node:http";
import { Bot, InlineKeyboard, InputFile, webhookCallback, type Context } from "grammy";
import { DemoProvider } from "./providers/demo.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import { HuggingFaceProvider } from "./providers/huggingface.js";
import { Database } from "./db.js";
import type { VideoProvider } from "./providers/types.js";

const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
const bot=new Bot(token);

const provider:VideoProvider=
 process.env.AI_PROVIDER==="huggingface" ? new HuggingFaceProvider() :
 process.env.AI_PROVIDER==="comfyui" ? new ComfyUIProvider(process.env.COMFYUI_URL??"http://127.0.0.1:8188") :
 new DemoProvider();

const db=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?new Database():null;
type Session={mode:"video"|"photo"|"reference";ratio:string;duration:number;prompt?:string;imageFileId?:string};
const sessions=new Map<number,Session>();
const escapeHtml=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const main=()=>new InlineKeyboard().text("🎬 AI Видео","video").text("📸 AI Фото","photo").row().text("🧍 Видео со мной","reference").text("✨ Референс","reference").row().text("💳 Кредиты","credits").text("📁 История","history").row().text("⚙️ Настройки","settings");
const back=()=>new InlineKeyboard().text("⬅️ Назад","home");
const videoFormats=()=>new InlineKeyboard().text("📱 9:16","ratio_916").text("🖥 16:9","ratio_169").row().text("◼️ 1:1","ratio_11").row().text("⬅️ Назад","home");
const videoDuration=()=>new InlineKeyboard().text("5 сек","dur_5").text("8 сек","dur_8").row().text("⬅️ Назад","home");
const confirm=()=>new InlineKeyboard().text("🚀 Создать","generate").text("✏️ Изменить","edit_prompt").row().text("⬅️ Назад","home");

async function ensureUser(ctx:Context){const u=ctx.from;if(!u||!db)return null;return db.upsertUser(u.id,u.username,u.first_name);}
async function home(ctx:Context){await ensureUser(ctx);await ctx.reply("⚡️ <b>AiVideoTop</b>

Твоя AI-студия для фото и видео.

Выбери, что создать:",{parse_mode:"HTML",reply_markup:main()});}
bot.command("start",home);

bot.callbackQuery("video",async ctx=>{await ctx.answerCallbackQuery();if(ctx.from)sessions.set(ctx.from.id,{mode:"video",ratio:"9:16",duration:5});await ctx.reply("🎬 <b>AI Видео</b>

Выбери формат:",{parse_mode:"HTML",reply_markup:videoFormats()});});
bot.callbackQuery("photo",async ctx=>{await ctx.answerCallbackQuery();if(ctx.from)sessions.set(ctx.from.id,{mode:"photo",ratio:"1:1",duration:1});await ctx.reply("📸 <b>AI Фото</b>

Фотогенератор будет подключён следующим отдельным бесплатным модулем. Пока можно сразу использовать AI Видео.",{parse_mode:"HTML",reply_markup:back()});});
bot.callbackQuery("reference",async ctx=>{await ctx.answerCallbackQuery();if(ctx.from)sessions.set(ctx.from.id,{mode:"reference",ratio:"9:16",duration:5});await ctx.reply("🧍 <b>Видео со мной</b>

Сначала пришли фотографию человека, которого нужно использовать как референс.",{parse_mode:"HTML"});});
bot.callbackQuery(/ratio_(.+)/,async ctx=>{await ctx.answerCallbackQuery();const s=sessions.get(ctx.from.id);if(!s)return home(ctx);s.ratio=ctx.match[1]==="916"?"9:16":ctx.match[1]==="169"?"16:9":"1:1";sessions.set(ctx.from.id,s);await ctx.reply("⏱ Теперь выбери длительность:",{reply_markup:videoDuration()});});
bot.callbackQuery(/dur_(.+)/,async ctx=>{await ctx.answerCallbackQuery();const s=sessions.get(ctx.from.id);if(!s)return home(ctx);s.duration=Number(ctx.match[1]);sessions.set(ctx.from.id,s);await ctx.reply("✍️ Теперь напиши, что должно происходить в видео.",{reply_markup:back()});});
bot.on("message:photo",async ctx=>{const s=sessions.get(ctx.from.id);if(!s||s.mode!=="reference"){await ctx.reply("Сначала выбери «🧍 Видео со мной».");return;}const photo=ctx.message.photo.at(-1);if(photo){s.imageFileId=photo.file_id;sessions.set(ctx.from.id,s);await ctx.reply("✅ Фото получено. Теперь напиши сцену для видео.",{reply_markup:back()});}});
bot.on("message:text",async ctx=>{const prompt=ctx.message.text.trim();if(prompt.startsWith("/"))return;const s=sessions.get(ctx.from.id);if(!s){await home(ctx);return;}if(s.mode==="photo"){await ctx.reply("📸 Фото пока не подключено. Выбери 🎬 AI Видео.");return;}s.prompt=prompt;sessions.set(ctx.from.id,s);const mode=s.mode==="video"?"AI Видео":"Видео со мной";await ctx.reply("📝 <b>Проверь заказ</b>

<b>Режим:</b> "+mode+"
<b>Формат:</b> "+s.ratio+"
<b>Длительность:</b> "+s.duration+" сек

<b>Промпт:</b> "+escapeHtml(prompt.slice(0,700)),{parse_mode:"HTML",reply_markup:confirm()});});
bot.callbackQuery("edit_prompt",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("✏️ Напиши новый промпт:",{reply_markup:back()});});
bot.callbackQuery("generate",async ctx=>{
 await ctx.answerCallbackQuery();
 const s=sessions.get(ctx.from.id);
 if(!s?.prompt){await ctx.reply("Сначала нужен промпт.");return;}
 const u=await ensureUser(ctx);
 await ctx.reply("⏳ <b>Запускаю генерацию...</b>

Это может занять несколько минут на бесплатном GPU.",{parse_mode:"HTML"});
 try{
  if(db&&u)await db.createGeneration(u.id,"video",s.prompt,process.env.AI_PROVIDER??"demo");
  let imageBuffer:Uint8Array|undefined;
  if(s.imageFileId){const file=await bot.api.getFile(s.imageFileId);if(file.file_path){const media=await fetch("https://api.telegram.org/file/bot"+token+"/"+file.file_path);if(media.ok)imageBuffer=new Uint8Array(await media.arrayBuffer());}}
  const result=await provider.generateVideo({prompt:s.prompt,ratio:s.ratio,duration:s.duration,imageBuffer});
  if(result.buffer)await ctx.replyWithVideo(new InputFile(result.buffer,result.filename??"aivideotop.mp4"));
  else if(result.url)await ctx.replyWithVideo(result.url);
  else await ctx.reply("❌ <b>Генератор сейчас недоступен</b>

"+escapeHtml(result.message??"AI-провайдер ещё не подключён."),{parse_mode:"HTML"});
 }catch(e){console.error(e);await ctx.reply("❌ Ошибка генерации. Проверь подключение бесплатного GPU-провайдера.");}
 sessions.delete(ctx.from.id);
});
bot.callbackQuery("credits",async ctx=>{await ctx.answerCallbackQuery();const u=await ensureUser(ctx);await ctx.reply("💳 <b>Кредиты</b>

Баланс: "+(u?.credits??0)+"

Покупка кредитов подключим после появления платного генератора.",{parse_mode:"HTML",reply_markup:back()});});
bot.callbackQuery("history",async ctx=>{await ctx.answerCallbackQuery();const u=await ensureUser(ctx);if(!u||!db){await ctx.reply("📁 История временно недоступна.");return;}const rows=await db.listGenerations(u.id);if(!rows.length){await ctx.reply("📁 <b>История пуста</b>",{parse_mode:"HTML"});return;}await ctx.reply("📁 <b>Последние генерации</b>

"+rows.map((x:any,i:number)=>(i+1)+". "+x.type+" • "+x.status+"
"+escapeHtml(x.prompt?.slice(0,100)??"")).join("

"),{parse_mode:"HTML",reply_markup:back()});});
bot.callbackQuery("settings",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("⚙️ <b>Настройки</b>

Видео: 9:16 • 5 сек
Wan 2.1 T2V 1.3B • 480P

Позже добавим выбор модели и качества.",{parse_mode:"HTML",reply_markup:back()});});
bot.callbackQuery("home",async ctx=>{await ctx.answerCallbackQuery();await home(ctx);});
bot.catch(err=>console.error("Bot error:",err.error));

const port=Number(process.env.PORT??3000);
const botMode=process.env.BOT_MODE??"polling";
const publicUrl=process.env.PUBLIC_URL?.replace(/\/$/,"");
const webhookPath="/telegram/webhook";
const handleWebhook=webhookCallback(bot,"http");
const server=createServer(async(req,res)=>{
 if(req.url==="/health"){res.writeHead(200,{"content-type":"text/plain"});res.end("AiVideoTop OK");return;}
 if(req.url==="/debug/hf" && process.env.AI_PROVIDER==="huggingface"){
  try { const info=await (provider as HuggingFaceProvider).diagnose(); res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({space:process.env.HF_SPACE_ID??"numanajmal0/wan-video-api",endpoint:"/generate",parameters:info})); }
  catch(e){ res.writeHead(500,{"content-type":"application/json"}); res.end(JSON.stringify({error:e instanceof Error?e.message:String(e)})); }
  return;
 }
 if(botMode==="webhook"&&req.method==="POST"&&req.url===webhookPath){await handleWebhook(req,res);return;}
 res.writeHead(200,{"content-type":"text/plain"});res.end("AiVideoTop");
});
server.listen(port,"0.0.0.0",async()=>{
 console.log("AiVideoTop health server listening on "+port);
 if(botMode==="webhook"){
  if(!publicUrl) throw new Error("PUBLIC_URL is required in webhook mode");
  await bot.api.setWebhook(publicUrl+webhookPath);
  console.log("AiVideoTop webhook enabled at "+publicUrl+webhookPath);
 }else{
  await bot.start({onStart:info=>console.log("AiVideoTop started as @"+info.username)});
 }
});
