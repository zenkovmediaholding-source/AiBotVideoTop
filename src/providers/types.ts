export type VideoRequest={prompt:string;imageUrl?:string;imageBuffer?:Uint8Array;ratio?:string;duration?:number};
export type GenerationResult={status:"queued"|"completed"|"unavailable";id?:string;url?:string;buffer?:Uint8Array;filename?:string;mimeType?:string;message?:string};
export interface VideoProvider{generateVideo(input:VideoRequest):Promise<GenerationResult>;}