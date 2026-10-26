const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
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

module.exports={text,validateRecipe,fail};
