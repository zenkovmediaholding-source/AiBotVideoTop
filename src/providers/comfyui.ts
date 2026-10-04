import type {VideoProvider,VideoRequest,GenerationResult} from "./types.js";

const NEGATIVE="low quality, blurry, ugly, deformed, distorted, jitter, flicker, watermark, text, subtitles, static camera, bad anatomy";

type Workflow=Record<string,{class_type:string;inputs:Record<string,unknown>}>;

export class ComfyUIProvider implements VideoProvider{
 constructor(private readonly baseUrl:string){this.baseUrl=this.baseUrl.replace(/\/$/,"");}
 private size(ratio:string|undefined){if(ratio==="9:16")return {width:480,height:832};if(ratio==="1:1")return {width:480,height:480};return {width:832,height:480};}
 private workflow(input:VideoRequest):Workflow{
  const {width,height}=this.size(input.ratio);
  const frames=(input.duration??5)>=8?129:81;
  return {
   "1":{class_type:"UNETLoader",inputs:{unet_name:"wan2.1_t2v_1.3B_fp16.safetensors",weight_dtype:"default"}},
   "2":{class_type:"CLIPLoader",inputs:{clip_name:"umt5_xxl_fp8_e4m3fn_scaled.safetensors",type:"wan",device:"default"}},
   "3":{class_type:"VAELoader",inputs:{vae_name:"wan_2.1_vae.safetensors"}},
   "4":{class_type:"CLIPTextEncode",inputs:{text:input.prompt,clip:["2",0]}},
   "5":{class_type:"CLIPTextEncode",inputs:{text:NEGATIVE,clip:["2",0]}},
   "6":{class_type:"EmptyHunyuanLatentVideo",inputs:{width,height,length:frames,batch_size:1}},
   "7":{class_type:"ModelSamplingSD3",inputs:{shift:8,model:["1",0]}},
   "8":{class_type:"KSampler",inputs:{seed:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER),steps:30,cfg:6,sampler_name:"uni_pc",scheduler:"simple",denoise:1,model:["7",0],positive:["4",0],negative:["5",0],latent_image:["6",0]}},
   "9":{class_type:"VAEDecode",inputs:{samples:["8",0],vae:["3",0]}},
   "10":{class_type:"CreateVideo",inputs:{images:["9",0],fps:16}},
   "11":{class_type:"SaveVideo",inputs:{video:["10",0],filename_prefix:"aivideotop/video",format:"mp4",codec:"h264"}}
  };
 }
 async generateVideo(input:VideoRequest):Promise<GenerationResult>{
  if(input.imageBuffer)return {status:"unavailable",message:"Видео по референсу подключим отдельным Wan I2V workflow. Текст-видео уже подготовлено через Wan 2.1 1.3B."};
  const clientId=crypto.randomUUID();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15*60*1000);
  try{
   const response=await fetch(this.baseUrl+"/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:this.workflow(input),client_id:clientId}),signal:controller.signal});
   if(!response.ok)return {status:"unavailable",message:"ComfyUI /prompt вернул "+response.status+": "+await response.text()};
   const queued=await response.json() as {prompt_id?:string;error?:string};
   if(!queued.prompt_id)return {status:"unavailable",message:queued.error??"ComfyUI не вернул prompt_id."};
   const promptId=queued.prompt_id;
   for(let i=0;i<900;i++){
    await new Promise(r=>setTimeout(r,1000));
    const h=await fetch(this.baseUrl+"/history/"+encodeURIComponent(promptId),{signal:controller.signal});
    if(!h.ok)continue;
    const history=await h.json() as Record<string,any>;
    const item=history[promptId];
    if(!item)continue;
    const status=item.status?.status_str;
    if(status==="error"||status==="failed")return {status:"unavailable",id:promptId,message:"ComfyUI завершил генерацию с ошибкой."};
    if(status==="success"||item.status?.completed){
     const outputs=item.outputs??{};
     for(const node of Object.values(outputs) as any[]){
      for(const key of ["videos","gifs","images"]){
       const files=node?.[key];
       if(Array.isArray(files)&&files.length){
        const f=files[0];
        const qs=new URLSearchParams({filename:f.filename,subfolder:f.subfolder??"",type:f.type??"output"});
        const media=await fetch(this.baseUrl+"/view?"+qs.toString(),{signal:controller.signal});
        if(!media.ok)return {status:"unavailable",id:promptId,message:"Не удалось получить результат ComfyUI ("+media.status+")."};
        return {status:"completed",id:promptId,buffer:new Uint8Array(await media.arrayBuffer()),filename:f.filename,mimeType:"video/mp4"};
       }
      }
     }
     return {status:"unavailable",id:promptId,message:"ComfyUI завершил задачу, но не вернул видеофайл."};
    }
   }
   return {status:"unavailable",id:promptId,message:"Генерация превысила лимит ожидания 15 минут."};
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   return {status:"unavailable",message:"ComfyUI недоступен: "+message};
  }finally{clearTimeout(timer);}
 }
}