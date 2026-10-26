require('dotenv').config({path:require('node:path').join(__dirname,'.env'),quiet:true});
const express=require('express');
const {Pool}=require('pg');
const {randomUUID,randomBytes,scrypt:derive,timingSafeEqual,createHash}=require('node:crypto');
const {promisify}=require('node:util');
const fs=require('node:fs');
const path=require('node:path');
const {text,validateRecipe,fail}=require('./validation.cjs');
const scrypt=promisify(derive);
const hashToken=value=>createHash('sha256').update(value).digest('hex');
const seeds=JSON.parse(fs.readFileSync(path.join(__dirname,'seeds.json'),'utf8'));

function createPool(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL 환경변수를 설정해주세요.');
 let url;try{url=new URL(process.env.DATABASE_URL)}catch{throw new Error('DATABASE_URL 형식을 확인해주세요.')}
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('PostgreSQL DATABASE_URL이 필요합니다.');
 // Keep certificate verification enabled even when the connection string uses sslmode=require.
 const local=['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname);
 const channelBinding=url.searchParams.get('channel_binding')==='require';
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','channel_binding'])url.searchParams.delete(key);
 return new Pool({connectionString:url.href,ssl:local?false:{rejectUnauthorized:true},enableChannelBinding:channelBinding,max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:15000,allowExitOnIdle:true});
}
async function initializeDatabase(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize cold-start migrations across Vercel function instances.
  await client.query('SELECT pg_advisory_xact_lock($1)',[7261026]);
  const schema=fs.readFileSync(path.join(__dirname,'database','neon-schema.sql'),'utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'').replaceAll('public.','');
  await client.query(schema);
  for(const [i,r] of seeds.entries())await client.query('INSERT INTO recipes(id,owner_id,body,created) VALUES($1,NULL,$2::jsonb,$3) ON CONFLICT(id) DO NOTHING',[r.id,JSON.stringify(r),seeds.length-i]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
function createApp(options={}){
 const pool=options.pool||createPool();
 pool.on('error',()=>console.error('PostgreSQL connection error'));
 const query=(sql,params=[])=>pool.query(sql,params);
 let ready=null;
 function initialize(){if(!ready)ready=initializeDatabase(pool).catch(error=>{ready=null;throw error});return ready}
 const app=express();app.disable('x-powered-by');
 const production=Boolean(process.env.VERCEL)||process.env.NODE_ENV==='production';
 if(production)app.set('trust proxy',1);
 const attempts=new Map();
 function throttle(key,limit){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const a=attempts.get(key)||{count:0,until:now+60000};a.count++;attempts.set(key,a);return a.count>limit}
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'private, no-store'});next()});
 app.use((req,res,next)=>{
  if(req.path.startsWith('/api/')&&!['GET','HEAD'].includes(req.method)){
   if(req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'다른 사이트에서의 요청은 허용하지 않습니다.'});
   if(!req.is('application/json'))return res.status(415).json({error:'JSON 요청이 필요합니다.'});
  }next();
 });
 app.use(express.json({limit:'3mb'}));
 app.get('/login',(req,res)=>res.redirect('/?login=1'));
 app.use('/api',async(req,res,next)=>{try{await initialize();next()}catch{res.status(503).json({error:'데이터베이스에 연결하지 못했습니다. 서버 환경변수를 확인해주세요.'})}});
 const publicUser=u=>u?{id:u.id,username:u.username,nickname:u.nickname}:null;
 app.use('/api',async(req,res,next)=>{
  const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('hankki_session='));
  req.token=cookie?cookie.slice('hankki_session='.length):'';
  req.user=req.token?(await query('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires>$2',[hashToken(req.token),Date.now()])).rows[0]:null;
  next();
 });
 const auth=(req,res,next)=>req.user?next():res.status(401).json({code:'AUTH_REQUIRED',error:'로그인이 필요합니다.'});
 async function recipe(id){const r=(await query('SELECT * FROM recipes WHERE id=$1',[id])).rows[0];if(!r)fail(404,'레시피를 찾을 수 없습니다.');return r}
 async function owner(req,id){const r=await recipe(id);if(r.owner_id!==req.user.id)fail(403,'작성자만 변경할 수 있습니다.');return r}
 async function session(res,user){const token=randomBytes(32).toString('hex');await query('DELETE FROM sessions WHERE expires<=$1',[Date.now()]);await query('INSERT INTO sessions(token,user_id,expires) VALUES($1,$2,$3)',[hashToken(token),user.id,Date.now()+7*86400000]);res.cookie('hankki_session',token,{httpOnly:true,secure:production,sameSite:'strict',maxAge:7*86400000,path:'/'});}
 app.post('/api/auth/:action',async(req,res)=>{
  if(!['login','signup'].includes(req.params.action))fail(404,'잘못된 요청입니다.');
  if(throttle('user:'+req.ip,30))fail(429,'잠시 후 다시 시도해주세요.');
  const username=text(req.body.username,30,'아이디').toLowerCase(),password=req.body.password;
  if(!/^[a-z0-9_]{3,30}$/.test(username)||typeof password!=='string'||password.length<8||password.length>128)fail(400,'아이디는 영문·숫자·밑줄 3~30자, 비밀번호는 8~128자로 입력해주세요.');
  let user=(await query('SELECT * FROM users WHERE username=$1',[username])).rows[0];
  if(req.params.action==='signup'){
   if(user)fail(409,'이미 사용 중인 아이디입니다.');
   const nickname=text(req.body.nickname,30,'닉네임'),salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
   user={id:randomUUID(),username,nickname,salt,hash};
   try{await query('INSERT INTO users(id,username,nickname,salt,hash) VALUES($1,$2,$3,$4,$5)',[user.id,username,nickname,salt,hash])}catch(error){if(error.code==='23505')fail(409,'이미 사용 중인 아이디입니다.');throw error}
  }else{
   const actual=await scrypt(password,user?.salt||'invalid-account',64);
   if(!user||!timingSafeEqual(actual,Buffer.from(user.hash,'hex')))fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
  }await session(res,user);res.json({user:publicUser(user)});
 });
 app.post('/api/logout',async(req,res)=>{if(req.token)await query('DELETE FROM sessions WHERE token=$1',[hashToken(req.token)]);res.clearCookie('hankki_session',{path:'/',secure:production,httpOnly:true,sameSite:'strict'});res.json({ok:true})});
 const popularSearches=async()=>(await query('SELECT term,count::integer FROM search_counts ORDER BY count DESC,last_searched DESC,term ASC LIMIT 3')).rows;
 app.post('/api/searches',async(req,res)=>{
  const term=text(req.body.query,60,'검색어').normalize('NFKC').replace(/\s+/g,' ').toLowerCase();if(term.length>60)fail(400,'검색어는 60자 이내로 입력해주세요.');
  await query('INSERT INTO search_counts(term,count,last_searched) VALUES($1,1,$2) ON CONFLICT(term) DO UPDATE SET count=search_counts.count+1,last_searched=EXCLUDED.last_searched',[term,Date.now()]);
  res.json({popularSearches:await popularSearches()});
 });
 app.get('/api/state',async(req,res)=>{
  const [countsResult,recipesResult,reviewsResult,saved,popular]=await Promise.all([
   query('SELECT recipe_id,COUNT(*)::integer AS count FROM bookmarks GROUP BY recipe_id'),
   query('SELECT r.*,u.nickname FROM recipes r LEFT JOIN users u ON u.id=r.owner_id ORDER BY r.created DESC,r.id DESC'),
   query(`SELECT x.recipe_id AS "recipeId",x.user_id AS "ownerId",u.nickname AS author,COALESCE(r.value,0) AS rating,COALESCE(c.body,'') AS comment,COALESCE(c.updated,'') AS date FROM (SELECT recipe_id,user_id FROM ratings UNION SELECT recipe_id,user_id FROM comments) x JOIN users u ON u.id=x.user_id LEFT JOIN ratings r ON r.recipe_id=x.recipe_id AND r.user_id=x.user_id LEFT JOIN comments c ON c.recipe_id=x.recipe_id AND c.user_id=x.user_id`),
   req.user?query('SELECT recipe_id FROM bookmarks WHERE user_id=$1',[req.user.id]):Promise.resolve({rows:[]}),popularSearches()
  ]);
  const counts=Object.fromEntries(countsResult.rows.map(r=>[r.recipe_id,r.count]));
  const recipes=recipesResult.rows.map(r=>({...r.body,id:r.id,ownerId:r.owner_id,author:r.nickname||r.body.author,saveCount:counts[r.id]||0}));
  res.json({user:publicUser(req.user),recipes,reviews:reviewsResult.rows,popularSearches:popular,bookmarks:saved.rows.map(r=>r.recipe_id)});
 });
 app.post('/api/recipes',auth,async(req,res)=>{const r=validateRecipe(req.body),id=randomUUID();await query('INSERT INTO recipes(id,owner_id,body,created) VALUES($1,$2,$3::jsonb,$4)',[id,req.user.id,JSON.stringify(r),Date.now()]);res.status(201).json({id})});
 app.put('/api/recipes/:id',auth,async(req,res)=>{await owner(req,req.params.id);const r=validateRecipe(req.body);await query('UPDATE recipes SET body=$1::jsonb WHERE id=$2 AND owner_id=$3',[JSON.stringify(r),req.params.id,req.user.id]);res.json({id:req.params.id})});
 app.delete('/api/recipes/:id',auth,async(req,res)=>{await owner(req,req.params.id);await query('DELETE FROM recipes WHERE id=$1 AND owner_id=$2',[req.params.id,req.user.id]);res.json({ok:true})});
 app.put('/api/recipes/:id/rating',auth,async(req,res)=>{await recipe(req.params.id);const n=req.body.rating;if(!Number.isInteger(n)||n<1||n>5)fail(400,'별점은 1~5점이어야 합니다.');await query('INSERT INTO ratings(recipe_id,user_id,value) VALUES($1,$2,$3) ON CONFLICT(recipe_id,user_id) DO UPDATE SET value=EXCLUDED.value',[req.params.id,req.user.id,n]);res.json({ok:true})});
 app.delete('/api/recipes/:id/rating',auth,async(req,res)=>{await query('DELETE FROM ratings WHERE recipe_id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})});
 app.put('/api/recipes/:id/comment',auth,async(req,res)=>{await recipe(req.params.id);const body=text(req.body.comment,1000,'댓글');await query('INSERT INTO comments(recipe_id,user_id,body,updated) VALUES($1,$2,$3,$4) ON CONFLICT(recipe_id,user_id) DO UPDATE SET body=EXCLUDED.body,updated=EXCLUDED.updated',[req.params.id,req.user.id,body,new Date().toISOString()]);res.json({ok:true})});
 app.delete('/api/recipes/:id/comment',auth,async(req,res)=>{await query('DELETE FROM comments WHERE recipe_id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})});
 app.put('/api/recipes/:id/bookmark',auth,async(req,res)=>{await recipe(req.params.id);if(typeof req.body.saved!=='boolean')fail(400,'저장 여부를 확인해주세요.');if(req.body.saved)await query('INSERT INTO bookmarks(recipe_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]);else await query('DELETE FROM bookmarks WHERE recipe_id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})});
 app.post('/api/import',auth,async(req,res)=>{
  const payload=req.body;if(!Array.isArray(payload.recipes)||!Array.isArray(payload.reviews)||!Array.isArray(payload.bookmarks)||payload.recipes.length>300)fail(400,'백업 파일 형식을 확인해주세요.');
  const own=payload.recipes.filter(r=>r&&(!r.ownerId||r.ownerId===payload.legacyOwnerId)).map(r=>({oldId:text(r.id,100,'기존 ID'),body:validateRecipe(r)}));
  const client=await pool.connect();let count=0;
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.id]);
   const ids=new Map(seeds.map(r=>[r.id,r.id]));
   for(const r of own){let found=(await client.query('SELECT recipe_id FROM imports WHERE user_id=$1 AND legacy_id=$2',[req.user.id,r.oldId])).rows[0];if(!found){const id=randomUUID();await client.query('INSERT INTO recipes(id,owner_id,body,created) VALUES($1,$2,$3::jsonb,$4)',[id,req.user.id,JSON.stringify(r.body),Date.now()]);await client.query('INSERT INTO imports(user_id,legacy_id,recipe_id) VALUES($1,$2,$3)',[req.user.id,r.oldId,id]);found={recipe_id:id};count++}ids.set(r.oldId,found.recipe_id)}
   for(const r of payload.reviews){if(!r||r.ownerId!==payload.legacyOwnerId||!r.ownerId)continue;const id=ids.get(r.recipeId);if(!id)continue;if(Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5)await client.query('INSERT INTO ratings(recipe_id,user_id,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,req.user.id,r.rating]);if(typeof r.comment==='string'&&r.comment.trim())await client.query('INSERT INTO comments(recipe_id,user_id,body,updated) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,req.user.id,text(r.comment,1000,'댓글'),new Date().toISOString()])}
   for(const old of payload.bookmarks){const id=ids.get(old);if(id)await client.query('INSERT INTO bookmarks(recipe_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,req.user.id])}
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  res.json({count});
 });
 const files=['index.html','app.js','account.js','photos.js','style.css','legacy-export.html'];
 for(const file of files)app.get('/'+(file==='index.html'?'':file),(req,res)=>res.sendFile(path.join(__dirname,file)));
 app.get('/index.html',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
 app.use((req,res)=>res.status(404).json({error:'요청을 찾을 수 없습니다.'}));
 app.use((error,req,res,next)=>{
  // Never log connection strings, passwords, SQL parameters or raw database errors.
  const status=error.status&&error.status>=400&&error.status<500?error.status:500;
  if(status===500)console.error('Request failed:',/^[A-Z0-9_]{2,30}$/.test(error.code||'')?error.code:'INTERNAL');
  res.status(status).json({error:status===500?'서버에서 오류가 발생했습니다.':error.type==='entity.too.large'?'요청은 3MB 이하여야 합니다.':status===400&&error instanceof SyntaxError?'JSON 요청을 확인해주세요.':error.message});
 });
 return {app,pool,initialize};
}
if(require.main===module){
 try{const service=createApp();service.initialize().then(()=>{service.app.listen(Number(process.env.PORT)||3000,'127.0.0.1',error=>{if(error){console.error('로컬 서버 시작 실패: 포트가 사용 중인지 확인해주세요.');process.exitCode=1;service.pool.end();return}console.log('한끼노트: http://localhost:'+(process.env.PORT||3000))})}).catch(()=>{console.error('Neon 연결 또는 테이블 초기화에 실패했습니다. DATABASE_URL과 네트워크를 확인해주세요.');service.pool.end();process.exitCode=1})}catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={createApp,createPool,initializeDatabase};
