import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type UserRow = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  credits: number;
  created_at: string;
};

export class Database {
  private client: SupabaseClient;

  constructor() {
    const url=process.env.SUPABASE_URL;
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    this.client=createClient(url,key);
  }

  async upsertUser(telegramId:number, username?:string, firstName?:string){
    const {data,error}=await this.client.from("users").upsert({
      telegram_id:telegramId, username:username??null, first_name:firstName??null
    },{onConflict:"telegram_id"}).select().single();
    if(error) throw error;
    return data as UserRow;
  }

  async createGeneration(userId:string,type:"photo"|"video",prompt:string,provider:string){
    const {data,error}=await this.client.from("generations").insert({
      user_id:userId,type,prompt,status:"queued",provider
    }).select().single();
    if(error) throw error;
    return data;
  }

  async listGenerations(userId:string){
    const {data,error}=await this.client.from("generations").select("*").eq("user_id",userId).order("created_at",{ascending:false}).limit(10);
    if(error) throw error;
    return data;
  }
}