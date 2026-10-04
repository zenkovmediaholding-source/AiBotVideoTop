export type VideoRequest={prompt:string;imageUrl?:string;ratio?:string;duration?:number};
export type GenerationResult={status:"queued"|"completed"|"unavailable";id?:string;url?:string;message?:string};
export interface VideoProvider{generateVideo(input:VideoRequest):Promise<GenerationResult>;}