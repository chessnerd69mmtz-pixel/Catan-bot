
import { createClient } from "@supabase/supabase-js";

export const LOCAL_GAMES_KEY="catan.games.v2";
export const LOCAL_SYNC_QUEUE_KEY="catan.sync.queue.v1";
export const LOCAL_ANALYSIS_KEY="catan.analysis.cache.v1";

const safeParse=(raw,fallback)=>{try{return raw?JSON.parse(raw):fallback}catch{return fallback}};
const read=(key,fallback)=>{try{return safeParse(localStorage.getItem(key),fallback)}catch{return fallback}};
const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}};
const now=()=>Date.now();

export function loadLocalGames(){
  const value=read(LOCAL_GAMES_KEY,[]);
  return Array.isArray(value)?value:[];
}
export function saveLocalGame(game){
  const games=loadLocalGames();
  const index=games.findIndex(g=>g&&g.gameId===game.gameId||g&&g.id===game.id);
  const next=game;
  if(index>=0)games[index]=next;else games.unshift(next);
  games.sort((a,b)=>Number(b.updatedAt||b.endedAt||b.startedAt||0)-Number(a.updatedAt||a.endedAt||a.startedAt||0));
  write(LOCAL_GAMES_KEY,games.slice(0,100));
  return next;
}
export function mergeGameRecords(localGames,cloudGames){
  const byId=new Map();
  for(const g of [...(localGames||[]),...(cloudGames||[])])if(g&&(g.gameId||g.id)){
    const id=g.gameId||g.id,old=byId.get(id);
    if(!old||Number(g.updatedAt||g.endedAt||g.startedAt||0)>=Number(old.updatedAt||old.endedAt||old.startedAt||0))byId.set(id,g);
  }
  return [...byId.values()].sort((a,b)=>Number(b.updatedAt||b.endedAt||b.startedAt||0)-Number(a.updatedAt||a.endedAt||a.startedAt||0));
}
export function queueSync(operation,payload){
  const queue=read(LOCAL_SYNC_QUEUE_KEY,[]);
  queue.push({id:crypto?.randomUUID?crypto.randomUUID():String(now())+"-"+Math.random(),operation,payload,queuedAt:now(),attempts:0});
  write(LOCAL_SYNC_QUEUE_KEY,queue.slice(-200));
  return queue[queue.length-1];
}
export function loadAnalysisCache(){return read(LOCAL_ANALYSIS_KEY,{});}
export function saveAnalysisCache(gameId,analysis){
  const cache=loadAnalysisCache();cache[gameId]=analysis;write(LOCAL_ANALYSIS_KEY,cache);return analysis;
}
export function getCachedAnalysis(gameId){return loadAnalysisCache()[gameId]||null;}

const url=import.meta.env?.VITE_SUPABASE_URL;
const key=import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY||import.meta.env?.VITE_SUPABASE_ANON_KEY;
export const supabaseConfigured=!!(url&&key);
export const supabase=supabaseConfigured?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;

export async function getAuthSession(){
  if(!supabase)return {session:null,user:null};
  const {data,error}=await supabase.auth.getSession();
  return {session:data?.session||null,user:data?.session?.user||null,error:error||null};
}
export async function signInWithEmail(email,password){
  if(!supabase)throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  return supabase.auth.signInWithPassword({email,password});
}
export async function signUpWithEmail(email,password){
  if(!supabase)throw new Error("Supabase is not configured.");
  return supabase.auth.signUp({email,password});
}
export async function signOut(){
  if(!supabase)return {error:null};
  return supabase.auth.signOut();
}
export async function fetchCloudGames(){
  if(!supabase)return [];
  const {data,error}=await supabase.from("games").select("*").order("updated_at",{ascending:false}).limit(100);
  if(error)throw error;return data||[];
}
export async function upsertCloudGame(game,userId){
  if(!supabase||!userId)return null;
  const row={game_id:game.gameId||game.id,user_id:userId,mode:game.mode||game.gameMode||"4player",started_at:game.startedAt||null,ended_at:game.endedAt||null,duration_seconds:game.durationSeconds||0,status:game.status||"complete",winner_id:game.winnerId??null,final_scores:game.finalScores||Object.fromEntries((game.players||[]).map(p=>[String(p.id),p.vp||0])),payload:game,updated_at:new Date(game.updatedAt||Date.now()).toISOString()};
  const {data,error}=await supabase.from("games").upsert(row,{onConflict:"game_id"}).select().single();
  if(error)throw error;return data;
}
export async function upsertCloudBoard(gameId,userId,boardSetup){
  if(!supabase||!userId)return null;
  const row={game_id:gameId,user_id:userId,payload:boardSetup,updated_at:new Date().toISOString()};
  const {data,error}=await supabase.from("board_setups").upsert(row,{onConflict:"game_id"}).select().single();
  if(error)throw error;return data;
}
export async function replaceCloudMoves(gameId,userId,moves){
  if(!supabase||!userId)return;
  await supabase.from("move_logs").delete().eq("game_id",gameId);
  if(!moves?.length)return;
  const rows=moves.map((m,i)=>({move_id:m.moveId||gameId+"-"+i,game_id:gameId,user_id:userId,turn_number:m.turn||0,player_id:String(m.playerId),timestamp_ms:m.timestamp||Date.now(),action_type:m.actionType||m.type||"unknown",payload:m.payload||m,dice_roll:m.diceRoll??null,state_before:m.stateBefore||null,state_after:m.stateAfter||null}));
  const {error}=await supabase.from("move_logs").insert(rows);if(error)throw error;
}
export async function upsertCloudAnalysis(gameId,userId,analysis){
  if(!supabase||!userId)return null;
  const row={game_id:gameId,user_id:userId,engine_version:analysis.engineVersion,computed_at:new Date(analysis.computedAt||Date.now()).toISOString(),per_player:analysis.perPlayer||{},move_evaluations:analysis.moveEvaluations||[],updated_at:new Date().toISOString()};
  const {data,error}=await supabase.from("game_analysis").upsert(row,{onConflict:"game_id"}).select().single();
  if(error)throw error;return data;
}
export async function syncCompletedGame(game,userId,analysis){
  if(!supabase||!userId)return {synced:false,reason:"not-configured"};
  try{
    await upsertCloudGame(game,userId);
    await upsertCloudBoard(game.gameId||game.id,userId,game.boardSetup||{tiles:game.board||[],ports:game.ports||[]});
    await replaceCloudMoves(game.gameId||game.id,userId,game.moves||game.decisions||[]);
    if(analysis)await upsertCloudAnalysis(game.gameId||game.id,userId,analysis);
    return {synced:true};
  }catch(error){
    queueSync("game", {game,analysis});return {synced:false,error};
  }
}
export async function flushSyncQueue(userId){
  if(!userId||!supabase)return {synced:0,remaining:read(LOCAL_SYNC_QUEUE_KEY,[]).length};
  const queue=read(LOCAL_SYNC_QUEUE_KEY,[]);const remaining=[],results=[];
  for(const item of queue){
    try{
      if(item.operation==="game")await syncCompletedGame(item.payload.game,userId,item.payload.analysis);
      results.push({id:item.id,ok:true});
    }catch(error){
      item.attempts=(item.attempts||0)+1;
      item.lastError=String(error?.message||error);
      remaining.push(item);
      if(item.attempts>=5)continue;
    }
  }
  write(LOCAL_SYNC_QUEUE_KEY,remaining);return {synced:results.filter(x=>x.ok).length,remaining:remaining.length};
}
