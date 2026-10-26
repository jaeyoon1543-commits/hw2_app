// One-time migration only; the running app never reads or writes SQLite.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const {createPool,initializeDatabase}=require('../server.cjs');
(async()=>{
 let pool,source,client;
 try{
  const file=path.join(__dirname,'..','data','hankki.sqlite');
  if(!fs.existsSync(file))throw new Error('missing SQLite');
  source=new DatabaseSync(file,{readOnly:true});pool=createPool();await initializeDatabase(pool);client=await pool.connect();
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[7261026]);
  const columns={users:['id','username','nickname','salt','hash'],sessions:['token','user_id','expires'],recipes:['id','owner_id','body','created'],ratings:['recipe_id','user_id','value'],comments:['recipe_id','user_id','body','updated'],bookmarks:['recipe_id','user_id'],imports:['user_id','legacy_id','recipe_id'],search_counts:['term','count','last_searched']};
  let total=0;
  for(const [table,fields] of Object.entries(columns)){
   if(!source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
   for(const row of source.prepare('SELECT * FROM '+table).all()){
    const placeholders=fields.map((field,i)=>'$'+(i+1)+(table==='recipes'&&field==='body'?'::jsonb':'')).join(',');
    const result=await client.query('INSERT INTO '+table+'('+fields.join(',')+') VALUES('+placeholders+') ON CONFLICT DO NOTHING',fields.map(field=>row[field]));total+=result.rowCount;
   }
  }
  await client.query('COMMIT');console.log('SQLite → Neon migration complete. Rows inserted: '+total+'. Original SQLite file preserved.');
 }catch{if(client)await client.query('ROLLBACK').catch(()=>{});console.error('이전 실패: 원본 파일은 보존되었습니다. 연결 및 기존 ID/회원 충돌 여부를 확인해주세요.');process.exitCode=1}
 finally{if(client)client.release();if(source)source.close();if(pool)await pool.end()}
})();
