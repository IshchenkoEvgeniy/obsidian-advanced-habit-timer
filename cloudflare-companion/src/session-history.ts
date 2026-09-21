import type { D1Database, TimerRow, Env } from './types';
import { zonedParts } from './time';

export async function recordSession(db:D1Database,profile:string,timer:TimerRow,elapsed:number,status:string,note=''):Promise<string>{
 const id=timer.session_id||crypto.randomUUID();
 const media=timer.media_id?await db.prepare('SELECT id,title,item_path,unit,progress,total FROM library_items WHERE profile_id=? AND id=?').bind(profile,timer.media_id).first():null;
 let task=null;try{task=timer.task_json?JSON.parse(timer.task_json):null;}catch{}
 const config=await db.prepare('SELECT timezone FROM companion_config WHERE profile_id=?').bind(profile).first<{timezone:string}>();
 const local=zonedParts(Date.now(),config?.timezone||'UTC');
 await db.prepare(`INSERT OR IGNORE INTO session_history(profile_id,id,started_at,ended_at,habit_name,duration_sec,status,data_json)
 VALUES(?,?,?,?,?,?,?,?)`).bind(profile,id,timer.original_started_at||null,Date.now(),timer.habit_name,elapsed,status,
 JSON.stringify({media,task,startTime:timer.start_time,endTime:local.time,targetSeconds:timer.target_seconds,note,date:local.date})).run();
 return id;
}

export async function sessionHistoryApi(request:Request,env:Env,profile:string,timezone='UTC'):Promise<Response>{
 const url=new URL(request.url),habit=url.searchParams.get('habit')||'',from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';
 const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))return Response.json({error:'invalid_dates'},{status:400});
 const common=`WITH sessions AS (
 SELECT id,started_at,ended_at,habit_name,duration_sec,status,data_json,result_json,0 AS legacy,json_extract(data_json,'$.date') AS session_date FROM session_history WHERE profile_id=?
 UNION ALL
 SELECT event_id,NULL,created_at,habit_name,COALESCE(amount,0),'completed',payload_json,NULL,1,habit_date FROM companion_events
 WHERE profile_id=? AND event_type='add_timer' AND json_extract(payload_json,'$.sessionId') IS NULL
 )`;
 const where=' WHERE session_date>=? AND session_date<=? AND (?=\'\' OR habit_name=?)';
 const params=[profile,profile,from||'0000-00-00',to||'9999-12-31',habit,habit];
 const [rows,totals]=await Promise.all([
 env.DB.prepare(common+' SELECT * FROM sessions'+where+' ORDER BY ended_at DESC,id DESC LIMIT 30 OFFSET ?').bind(...params,offset).all<Record<string,unknown>>(),
 env.DB.prepare(common+" SELECT COUNT(*) AS count,SUM(CASE WHEN status='completed' THEN duration_sec ELSE 0 END) AS seconds FROM sessions"+where).bind(...params).first()
 ]);
 const items=(rows.results||[]).map(r=>({...r,data:JSON.parse(String(r.data_json)),result:r.result_json?JSON.parse(String(r.result_json)):null,data_json:undefined,result_json:undefined}));
 return Response.json({items,totals,timezone,nextOffset:items.length===30?offset+30:null},{headers:{'Cache-Control':'no-store'}});
}
