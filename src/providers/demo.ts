import type {VideoProvider,VideoRequest,GenerationResult} from "./types.js";
export class DemoProvider implements VideoProvider{
 async generateVideo(_input:VideoRequest):Promise<GenerationResult>{
  return {status:"unavailable",message:"Бесплатный demo-режим активен. Платный AI-провайдер можно подключить позже без изменения Telegram-бота."};
 }
}