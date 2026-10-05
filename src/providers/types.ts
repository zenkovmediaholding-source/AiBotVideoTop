export type VideoRequest={prompt:string;imageUrl?:string;imageBuffer?:Uint8Array;imageMimeType?:string;imageBuffers?:Array<{buffer:Uint8Array;mimeType:string}>;referenceVideoBuffer?:Uint8Array;referenceVideoMimeType?:string;ratio?:string;duration?:number;quality?:"test"|"perfect"};
export type GenerationResult={status:"queued"|"completed"|"unavailable";id?:string;url?:string;buffer?:Uint8Array;filename?:string;mimeType?:string;message?:string};
export interface VideoProvider{generateVideo(input:VideoRequest):Promise<GenerationResult>;}
