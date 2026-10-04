import type {VideoProvider,VideoRequest,GenerationResult} from "./types.js";
export class ComfyUIProvider implements VideoProvider{
 constructor(private readonly baseUrl:string){}
 async generateVideo(input:VideoRequest):Promise<GenerationResult>{
  void input; void this.baseUrl;
  return {status:"unavailable",message:"ComfyUI provider подготовлен. Для реальной бесплатной генерации нужен компьютер или сервер с GPU, на котором запущен ComfyUI."};
 }
}