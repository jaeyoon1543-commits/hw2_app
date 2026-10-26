// Browser-local prototype accounts. Production authorization requires a server.
let signupMode=false;
const owns = record => !!currentUser && record.ownerId===currentUser.id;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2);
function openLogin(){ $('#auth-error').textContent='';$('#auth').showModal(); }
function requireLogin(){if(currentUser)return true;openLogin();return false;}
function refreshAccount(){
 $('#account-name').textContent=currentUser?currentUser.nickname+' 님':'';
 $('#account-button').textContent=currentUser?'로그아웃':'로그인';
 render();
 if($('#detail').open&&activeRecipeId)showDetail(activeRecipeId);
}
async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256);
 return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
$('#auth .close').onclick=()=>$('#auth').close();
$('#account-button').onclick=()=>{
 if(!currentUser){openLogin();return}
 currentUser=null;sessionStorage.removeItem('hankki-session');$('#editor').close();editingRecipeId=null;refreshAccount();notify('로그아웃했습니다.');
};
$('#auth-toggle').onclick=()=>{
 signupMode=!signupMode;$('#auth-title').textContent=signupMode?'회원가입':'로그인';
 $('#auth-submit').textContent=signupMode?'가입하고 로그인':'로그인';
 $('#auth-toggle').textContent=signupMode?'로그인으로 전환':'회원가입으로 전환';
 $('#nickname-label').hidden=!signupMode;$('#auth-form').elements.nickname.required=signupMode;
 $('#auth-form').elements.password.autocomplete=signupMode?'new-password':'current-password';$('#auth-error').textContent='';
};
$('#auth-form').onsubmit=async e=>{
 e.preventDefault();const form=e.target;const username=form.elements.username.value.trim().toLowerCase();
 const password=form.elements.password.value;const nickname=form.elements.nickname.value.trim();
 if(!/^[a-z0-9_]{3,30}$/.test(username)||password.length<8||password.length>128){$('#auth-error').textContent='아이디 형식과 비밀번호 길이를 확인해주세요.';return}
 const mode=signupMode;$('#auth-submit').disabled=true;$('#auth-toggle').disabled=true;
 try{
  if(!crypto.subtle)throw new Error('Live Server의 localhost 주소에서 열어주세요.');
  // Re-read before writing so another tab's newly registered accounts are retained.
  accounts=read('hankki-accounts',[]);let account=accounts.find(a=>a.username===username);
  if(mode){
   if(!nickname||nickname.length>30)throw new Error('닉네임을 1~30자로 입력해주세요.');
   if(account)throw new Error('이미 사용 중인 아이디입니다.');
   const salt=uid();const hash=await passwordHash(password,salt);
   accounts=read('hankki-accounts',[]);
   if(accounts.some(a=>a.username===username))throw new Error('이미 사용 중인 아이디입니다.');
   account={id:uid(),username,nickname,salt,hash};
   if(!save('hankki-accounts',[...accounts,account]))return;
   accounts.push(account);
  }else{
   if(!account||await passwordHash(password,account.salt)!==account.hash)throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  sessionStorage.setItem('hankki-session',account.id);currentUser=account;form.reset();$('#auth').close();refreshAccount();notify('로그인되었습니다.');
 }catch(error){$('#auth-error').textContent=error.message||'로그인하지 못했습니다.'}
 finally{$('#auth-submit').disabled=false;$('#auth-toggle').disabled=false}
};

function openRecipeEditor(recipe=null){
 if(!requireLogin())return;
 if(recipe&&!owns(recipe)){notify('작성자만 수정할 수 있습니다.');return}
 const form=$('#recipe-form');form.reset();resetRecipePhoto(recipe?.image||'');editingRecipeId=recipe?recipe.id:null;
 if(recipe){for(const key of ['title','category','description','time','servings','level','type','creator','source'])if(form.elements[key])form.elements[key].value=recipe[key]??'';form.elements.ingredients.value=recipe.ingredients.join('\n');form.elements.steps.value=recipe.steps.join('\n')}
 $('#editor h2').textContent=recipe?'내 레시피 수정':'당신의 맛있는 비법을 나눠주세요.';
 $('#recipe-form .submit').textContent=recipe?'수정 내용 저장':'레시피 등록하기 ↗';
 $('#form-error').textContent='';$('#recipe-type').onchange();$('#editor').showModal();
}
$('#recipe-form').onsubmit=e=>{
 e.preventDefault();if(!requireLogin())return;if(photoBusy){$('#form-error').textContent='사진 처리가 끝난 뒤 저장해주세요.';return}
 const existing=editingRecipeId?custom.find(r=>r.id===editingRecipeId):null;
 if(editingRecipeId&&(!existing||!owns(existing))){notify('작성자만 수정할 수 있습니다.');return}
 const data=Object.fromEntries(new FormData(e.target));for(const key in data)data[key]=data[key].trim();
 const ingredients=data.ingredients.split('\n').map(x=>x.trim()).filter(Boolean),steps=data.steps.split('\n').map(x=>x.trim()).filter(Boolean);
 if(!data.title||!data.description||!ingredients.length||!steps.length){$('#form-error').textContent='음식 이름, 소개, 재료와 조리 방법을 입력해주세요.';return}
 if(data.type==='chef'&&(!data.creator||!safeUrl(data.source))){$('#form-error').textContent='원작자와 올바른 출처 링크를 입력해주세요.';return}
 const recipe={...data,image:recipePhoto,id:existing?existing.id:'user-'+uid(),ownerId:currentUser.id,author:currentUser.nickname,time:Number(data.time),servings:Number(data.servings),ingredients,steps};
 const next=existing?custom.map(r=>r.id===recipe.id?recipe:r):[recipe,...custom];
 if(!save('hankki-recipes',next))return;
 custom=next;$('#editor').close();editingRecipeId=null;onlySaved=false;onlyMine=true;category='전체';$('#search').value='';render();
 if($('#detail').open)showDetail(recipe.id);notify(existing?'레시피를 수정했습니다.':'레시피를 등록했습니다.');
};
function deleteRecipe(id){
 const recipe=custom.find(r=>r.id===id);if(!recipe||!owns(recipe)){notify('작성자만 삭제할 수 있습니다.');return}
 if(!confirm('이 레시피를 삭제할까요? 삭제 후 복구할 수 없습니다.'))return;
 const next=custom.filter(r=>r.id!==id);if(!save('hankki-recipes',next))return;custom=next;
 // Remove dependent local records after the recipe has been deleted.
 const nextReviews=reviews.filter(r=>r.recipeId!==id);if(save('hankki-reviews',nextReviews))reviews=nextReviews;
 const nextBookmarks=bookmarks.filter(x=>x!==id);if(save('hankki-bookmarks',nextBookmarks))bookmarks=nextBookmarks;
 $('#detail').close();activeRecipeId=null;render();notify('레시피를 삭제했습니다.');
}
function reviewForm(id,review=null){return `<form id="comment-form"><p class="muted">${esc(currentUser.nickname)} 님으로 댓글을 ${review?'수정':'등록'}합니다.</p><label>댓글<textarea name="comment" rows="3" required maxlength="1000" placeholder="요리 후기나 궁금한 점을 남겨주세요.">${esc(review?.comment||'')}</textarea></label><p id="comment-error" role="alert"></p><button class="primary" type="submit">${review?'댓글 수정 저장':'댓글 등록'}</button>${review?'<button class="secondary" type="button" id="cancel-comment">취소</button>':''}</form>`}
function reviewSection(id){
 const list=recipeReviews(id),comments=list.filter(r=>r.comment.trim()),mine=list.find(owns);
 return `<section class="reviews" aria-label="별점 평가"><h3>이 레시피를 평가해주세요</h3><p class="rating-summary">${ratingSummary(id)}</p>${currentUser?`<form id="rating-form"><fieldset class="star-picker"><legend>${mine?.rating?'내 별점 수정':'별점 선택'}</legend><div class="star-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}" required ${mine?.rating===n?'checked':''}><span>★ ${n}점</span></label>`).join('')}</div></fieldset><p id="rating-error" role="alert"></p><button type="submit" class="primary">${mine?.rating?'별점 수정 저장':'별점 등록'}</button>${mine?.rating?'<button type="button" class="danger" id="delete-rating">별점 삭제</button>':''}</form>`:'<p class="muted">로그인하면 별점을 남길 수 있어요.</p><button class="secondary" data-review-login>로그인</button>'}</section><section class="reviews" aria-label="댓글"><h3>요리 이야기 · 댓글 ${comments.length}개</h3><div id="review-editor">${!currentUser?'<p class="muted">로그인하고 댓글을 남겨보세요.</p><button class="secondary" data-review-login>로그인</button>':mine?.comment?'<p class="muted">내 댓글은 아래에서 수정하거나 삭제할 수 있어요.</p>':reviewForm(id)}</div><div class="review-list">${comments.length?comments.map(r=>`<article class="review"><div class="review-heading"><strong>${esc(r.author)}${owns(r)?' · 나':''}</strong></div><p>${esc(r.comment)}</p><time>${esc(r.date||'')}</time>${owns(r)?'<div class="owner-actions"><button class="secondary" id="edit-comment">댓글 수정</button><button class="danger" id="delete-comment">댓글 삭제</button></div>':''}</article>`).join(''):'<p class="muted">아직 댓글이 없어요. 첫 요리 이야기를 남겨보세요.</p>'}</div></section>`;
}
// A record retains independent rating/comment fields so existing data needs no migration.
function updateFeedback(id,patch){
 if(!currentUser)return false;
 const mine=recipeReviews(id).find(owns);
 const entry={recipeId:id,ownerId:currentUser.id,author:currentUser.nickname,comment:'',rating:0,...mine,...patch};
 const next=reviews.filter(r=>!(r.recipeId===id&&owns(r)));
 if(entry.comment||entry.rating)next.unshift(entry);
 if(!save('hankki-reviews',next))return false;
 reviews=next;render();showDetail(id);return true;
}
function bindReviewForm(id,editing=false){
 const mine=recipeReviews(id).find(owns);
 document.querySelectorAll('[data-review-login]').forEach(button=>button.onclick=openLogin);
 if($('#rating-form'))$('#rating-form').onsubmit=e=>{
  e.preventDefault();if(!requireLogin())return;
  const rating=Number(e.target.elements.rating.value);
  if(!Number.isInteger(rating)||rating<1||rating>5){$('#rating-error').textContent='1~5점 중 별점을 선택해주세요.';return}
  if(updateFeedback(id,{rating}))notify('별점을 저장했습니다.');
 };
 if($('#delete-rating'))$('#delete-rating').onclick=()=>{
  if(!currentUser||!recipeReviews(id).some(r=>owns(r)&&r.rating))return;
  if(confirm('내 별점을 삭제할까요?')&&updateFeedback(id,{rating:0}))notify('별점을 삭제했습니다. 댓글은 유지됩니다.');
 };
 if($('#edit-comment'))$('#edit-comment').onclick=()=>{
  if(!currentUser||!mine||!owns(mine))return;
  $('#review-editor').innerHTML=reviewForm(id,mine);bindReviewForm(id,true);$('#comment-form').scrollIntoView({block:'nearest'});
 };
 if($('#cancel-comment'))$('#cancel-comment').onclick=()=>showDetail(id);
 if($('#delete-comment'))$('#delete-comment').onclick=()=>{
  if(!currentUser||!recipeReviews(id).some(r=>owns(r)&&r.comment))return;
  if(confirm('내 댓글을 삭제할까요?')&&updateFeedback(id,{comment:'',date:''}))notify('댓글을 삭제했습니다. 별점은 유지됩니다.');
 };
 if($('#comment-form'))$('#comment-form').onsubmit=e=>{
  e.preventDefault();if(!requireLogin())return;
  const existing=recipeReviews(id).find(owns);
  if((existing?.comment&&!editing)||(!existing?.comment&&editing)){showDetail(id);return}
  const comment=e.target.elements.comment.value.trim();
  if(!comment||comment.length>1000){$('#comment-error').textContent='댓글을 1~1000자로 입력해주세요.';return}
  if(updateFeedback(id,{comment,date:new Date().toLocaleDateString('ko-KR')}))notify(editing?'댓글을 수정했습니다.':'댓글을 등록했습니다.');
 };
}
refreshAccount();
