const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server.cjs');
test('SQLite accounts, ownership, independent feedback, bookmarks, import and persistence',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hankki-test-')),file=path.join(folder,'test.sqlite');
 let service=createApp(file),server;
 async function listen(){server=service.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));return 'http://127.0.0.1:'+server.address().port}
 let base=await listen();
 async function request(url,method='GET',body,cookie=''){
  const response=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),Cookie:cookie},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const state=cookie=>request('/api/state','GET',undefined,cookie);
 try{
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
  assert.equal(service.db.prepare('SELECT count FROM search_counts WHERE term=?').get('pasta soup').count,2);
  assert.equal((await request('/api/recipes','POST',{})).status,401);
  const a=await request('/api/auth/signup','POST',{username:'alice',password:'password123',nickname:'앨리스'}),alice=a.cookie;
  assert.equal(a.status,200);assert.ok(alice);assert.ok(!JSON.stringify(a.data).includes('hash'));
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
  assert.equal(service.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  await new Promise(resolve=>server.close(resolve));service.db.close();
  service=createApp(file);base=await listen();
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
 }finally{await new Promise(resolve=>server.close(resolve));service.db.close();fs.rmSync(folder,{recursive:true,force:true})}
});
