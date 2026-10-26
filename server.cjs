const express = require('express');
const {DatabaseSync} = require('node:sqlite');
const {randomUUID,randomBytes,scrypt:derive,timingSafeEqual,createHash}=require('node:crypto');
const {promisify}=require('node:util');
const fs=require('node:fs');
const path=require('node:path');
const scrypt=promisify(derive);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
function createApp(databasePath=path.join(__dirname,'data','hankki.sqlite')){
 fs.mkdirSync(path.dirname(databasePath),{recursive:true});
 const db=new DatabaseSync(databasePath);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS recipes(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),body TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS ratings(recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5),PRIMARY KEY(recipe_id,user_id));
 CREATE TABLE IF NOT EXISTS comments(recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(recipe_id,user_id));
 CREATE TABLE IF NOT EXISTS bookmarks(recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(recipe_id,user_id));
 CREATE TABLE IF NOT EXISTS imports(user_id TEXT REFERENCES users(id),legacy_id TEXT,recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,PRIMARY KEY(user_id,legacy_id));
 CREATE TABLE IF NOT EXISTS search_counts(term TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 1 CHECK(count>0),last_searched INTEGER NOT NULL);`);
 const seeds=JSON.parse(fs.readFileSync(path.join(__dirname,'seeds.json'),'utf8'));
 const seed=db.prepare('INSERT OR IGNORE INTO recipes VALUES(?,NULL,?,?)');
 seeds.forEach((r,i)=>seed.run(r.id,JSON.stringify(r),seeds.length-i));
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  if(req.path.startsWith('/api/')){
   res.set('Cache-Control','no-store');
   if(!['GET','HEAD'].includes(req.method)){
    if(req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'다른 사이트에서의 요청은 허용하지 않습니다.'});
    if(!req.is('application/json'))return res.status(415).json({error:'JSON 요청이 필요합니다.'});
   }
  }next();
 });
 app.use(express.json({limit:'15mb'}));
 const publicUser=u=>u?{id:u.id,username:u.username,nickname:u.nickname}:null;
 const hashToken=t=>createHash('sha256').update(t).digest('hex');
 app.use((req,res,next)=>{
  const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('hankki_session='));
  req.token=cookie?cookie.slice('hankki_session='.length):'';
  req.user=req.token?db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(hashToken(req.token),Date.now()):null;
  next();
 });
 const auth=(req,res,next)=>req.user?next():res.status(401).json({error:'로그인이 필요합니다.'});
 const recipe=id=>{const r=db.prepare('SELECT * FROM recipes WHERE id=?').get(id);if(!r)fail(404,'레시피를 찾을 수 없습니다.');return r};
 const owner=(req,id)=>{const r=recipe(id);if(r.owner_id!==req.user.id)fail(403,'작성자만 변경할 수 있습니다.');return r};
 function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,label+'을 확인해주세요.');return value.trim()}
 function validateRecipe(input){
  const r={title:text(input.title,60,'음식 이름'),description:text(input.description,150,'소개'),category:input.category,time:Number(input.time),servings:Number(input.servings),level:input.level,type:input.type,creator:'',source:'',image:input.image||''};
  if(!['한식','양식','중식','일식','디저트','기타'].includes(r.category)||!['쉬움','보통','어려움'].includes(r.level)||!['own','chef'].includes(r.type))fail(400,'분류, 난이도와 레시피 유형을 확인해주세요.');
  if(!Number.isInteger(r.time)||r.time<1||r.time>1440||!Number.isInteger(r.servings)||r.servings<1||r.servings>100)fail(400,'조리시간과 인분을 확인해주세요.');
  for(const key of ['ingredients','steps']){if(!Array.isArray(input[key])||!input[key].length||input[key].length>200)fail(400,'재료와 조리 방법을 확인해주세요.');r[key]=input[key].map(v=>text(v,2000,'재료 또는 단계'))}
  if(typeof r.image!=='string'||r.image.length>700000||r.image&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.image)&&!/^https?:\/\//i.test(r.image))fail(400,'사진 형식을 확인해주세요.');
  if(r.type==='chef'){r.creator=text(input.creator,60,'원작자');r.source=text(input.source,2000,'출처');try{if(!['http:','https:'].includes(new URL(r.source).protocol))throw Error()}catch{fail(400,'출처 링크를 확인해주세요.')}}
  return r;
 }
 function session(res,user){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token),user.id,Date.now()+7*86400000);res.cookie('hankki_session',token,{httpOnly:true,sameSite:'strict',maxAge:7*86400000,path:'/'});}
 const attempts=new Map();
 app.post('/api/auth/:action',async(req,res)=>{
  if(!['login','signup'].includes(req.params.action))fail(404,'잘못된 요청입니다.');
  const key=req.ip,now=Date.now(),attempt=attempts.get(key)||{count:0,until:now+60000};
  if(now>attempt.until){attempt.count=0;attempt.until=now+60000}if(++attempt.count>30)fail(429,'잠시 후 다시 시도해주세요.');attempts.set(key,attempt);
  const username=text(req.body.username,30,'아이디').toLowerCase(),password=req.body.password;
  if(!/^[a-z0-9_]{3,30}$/.test(username)||typeof password!=='string'||password.length<8||password.length>128)fail(400,'아이디와 비밀번호 형식을 확인해주세요.');
  let user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if(req.params.action==='signup'){
   if(user)fail(409,'이미 사용 중인 아이디입니다.');
   const nickname=text(req.body.nickname,30,'닉네임'),salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
   user={id:randomUUID(),username,nickname,salt,hash};
   try{db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id,username,nickname,salt,hash)}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'이미 사용 중인 아이디입니다.');throw e}
  }else{
   const actual=await scrypt(password,user?.salt||'invalid-account',64);
   if(!user||!timingSafeEqual(actual,Buffer.from(user.hash,'hex')))fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
  }session(res,user);res.json({user:publicUser(user)});
 });
 app.post('/api/logout',(req,res)=>{if(req.token)db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(req.token));res.clearCookie('hankki_session',{path:'/'});res.json({ok:true})});
 const popularSearches=()=>db.prepare('SELECT term,count FROM search_counts ORDER BY count DESC,last_searched DESC,term ASC LIMIT 3').all();
 app.post('/api/searches',(req,res)=>{
  const term=text(req.body.query,60,'검색어').normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
  if(term.length>60)fail(400,'검색어는 60자 이내로 입력해주세요.');
  db.prepare('INSERT INTO search_counts(term,count,last_searched) VALUES(?,1,?) ON CONFLICT(term) DO UPDATE SET count=count+1,last_searched=excluded.last_searched').run(term,Date.now());
  res.json({popularSearches:popularSearches()});
 });
 app.get('/api/state',(req,res)=>{
  const counts=Object.fromEntries(db.prepare('SELECT recipe_id,COUNT(*) AS count FROM bookmarks GROUP BY recipe_id').all().map(r=>[r.recipe_id,r.count]));
  const recipes=db.prepare('SELECT r.*,u.nickname FROM recipes r LEFT JOIN users u ON u.id=r.owner_id ORDER BY r.created DESC,r.rowid DESC').all().map(r=>({...JSON.parse(r.body),id:r.id,ownerId:r.owner_id,author:r.nickname||JSON.parse(r.body).author,saveCount:counts[r.id]||0}));
  const reviews=db.prepare(`SELECT x.recipe_id AS recipeId,x.user_id AS ownerId,u.nickname AS author,COALESCE(r.value,0) AS rating,COALESCE(c.body,'') AS comment,COALESCE(c.updated,'') AS date FROM (SELECT recipe_id,user_id FROM ratings UNION SELECT recipe_id,user_id FROM comments) x JOIN users u ON u.id=x.user_id LEFT JOIN ratings r ON r.recipe_id=x.recipe_id AND r.user_id=x.user_id LEFT JOIN comments c ON c.recipe_id=x.recipe_id AND c.user_id=x.user_id`).all();
  res.json({user:publicUser(req.user),recipes,reviews,popularSearches:popularSearches(),bookmarks:req.user?db.prepare('SELECT recipe_id FROM bookmarks WHERE user_id=?').all(req.user.id).map(r=>r.recipe_id):[]});
 });
 app.post('/api/recipes',auth,(req,res)=>{const r=validateRecipe(req.body),id=randomUUID();db.prepare('INSERT INTO recipes VALUES(?,?,?,?)').run(id,req.user.id,JSON.stringify(r),Date.now());res.status(201).json({id})});
 app.put('/api/recipes/:id',auth,(req,res)=>{owner(req,req.params.id);const r=validateRecipe(req.body);db.prepare('UPDATE recipes SET body=? WHERE id=?').run(JSON.stringify(r),req.params.id);res.json({id:req.params.id})});
 app.delete('/api/recipes/:id',auth,(req,res)=>{owner(req,req.params.id);db.prepare('DELETE FROM recipes WHERE id=?').run(req.params.id);res.json({ok:true})});
 app.put('/api/recipes/:id/rating',auth,(req,res)=>{recipe(req.params.id);const n=req.body.rating;if(!Number.isInteger(n)||n<1||n>5)fail(400,'별점은 1~5점이어야 합니다.');db.prepare('INSERT INTO ratings VALUES(?,?,?) ON CONFLICT(recipe_id,user_id) DO UPDATE SET value=excluded.value').run(req.params.id,req.user.id,n);res.json({ok:true})});
 app.delete('/api/recipes/:id/rating',auth,(req,res)=>{db.prepare('DELETE FROM ratings WHERE recipe_id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true})});
 app.put('/api/recipes/:id/comment',auth,(req,res)=>{recipe(req.params.id);const body=text(req.body.comment,1000,'댓글');db.prepare('INSERT INTO comments VALUES(?,?,?,?) ON CONFLICT(recipe_id,user_id) DO UPDATE SET body=excluded.body,updated=excluded.updated').run(req.params.id,req.user.id,body,new Date().toISOString());res.json({ok:true})});
 app.delete('/api/recipes/:id/comment',auth,(req,res)=>{db.prepare('DELETE FROM comments WHERE recipe_id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true})});
 app.put('/api/recipes/:id/bookmark',auth,(req,res)=>{recipe(req.params.id);if(typeof req.body.saved!=='boolean')fail(400,'저장 여부를 확인해주세요.');if(req.body.saved)db.prepare('INSERT OR IGNORE INTO bookmarks VALUES(?,?)').run(req.params.id,req.user.id);else db.prepare('DELETE FROM bookmarks WHERE recipe_id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true})});
 app.post('/api/import',auth,(req,res)=>{
  const payload=req.body;if(!Array.isArray(payload.recipes)||!Array.isArray(payload.reviews)||!Array.isArray(payload.bookmarks)||payload.recipes.length>300)fail(400,'백업 파일 형식을 확인해주세요.');
  const own=payload.recipes.filter(r=>!r.ownerId||r.ownerId===payload.legacyOwnerId).map(r=>({oldId:text(r.id,100,'기존 ID'),body:validateRecipe(r)}));
  let count=0;db.exec('BEGIN');try{
   const ids=new Map(seeds.map(r=>[r.id,r.id]));
   for(const r of own){let found=db.prepare('SELECT recipe_id FROM imports WHERE user_id=? AND legacy_id=?').get(req.user.id,r.oldId);if(!found){const id=randomUUID();db.prepare('INSERT INTO recipes VALUES(?,?,?,?)').run(id,req.user.id,JSON.stringify(r.body),Date.now());db.prepare('INSERT INTO imports VALUES(?,?,?)').run(req.user.id,r.oldId,id);found={recipe_id:id};count++}ids.set(r.oldId,found.recipe_id)}
   for(const r of payload.reviews){if(r.ownerId!==payload.legacyOwnerId||!r.ownerId)continue;const id=ids.get(r.recipeId);if(!id)continue;if(Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5)db.prepare('INSERT OR IGNORE INTO ratings VALUES(?,?,?)').run(id,req.user.id,r.rating);if(typeof r.comment==='string'&&r.comment.trim())db.prepare('INSERT OR IGNORE INTO comments VALUES(?,?,?,?)').run(id,req.user.id,text(r.comment,1000,'댓글'),new Date().toISOString())}
   for(const old of payload.bookmarks){const id=ids.get(old);if(id)db.prepare('INSERT OR IGNORE INTO bookmarks VALUES(?,?)').run(id,req.user.id)}db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}res.json({count});
 });
 const files=['index.html','app.js','account.js','photos.js','style.css','legacy-export.html'];
 for(const file of files)app.get('/'+(file==='index.html'?'':file),(req,res)=>res.sendFile(path.join(__dirname,file)));
 app.get('/index.html',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
 app.use('/api',(req,res)=>res.status(404).json({error:'요청을 찾을 수 없습니다.'}));
 app.use((err,req,res,next)=>{if(!err.status)console.error(err);res.status(err.status||500).json({error:err.status?err.message:'서버에서 오류가 발생했습니다.'})});
 return {app,db};
}
if(require.main===module){const {app}=createApp();app.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log('한끼노트: http://localhost:'+(process.env.PORT||3000)))}
module.exports={createApp};
