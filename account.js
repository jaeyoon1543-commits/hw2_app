let signupMode=false;
const owns=record=>!!currentUser&&record.ownerId===currentUser.id;
function openLogin(){$('#auth-error').textContent='';$('#auth').showModal()}
function requireLogin(){if(currentUser)return true;openLogin();return false}
async function api(url,method='GET',body){let response;try{response=await fetch(url,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined})}catch{throw new Error('서버에 연결할 수 없습니다. start.ps1로 서버를 실행해주세요.')}let data;try{data=await response.json()}catch{throw new Error('SQLite 서버 주소 http://localhost:3000 에서 열어주세요.')}if(!response.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');return data}
async function loadState(){const state=await api('/api/state');currentUser=state.user;custom=state.recipes;reviews=state.reviews;bookmarks=state.bookmarks;renderPopularSearches(state.popularSearches||[]);refreshAccount()}
function refreshAccount(){$('#account-name').textContent=currentUser?currentUser.nickname+' 님':'';$('#account-button').textContent=currentUser?'로그아웃':'로그인';render();if($('#detail').open&&activeRecipeId){if(custom.some(r=>r.id===activeRecipeId))showDetail(activeRecipeId);else $('#detail').close()}}
$('#auth .close').onclick=()=>$('#auth').close();
$('#account-button').onclick=async()=>{if(!currentUser){openLogin();return}try{await api('/api/logout','POST',{});$('#editor').close();editingRecipeId=null;await loadState();notify('로그아웃했습니다.')}catch(e){notify(e.message)}};
$('#auth-toggle').onclick=()=>{signupMode=!signupMode;$('#auth-title').textContent=signupMode?'회원가입':'로그인';$('#auth-submit').textContent=signupMode?'가입하고 로그인':'로그인';$('#auth-toggle').textContent=signupMode?'로그인으로 전환':'회원가입으로 전환';$('#nickname-label').hidden=!signupMode;$('#auth-form').elements.nickname.required=signupMode;$('#auth-form').elements.password.autocomplete=signupMode?'new-password':'current-password';$('#auth-error').textContent=''};
$('#auth-form').onsubmit=async e=>{e.preventDefault();const f=e.target;$('#auth-submit').disabled=true;$('#auth-toggle').disabled=true;try{await api('/api/auth/'+(signupMode?'signup':'login'),'POST',{username:f.elements.username.value.trim(),password:f.elements.password.value,nickname:f.elements.nickname.value.trim()});f.reset();$('#auth').close();await loadState();notify('로그인되었습니다.')}catch(error){$('#auth-error').textContent=error.message}finally{$('#auth-submit').disabled=false;$('#auth-toggle').disabled=false}};
function openRecipeEditor(recipe=null){
 if(!requireLogin())return;
 if(recipe&&!owns(recipe)){notify('작성자만 수정할 수 있습니다.');return}
 const form=$('#recipe-form');form.reset();resetRecipePhoto(recipe?.image||'');editingRecipeId=recipe?recipe.id:null;
 if(recipe){for(const key of ['title','category','description','time','servings','level','type','creator','source'])if(form.elements[key])form.elements[key].value=recipe[key]??'';form.elements.ingredients.value=recipe.ingredients.join('\n');form.elements.steps.value=recipe.steps.join('\n')}
 $('#editor h2').textContent=recipe?'내 레시피 수정':'당신의 맛있는 비법을 나눠주세요.';
 $('#recipe-form .submit').textContent=recipe?'수정 내용 저장':'레시피 등록하기 ↗';
 $('#form-error').textContent='';$('#recipe-type').onchange();$('#editor').showModal();
}
$('#recipe-form').onsubmit=async e=>{e.preventDefault();if(!requireLogin()||photoBusy)return;const form=e.target;const data=Object.fromEntries(new FormData(form));for(const key in data)data[key]=data[key].trim();data.image=recipePhoto;data.ingredients=data.ingredients.split('\n').map(s=>s.trim()).filter(Boolean);data.steps=data.steps.split('\n').map(s=>s.trim()).filter(Boolean);const id=editingRecipeId;$('#recipe-form .submit').disabled=true;try{const result=await api(id?'/api/recipes/'+encodeURIComponent(id):'/api/recipes',id?'PUT':'POST',data);$('#editor').close();editingRecipeId=null;onlySaved=false;onlyMine=true;category='전체';$('#search').value='';await loadState();if($('#detail').open)showDetail(result.id);notify(id?'레시피를 수정했습니다.':'레시피를 등록했습니다.')}catch(error){$('#form-error').textContent=error.message}finally{$('#recipe-form .submit').disabled=false}};
async function deleteRecipe(id){if(!confirm('이 레시피를 삭제할까요? 댓글과 평가도 함께 삭제됩니다.'))return;try{await api('/api/recipes/'+encodeURIComponent(id),'DELETE',{});$('#detail').close();activeRecipeId=null;await loadState();notify('레시피를 삭제했습니다.')}catch(error){notify(error.message)}}
async function updateFeedback(id,patch){if(!requireLogin())return false;try{const rating='rating' in patch;const removing=rating?patch.rating===0:patch.comment==='';await api('/api/recipes/'+encodeURIComponent(id)+(rating?'/rating':'/comment'),removing?'DELETE':'PUT',patch);await loadState();return true}catch(error){notify(error.message);return false}}
function reviewForm(id,review=null){return `<form id="comment-form"><p class="muted">${esc(currentUser.nickname)} 님으로 댓글을 ${review?'수정':'등록'}합니다.</p><label>댓글<textarea name="comment" rows="3" required maxlength="1000" placeholder="요리 후기나 궁금한 점을 남겨주세요.">${esc(review?.comment||'')}</textarea></label><p id="comment-error" role="alert"></p><button class="primary" type="submit">${review?'댓글 수정 저장':'댓글 등록'}</button>${review?'<button class="secondary" type="button" id="cancel-comment">취소</button>':''}</form>`}
function reviewSection(id){
 const list=recipeReviews(id),comments=list.filter(r=>r.comment.trim()),mine=list.find(owns);
 return `<section class="reviews" aria-label="별점 평가"><h3>이 레시피를 평가해주세요</h3><p class="rating-summary">${ratingSummary(id)}</p>${currentUser?`<form id="rating-form"><fieldset class="star-picker"><legend>${mine?.rating?'내 별점 수정':'별점 선택'}</legend><div class="star-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}" required ${mine?.rating===n?'checked':''}><span>★ ${n}점</span></label>`).join('')}</div></fieldset><p id="rating-error" role="alert"></p><button type="submit" class="primary">${mine?.rating?'별점 수정 저장':'별점 등록'}</button>${mine?.rating?'<button type="button" class="danger" id="delete-rating">별점 삭제</button>':''}</form>`:'<p class="muted">로그인하면 별점을 남길 수 있어요.</p><button class="secondary" data-review-login>로그인</button>'}</section><section class="reviews" aria-label="댓글"><h3>요리 이야기 · 댓글 ${comments.length}개</h3><div id="review-editor">${!currentUser?'<p class="muted">로그인하고 댓글을 남겨보세요.</p><button class="secondary" data-review-login>로그인</button>':mine?.comment?'<p class="muted">내 댓글은 아래에서 수정하거나 삭제할 수 있어요.</p>':reviewForm(id)}</div><div class="review-list">${comments.length?comments.map(r=>`<article class="review"><div class="review-heading"><strong>${esc(r.author)}${owns(r)?' · 나':''}</strong></div><p>${esc(r.comment)}</p><time>${esc(r.date||'')}</time>${owns(r)?'<div class="owner-actions"><button class="secondary" id="edit-comment">댓글 수정</button><button class="danger" id="delete-comment">댓글 삭제</button></div>':''}</article>`).join(''):'<p class="muted">아직 댓글이 없어요. 첫 요리 이야기를 남겨보세요.</p>'}</div></section>`;
}
function bindReviewForm(id,editing=false){
 const mine=recipeReviews(id).find(owns);
 document.querySelectorAll('[data-review-login]').forEach(button=>button.onclick=openLogin);
 if($('#rating-form'))$('#rating-form').onsubmit=async e=>{
  e.preventDefault();if(!requireLogin())return;
  const rating=Number(e.target.elements.rating.value);
  if(!Number.isInteger(rating)||rating<1||rating>5){$('#rating-error').textContent='1~5점 중 별점을 선택해주세요.';return}
  if(await updateFeedback(id,{rating}))notify('별점을 저장했습니다.');
 };
 if($('#delete-rating'))$('#delete-rating').onclick=async()=>{
  if(!currentUser||!recipeReviews(id).some(r=>owns(r)&&r.rating))return;
  if(confirm('내 별점을 삭제할까요?')&&await updateFeedback(id,{rating:0}))notify('별점을 삭제했습니다. 댓글은 유지됩니다.');
 };
 if($('#edit-comment'))$('#edit-comment').onclick=async()=>{
  if(!currentUser||!mine||!owns(mine))return;
  $('#review-editor').innerHTML=reviewForm(id,mine);bindReviewForm(id,true);$('#comment-form').scrollIntoView({block:'nearest'});
 };
 if($('#cancel-comment'))$('#cancel-comment').onclick=()=>showDetail(id);
 if($('#delete-comment'))$('#delete-comment').onclick=async()=>{
  if(!currentUser||!recipeReviews(id).some(r=>owns(r)&&r.comment))return;
  if(confirm('내 댓글을 삭제할까요?')&&await updateFeedback(id,{comment:'',date:''}))notify('댓글을 삭제했습니다. 별점은 유지됩니다.');
 };
 if($('#comment-form'))$('#comment-form').onsubmit=async e=>{
  e.preventDefault();if(!requireLogin())return;
  const existing=recipeReviews(id).find(owns);
  if((existing?.comment&&!editing)||(!existing?.comment&&editing)){showDetail(id);return}
  const comment=e.target.elements.comment.value.trim();
  if(!comment||comment.length>1000){$('#comment-error').textContent='댓글을 1~1000자로 입력해주세요.';return}
  if(await updateFeedback(id,{comment,date:new Date().toLocaleDateString('ko-KR')}))notify(editing?'댓글을 수정했습니다.':'댓글을 등록했습니다.');
 };
}


$('#import-backup').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(!requireLogin()){e.target.value='';return}try{if(file.size>15*1024*1024)throw new Error('백업은 15MB 이하여야 합니다.');const payload=JSON.parse(await file.text());if(!confirm('백업의 레시피·댓글·별점을 현재 로그인한 계정으로 가져올까요?'))return;const result=await api('/api/import','POST',payload);await loadState();notify(result.count+'개의 레시피를 가져왔습니다.')}catch(error){notify(error.message)}finally{e.target.value=''}};
render();loadState().catch(error=>{$('#server-error').hidden=false;$('#server-error').textContent=error.message});
