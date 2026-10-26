const $ = (s) => document.querySelector(s);
const samples=[];
let custom=[],reviews=[],currentUser=null,bookmarks=[];
let editingRecipeId=null,activeRecipeId=null;
let category='전체',onlySaved=false,onlyMine=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeUrl(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
const fallback='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="450"><rect width="100%" height="100%" fill="#e9eddf"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="65">🍲</text></svg>');
function photoSource(value){return typeof value==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:safeUrl(value)}
function imageTag(r,cls=''){return `<img class="${cls}" src="${esc(photoSource(r.image)||fallback)}" alt="${esc(r.title)}" loading="lazy">`}
function fixImages(){document.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src=fallback})}
function notify(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').style.display='none',2600)}
function render(){
 $('#filters').innerHTML=['전체','한식','양식','중식','일식','디저트','기타'].map(c=>`<button class="filter ${c===category?'active':''}" data-category="${c}" aria-pressed="${c===category}">${c}</button>`).join('');
 const q=$('#search').value.trim().toLowerCase();let list=(onlyMine?custom.filter(r=>currentUser&&r.ownerId===currentUser.id):[...custom,...samples]).filter(r=>(category==='전체'||r.category===category)&&(!onlySaved||bookmarks.includes(r.id))&&(!q||[r.title,r.description,...r.ingredients].join(' ').toLowerCase().includes(q)));
 if($('#sort').value==='quick')list.sort((a,b)=>a.time-b.time);
 if($('#sort').value==='saved')list.sort((a,b)=>(b.saveCount||0)-(a.saveCount||0));
 if($('#sort').value==='rating')list.sort((a,b)=>feedbackStats(b.id).average-feedbackStats(a.id).average);
 if($('#sort').value==='comments')list.sort((a,b)=>feedbackStats(b.id).comments-feedbackStats(a.id).comments);
 $('#mine-count').textContent=custom.filter(r=>currentUser&&r.ownerId===currentUser.id).length;$('#saved-count').textContent=bookmarks.length;$('#result-count').textContent=`${q?'“'+q+'” 검색 결과 · ':''}총 ${list.length}개의 레시피`;
 $('#collection-title').textContent=onlyMine?'내가 등록한 레시피':onlySaved?'다시 꺼내 보고 싶은 맛':'어떤 맛을 찾고 있나요?';$('#explore').classList.toggle('active',!onlySaved&&!onlyMine);$('#saved').classList.toggle('active',onlySaved);$('#mine').classList.toggle('active',onlyMine);
 $('#empty h3').textContent=onlyMine&&!custom.length?'아직 등록한 레시피가 없어요':'아직 레시피가 없어요';
 $('#empty p').textContent=onlyMine&&!custom.length?'상단의 레시피 등록 버튼으로 첫 레시피를 남겨보세요.':'다른 검색어를 입력하거나 첫 레시피를 등록해보세요.';
 $('#grid').innerHTML=list.map(r=>`<article class="card"><div class="card-photo"><button class="open-card" data-open="${esc(r.id)}" aria-label="${esc(r.title)} 상세 보기">${imageTag(r)}<span class="badge">${r.type==='chef'?'요리사의 레시피':'우리의 레시피'}</span></button><button class="bookmark ${bookmarks.includes(r.id)?'selected':''}" data-bookmark="${esc(r.id)}" aria-label="${esc(r.title)} 저장" aria-pressed="${bookmarks.includes(r.id)}">${bookmarks.includes(r.id)?'♥':'♡'}</button></div><button class="open-card" data-open="${esc(r.id)}"><div class="card-body"><span class="card-category">${esc(r.category)}</span><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><div class="rating-summary">${ratingSummary(r.id)}</div><div class="meta"><span>◷ ${esc(r.time)}분</span><span>♧ ${esc(r.servings)}인분</span><span>◴ ${esc(r.level)}</span></div><div class="card-author"><span><span class="avatar">${esc(r.author?.slice(0,1))}</span>${esc(r.author)}</span><span class="recipe-kind">${r.type==='chef'?esc(r.creator)+' 원작':'직접 만든 레시피'}</span></div></div></button></article>`).join('');
 $('#empty').hidden=list.length>0;fixImages();
}
$('#filters').onclick=e=>{const b=e.target.closest('[data-category]');if(b){category=b.dataset.category;render()}};
function renderPopularSearches(items){
 const container=$('#popular-searches');container.hidden=!items.length;
 container.innerHTML='<span>자주 찾는 메뉴</span>'+items.slice(0,3).map(item=>`<button type="button" data-search="${esc(item.term)}"># ${esc(item.term)}</button>`).join('');
}
async function submitSearch(){
 const query=$('#search').value.trim();render();if(!query)return;
 try{const result=await api('/api/searches','POST',{query});renderPopularSearches(result.popularSearches)}catch(error){notify(error.message)}
}
$('#search-form').onsubmit=e=>{e.preventDefault();submitSearch()};$('#search').oninput=render;$('#sort').onchange=render;
$('#popular-searches').onclick=e=>{const button=e.target.closest('[data-search]');if(!button)return;$('#search').value=button.dataset.search;onlySaved=false;onlyMine=false;category='전체';submitSearch()};
function switchCollection(mine,saved){onlyMine=mine;onlySaved=saved;category='전체';$('#search').value='';render()}
$('#mine').onclick=()=>switchCollection(true,false);$('#saved').onclick=()=>switchCollection(false,true);$('#explore').onclick=()=>switchCollection(false,false);$('#reset').onclick=()=>{onlySaved=false;onlyMine=false;category='전체';$('#search').value='';render()};
$('#grid').onclick=async e=>{const b=e.target.closest('[data-bookmark]');if(b){if(!requireLogin())return;try{await api('/api/recipes/'+encodeURIComponent(b.dataset.bookmark)+'/bookmark','PUT',{saved:!bookmarks.includes(b.dataset.bookmark)});await loadState()}catch(error){notify(error.message)}return}const open=e.target.closest('[data-open]');if(open)showDetail(open.dataset.open)};
function showDetail(id){activeRecipeId=id;const r=[...custom,...samples].find(r=>r.id===id);if(!r)return;$('#detail-content').innerHTML=`${imageTag(r,'detail-photo')}<p class="card-category">${esc(r.category)} · ${r.type==='chef'?'요리사의 레시피':'나만의 레시피'}</p><h2>${esc(r.title)}</h2><p class="detail-description">${esc(r.description)}</p><p class="muted">${esc(r.author)} 님의 레시피 노트</p><div class="detail-meta"><span>◷ ${esc(r.time)}분</span><span>${esc(r.servings)}인분</span><span>난이도 ${esc(r.level)}</span></div><h3>준비할 재료</h3><ul class="ingredients">${r.ingredients.map(i=>`<li>${esc(i)}</li>`).join('')}</ul><h3>이렇게 만들어보세요</h3><ol class="steps">${r.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>${r.type==='chef'?`<p class="source">원작자: ${esc(r.creator)} · <a href="${esc(safeUrl(r.source))}" target="_blank" rel="noopener noreferrer">원본 레시피 보기 ↗</a></p>`:''}`;$('#detail-content').insertAdjacentHTML('beforeend',(currentUser&&r.ownerId===currentUser.id?'<div class="owner-actions"><button id="edit-recipe" class="secondary">레시피 수정</button><button id="delete-recipe" class="danger">레시피 삭제</button></div>':'')+reviewSection(id));if($('#edit-recipe'))$('#edit-recipe').onclick=()=>openRecipeEditor(r);if($('#delete-recipe'))$('#delete-recipe').onclick=()=>deleteRecipe(id);bindReviewForm(id);fixImages();if(!$('#detail').open)$('#detail').showModal()}
$('#add').onclick=()=>openRecipeEditor();document.querySelectorAll('dialog .close').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const box=d.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)d.close()}}));
$('#recipe-type').onchange=()=>{const isChef=$('#recipe-type').value==='chef';$('#source-fields').hidden=!isChef;['creator','source'].forEach(name=>$('#recipe-form').elements[name].required=isChef)};

function recipeReviews(id){return reviews.filter(r=>r.recipeId===id)}
function feedbackStats(id){const entries=recipeReviews(id),ratings=entries.filter(r=>r.rating>0);return {average:ratings.length?ratings.reduce((sum,r)=>sum+r.rating,0)/ratings.length:0,comments:entries.filter(r=>r.comment.trim()).length}}
function ratingSummary(id){const ratings=recipeReviews(id).filter(r=>r.rating>0);return ratings.length?'★ '+(ratings.reduce((sum,r)=>sum+r.rating,0)/ratings.length).toFixed(1)+' · 평가 '+ratings.length+'개':'☆ 아직 평가가 없어요'}
