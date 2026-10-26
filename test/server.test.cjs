const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createApp,createPool}=require('../server.cjs');
test('Neon username authentication, ownership and independent feedback',async()=>{
 const admin=createPool(),schema='hankki_test_'+randomUUID().replaceAll('-','');
 await admin.query('CREATE SCHEMA '+schema);
 const qualify=sql=>sql.replace(/(?<![.\w])(users|sessions|recipes|ratings|comments|bookmarks|imports|search_counts)\b/g,schema+'.$1');
 const isolated={query:(sql,params)=>admin.query(qualify(sql),params),on:()=>{},connect:async()=>{const c=await admin.connect();return {query:(sql,params)=>c.query(qualify(sql),params),release:()=>c.release()}}};
 let service=createApp({pool:isolated}),server;
 async function listen(){server=service.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));return 'http://127.0.0.1:'+server.address().port}
 let base=await listen();
 async function request(url,method='GET',body,cookie=''){
  const response=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),Cookie:cookie},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const state=cookie=>request('/api/state','GET',undefined,cookie);
 try{
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/app.js')).status,200);
  assert.equal((await state()).data.user,null);
  for(const secretPath of ['/.env','/server.cjs','/package.json','/data/hankki.sqlite'])assert.equal((await fetch(base+secretPath)).status,404);
  for(const [url,method] of [['/api/recipes','POST'],['/api/recipes/r1','PUT'],['/api/recipes/r1','DELETE'],['/api/recipes/r1/rating','PUT'],['/api/recipes/r1/rating','DELETE'],['/api/recipes/r1/comment','PUT'],['/api/recipes/r1/comment','DELETE'],['/api/recipes/r1/bookmark','PUT'],['/api/import','POST']])assert.equal((await request(url,method,{})).status,401);
  assert.equal((await request('/api/auth/signup','POST',{username:'bad@id',password:'password123',nickname:'이름'})).status,400);
  assert.equal((await state()).data.recipes.length,6);
  assert.deepEqual((await state()).data.popularSearches,[]);
  assert.equal((await request('/api/searches','POST',{query:'   '})).status,400);
  assert.equal((await request('/api/searches','POST',{query:'a'.repeat(61)})).status,400);
  for(const query of ['김치',' 김치 ','김치','파스타','파스타','볶음밥','된장찌개']){
   assert.equal((await request('/api/searches','POST',{query})).status,200);
  }
  let popular=(await state()).data.popularSearches;
  assert.equal(popular.length,3);assert.equal(popular[0].term,'김치');assert.equal(popular[0].count,3);
  assert.equal(popular[1].term,'파스타');assert.equal(popular[1].count,2);
  await request('/api/searches','POST',{query:' ＰＡＳＴＡ   soup '});
  await request('/api/searches','POST',{query:'pasta soup'});
  assert.equal(Number((await isolated.query('SELECT count FROM search_counts WHERE term=$1',['pasta soup'])).rows[0].count),2);
  assert.equal((await request('/api/recipes','POST',{})).status,401);
  const a=await request('/api/auth/signup','POST',{username:'alice',password:'password123',nickname:'앨리스'}),alice=a.cookie;
  assert.equal(a.status,200);assert.ok(alice);assert.equal(a.data.user.username,'alice');assert.ok(!JSON.stringify(a.data).includes('hash'));
  assert.equal((await request('/api/auth/signup','POST',{username:' ALICE ',password:'password123',nickname:'중복'})).status,409);
  const signedIn=await request('/api/auth/login','POST',{username:' ALICE ',password:'password123'});assert.equal(signedIn.status,200);
  assert.equal((await state(alice+'tampered')).data.user,null);
  assert.equal((await request('/api/auth/login','POST',{username:'alice',password:'wrongpass'})).status,401);
  const b=await request('/api/auth/signup','POST',{username:'bob',password:'password123',nickname:'밥'}),bob=b.cookie;
  const body={title:'테스트 요리',description:'소개',category:'한식',time:15,servings:2,level:'쉬움',type:'own',ingredients:['밥'],steps:['볶기'],image:'data:image/jpeg;base64,YWJj',ownerId:b.data.user.id};
  const created=await request('/api/recipes','POST',body,alice),id=created.data.id;
  assert.equal(created.status,201);
  assert.equal((await state(alice)).data.recipes[0].ownerId,a.data.user.id);
  assert.equal((await request('/api/recipes/'+id,'PUT',body,bob)).status,403);
  assert.equal((await request('/api/recipes/'+id,'DELETE',{},bob)).status,403);
  assert.equal((await request('/api/recipes/'+id,'PUT',{...body,title:'수정된 요리'},alice)).status,200);
  await request('/api/recipes/'+id+'/rating','PUT',{rating:5},alice);
  await request('/api/recipes/'+id+'/rating','PUT',{rating:3},alice);
  await request('/api/recipes/'+id+'/comment','PUT',{comment:'후기'},alice);
  let feedback=(await state(alice)).data.reviews;
  assert.equal(feedback.length,1);assert.equal(feedback[0].rating,3);
  await request('/api/recipes/'+id+'/comment','DELETE',{},bob);
  assert.equal((await state()).data.reviews[0].comment,'후기');
  await request('/api/recipes/'+id+'/rating','DELETE',{},alice);
  assert.equal((await state()).data.reviews[0].comment,'후기');
  await request('/api/recipes/'+id+'/rating','PUT',{rating:4},alice);
  await request('/api/recipes/'+id+'/comment','DELETE',{},alice);
  assert.equal((await state()).data.reviews[0].rating,4);
  for(const cookie of [alice,bob])await request('/api/recipes/'+id+'/bookmark','PUT',{saved:true},cookie);
  await request('/api/recipes/'+id+'/bookmark','PUT',{saved:true},alice);
  assert.equal((await state()).data.recipes.find(r=>r.id===id).saveCount,2);
  const payload={legacyOwnerId:'old-user',recipes:[{...body,id:'old-r',ownerId:'old-user'}],reviews:[{ownerId:'old-user',recipeId:'old-r',rating:5,comment:'기존 후기'}],bookmarks:['old-r']};
  assert.equal((await request('/api/import','POST',payload,alice)).data.count,1);
  assert.equal((await request('/api/import','POST',payload,alice)).data.count,0);
  assert.equal((await isolated.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count,2);
  await new Promise(resolve=>server.close(resolve));
  service=createApp({pool:isolated});base=await listen();
  const persisted=(await state(alice)).data;
  assert.equal(persisted.popularSearches.length,3);assert.equal(persisted.popularSearches[0].term,'김치');assert.equal(persisted.popularSearches[0].count,3);
  assert.equal(persisted.user.id,a.data.user.id);assert.equal(persisted.recipes.find(r=>r.id===id).image,body.image);
  assert.equal(persisted.reviews.find(r=>r.recipeId===id).rating,4);
  assert.equal(persisted.recipes.find(r=>r.id===id).saveCount,2);
  assert.equal((await fetch(base+'/data/hankki.sqlite')).status,404);
  await request('/api/recipes/'+id,'DELETE',{},alice);
  assert.ok(!(await state(alice)).data.reviews.some(r=>r.recipeId===id));
  await request('/api/logout','POST',{},alice);
  assert.equal((await state(alice)).data.user,null);
  assert.equal((await request('/api/recipes','POST',body,alice)).status,401);

 }finally{await new Promise(resolve=>server.close(resolve));await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}
});
