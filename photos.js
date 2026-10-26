let recipePhoto='',photoBusy=false,photoRequest=0;
function refreshPhotoPreview(){
 const preview=$('#photo-preview'),src=photoSource(recipePhoto);
 preview.hidden=!src;if(src)preview.src=src;else preview.removeAttribute('src');
 $('#remove-photo').hidden=!src;
}
function resetRecipePhoto(value=''){
 photoRequest++;recipePhoto=value;photoBusy=false;
 $('#photo-library').value='';$('#photo-camera').value='';
 $('#photo-error').textContent='';$('#photo-status').textContent='';
 $('#recipe-form .submit').disabled=false;refreshPhotoPreview();
}
async function compressRecipePhoto(file){
 if(!file.type.startsWith('image/'))throw new Error('사진 파일을 선택해주세요.');
 if(file.size>20*1024*1024)throw new Error('20MB 이하의 사진을 선택해주세요.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;
  try{await image.decode()}catch{throw new Error('사진을 읽을 수 없어요. JPG, PNG 또는 WebP 사진으로 다시 선택해주세요.')}
  if(!image.naturalWidth||!image.naturalHeight)throw new Error('올바른 사진을 선택해주세요.');
  const scale=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('사진을 처리할 수 없는 브라우저입니다.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  let result=canvas.toDataURL('image/jpeg',.82);
  for(const quality of [.7,.55,.4]){if(result.length<=700000)break;result=canvas.toDataURL('image/jpeg',quality)}
  if(result.length>700000){
   const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(canvas.width*.65));smaller.height=Math.max(1,Math.round(canvas.height*.65));
   const smallContext=smaller.getContext('2d');if(!smallContext)throw new Error('사진을 처리하지 못했어요.');
   smallContext.drawImage(canvas,0,0,smaller.width,smaller.height);result=smaller.toDataURL('image/jpeg',.65);
  }
  if(result.length>700000)throw new Error('사진 용량을 충분히 줄이지 못했어요. 더 작은 사진을 선택해주세요.');
  return result;
 }finally{URL.revokeObjectURL(url)}
}
async function selectRecipePhoto(event){
 const input=event.target,file=input.files?.[0];if(!file)return;
 const request=++photoRequest;photoBusy=true;$('#photo-error').textContent='';$('#photo-status').textContent='사진을 준비하고 있어요…';$('#recipe-form .submit').disabled=true;
 try{
  const result=await compressRecipePhoto(file);if(request!==photoRequest)return;
  recipePhoto=result;refreshPhotoPreview();$('#photo-status').textContent='사진이 준비되었습니다. 레시피를 저장하면 함께 등록됩니다.';
 }catch(error){if(request===photoRequest){$('#photo-error').textContent=error.message||'사진을 처리하지 못했어요.';$('#photo-status').textContent=''}}
 finally{input.value='';if(request===photoRequest){photoBusy=false;$('#recipe-form .submit').disabled=false}}
}
$('#photo-library').onchange=selectRecipePhoto;$('#photo-camera').onchange=selectRecipePhoto;
$('#remove-photo').onclick=()=>resetRecipePhoto();
