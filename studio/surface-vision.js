/* SurfaceStride Surface Trainer.
 * A small browser-local, user-trained color/texture nearest-neighbor model.
 * Uses public NAIP imagery or user-owned imagery. Not a pre-trained neural net.
 * AI predictions are advisory; strict routes use OSM tags or user confirmation.
 */
(function(){
'use strict';
const R=6378137,LABELS=['gravel','dirt','grass','paved','tree','building','unknown'];
const TRAIN='surfacestride.studio.vision.examples.v1';
const REVIEWS='surfacestride.studio.vision.reviewedSegments.v1';
const CONNECTORS='surfacestride.studio.vision.confirmedConnectors.v1';
const SERVICE='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
function get(k,fallback){
 try{const data=JSON.parse(localStorage.getItem(k)||'null');
  return data&&typeof data==='object'?data:fallback;
 }catch(e){return fallback;}
}
function store(k,v){
 try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;}
}
let examples=get(TRAIN,[]);
if(!Array.isArray(examples))examples=[];
examples=examples.filter(x=>LABELS.includes(x.label)&&Array.isArray(x.vector)&&x.vector.length===24).slice(-350);
let reviews=get(REVIEWS,{});
if(Array.isArray(reviews)||!reviews||typeof reviews!=='object')reviews={};
let connectors=get(CONNECTORS,[]);
if(!Array.isArray(connectors))connectors=[];
function surfaceKey(segment){
 if(segment?.segmentKey)return segment.segmentKey;
 if(Number.isFinite(Number(segment?.id))&&Number.isFinite(Number(segment?.nodeA))&&Number.isFinite(Number(segment?.nodeB))){
  return String(segment.id)+':'+Math.min(Number(segment.nodeA),Number(segment.nodeB))+':'+
    Math.max(Number(segment.nodeA),Number(segment.nodeB));
 }
 return null;
}
function features(imageData){
 const data=imageData.data||imageData;
 const w=imageData.width,h=imageData.height;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<24||h<24||data.length<w*h*4)throw Error('Invalid image patch.');
 const sums=new Array(24).fill(0);
 function region(radius,index){
  let n=0,sumR=0,sumG=0,sumB=0,sumL=0,sumL2=0,sumS=0,
    green=0,brown=0,light=0,dark=0,edges=0,st=0;
  const x0=Math.max(2,Math.floor(w/2-radius)),x1=Math.min(w-2,Math.ceil(w/2+radius));
  const y0=Math.max(2,Math.floor(h/2-radius)),y1=Math.min(h-2,Math.ceil(h/2+radius));
  for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
   const z=(y*w+x)*4,r=data[z]/255,g=data[z+1]/255,b=data[z+2]/255;
   const l=.2126*r+.7152*g+.0722*b,mx=Math.max(r,g,b),mn=Math.min(r,g,b);
   const sat=(mx-mn)/Math.max(.05,mx),rnext=data[z+8]/255,gbelow=data[z+8*w+1]/255;
   sumR+=r;sumG+=g;sumB+=b;sumL+=l;sumL2+=l*l;sumS+=sat;
   green+=g>r*1.12&&g>b*1.14?1:0;
   brown+=r>g*1.12&&g>b*1.05?1:0;
   light+=l>.67?1:0;dark+=l<.30?1:0;
   edges+=Math.min(1,(Math.abs(r-rnext)+Math.abs(g-gbelow))*2);
   st+=Math.abs(r-g)+Math.abs(g-b);n++;
  }
  n=Math.max(1,n);
  const v=sumL/n,contrast=Math.sqrt(Math.max(0,sumL2/n-v*v));
  const base=index*12;
  sums[base+0]=sumR/n;sums[base+1]=sumG/n;sums[base+2]=sumB/n;
  sums[base+3]=v;sums[base+4]=contrast;sums[base+5]=sumS/n;
  sums[base+6]=green/n;sums[base+7]=brown/n;
  sums[base+8]=light/n;sums[base+9]=dark/n;
  sums[base+10]=edges/n;sums[base+11]=st/n;
 }
 const r=Math.min(w,h);region(Math.max(7,Math.floor(r*.035)),0);
 region(Math.max(15,Math.floor(r*.13)),1);
 return sums.map(x=>Number(x.toFixed(5)));
}
function removeLastExample(){
 if(!examples.length)return false;
 const next=examples.slice(0,-1);
 if(!store(TRAIN,next))throw Error('Browser storage unavailable.');
 examples=next;return true;
}
function count(){
 const counts=Object.fromEntries(LABELS.map(l=>[l,0]));
 for(const x of examples)counts[x.label]++;
 return counts;
}
function addExample(vector,label,{source='NAIP',lat=null,lon=null}={}){
 if(!LABELS.includes(label))throw Error('Select a valid surface label.');
 if(!Array.isArray(vector)||vector.length!==24||!vector.every(Number.isFinite))throw Error('Invalid training sample.');
 const item={vector:vector.slice(),label,source,lat,lon,time:Date.now()};
 examples.push(item);examples=examples.slice(-350);
 if(!store(TRAIN,examples))throw Error('Browser storage is unavailable.');
 return count();
}
function predict(vector){
 if(!Array.isArray(vector)||vector.length!==24||!vector.every(Number.isFinite))
  throw Error('Invalid image features.');
 const counts=count(),active=Object.entries(counts).filter(([label,n])=>n>=2);
 const enough=examples.length>=8&&active.length>=2;
 if(!examples.length)return {
  label:null,confidence:0,trained:false,hasGuess:false,
  reason:'No labeled examples yet. Choose a category to teach the model its first surface.',
  counts};
 // Compare the closest examples WITHIN each class instead of letting
 // 8 grass examples drown out 1 corrected rooftop or tree example.
 const byClass=new Map(),weights=[1.5,1.5,1.5,1.2,2.2,1.2,2.6,2.6,1.5,1.5,2,1.2];
 for(const x of examples){
  let dd=0;
  for(let i=0;i<24;i++){
   const difference=vector[i]-x.vector[i];
   dd+=(difference*weights[i%12])**2;
  }
  const d=Math.sqrt(dd);
  if(!byClass.has(x.label))byClass.set(x.label,[]);
  byClass.get(x.label).push(d);
 }
 const votes={},closest=[];
 for(const [label,ds] of byClass){
  ds.sort((a,b)=>a-b);
  const best=ds[0],next=ds[1]??best;
  // One good roof/tree correction can contribute without a large class count.
  votes[label]=.72/((best+.13)**2)+.28/((next+.13)**2);
  closest.push({label,d:best});
 }
 closest.sort((a,b)=>a.d-b.d);
 const nearest=closest[0],sum=Object.values(votes).reduce((a,b)=>a+b,0);
 const [choice,score]=Object.entries(votes).sort((a,b)=>b[1]-a[1])[0];
 const agreement=sum?Math.min(1,score/sum):0;
 const looksDifferent=nearest.d>1.2;
 // A textured dark-green center and surroundings often indicate canopy
 // rather than smooth lawn. This is an explicitly tentative fallback.
 const canopy=(vector[6]>.55&&vector[18]>.55&&vector[3]<.56&&
  (vector[4]>.055||vector[16]>.055||vector[10]>.15||vector[22]>.15));
 // A flat gray aerial patch cannot reliably distinguish roofs from paved
 // roads from RGB alone. Prefer asking for a correction to making up certainty.
 const greyHardscape=(vector[5]<.115&&vector[17]<.12&&
  vector[6]<.12&&vector[4]<.04&&vector[10]<.11&&
  vector[3]>.32&&vector[3]<.88);
 const roofDistance=byClass.get('building')?.[0]??Infinity;
 const roadDistance=byClass.get('paved')?.[0]??Infinity;
 if(canopy&&choice!=='tree'&&(counts.tree===0||nearest.d>.35)){
  return {label:'tree',confidence:0,trained:enough,hasGuess:true,heuristic:true,
   reason:'Possible textured tree canopy (visual heuristic, NOT a trained or verified result).',counts};
 }
 if(greyHardscape&&(
    !Number.isFinite(roofDistance)||!Number.isFinite(roadDistance)||
    Math.abs(roofDistance-roadDistance)<.18)){
  return {label:'unknown',confidence:0,trained:enough,hasGuess:true,heuristic:true,
   reason:'Could be a building roof or a paved road. RGB texture alone cannot reliably separate them; please correct the category.',
   counts};
 }
 if(looksDifferent)return {
  label:'unknown',confidence:0,trained:enough,hasGuess:true,
  reason:'This image looks unlike the labeled examples. Please correct my guess.',
  counts,nearestDistance:nearest.d};
 return {label:choice,confidence:agreement,trained:enough,hasGuess:true,
  reason:enough?'Class-balanced image similarity. The displayed percentage is NOT accuracy.':
   'Early guess from '+examples.length+' examples. Add more tree and roof corrections to improve these classes.',
  counts,nearestDistance:nearest.d};

}
function review(segment,label){
 const key=surfaceKey(segment);
 if(!key)throw Error('Review a mapped trail segment first.');
 if(!LABELS.includes(label))throw Error('Invalid surface type.');
 reviews[key]={label,confirmed:true,source:'human-reviewed',time:Date.now()};
 if(!store(REVIEWS,reviews))throw Error('Browser storage unavailable.');
 return {key,label};
}
function getReviews(){return {...reviews};}
function reviewedCount(){return Object.keys(reviews).length;}
function getConnectors(){return connectors.slice();}
function saveConnector(points,label){
 if(!['gravel','dirt'].includes(label))throw Error('Connector must have a confirmed gravel or dirt label.');
 if(!Array.isArray(points)||points.length<2||points.length>100)throw Error('Trace 2–100 trail points.');
 const coords=points.map(p=>[Number(p.lat),Number(p.lon)]);
 if(!coords.every(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180))
  throw Error('Invalid traced path coordinates.');
 let length=0;for(let i=1;i<coords.length;i++){
  const lat=(coords[i][0]+coords[i-1][0])/2*Math.PI/180;
  length+=Math.hypot((coords[i][0]-coords[i-1][0])*111195,
   (coords[i][1]-coords[i-1][1])*111195*Math.cos(lat));
 }
 if(length<5||length>2000)throw Error('Review trails between 5 m and 2 km, in smaller sections if needed.');
 const item={id:'reviewed-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
  points:coords,label,confirmed:true,accessReviewed:true,time:Date.now()};
 const next=connectors.slice(-99).concat([item]);
 if(!store(CONNECTORS,next))throw Error('Browser storage is unavailable.');
 connectors=next;return item;
}
function removeReview(segment){
 const key=typeof segment==='string'?segment:surfaceKey(segment);
 if(key){delete reviews[key];store(REVIEWS,reviews);}
}
function merc(lon,lat){
 return {x:R*lon*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360))};
}
async function capture(lat,lon,{spanMeters=45,px=384,timeout=22000,preferOpenGround=false,onProgress=null,trailHint=null,trailFirst=false}={}){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)
  throw Error('Invalid patch center');
 if(lat<24||lat>50||lon< -125||lon> -66)throw Error('NAIP is currently supported in the contiguous US only.');
 // Allow wider contextual aerial crops in the random trainer (up to 1.2 km).
 const p=merc(lon,lat),half=Math.max(10,Math.min(600,spanMeters/2));
 const rasterService=window.SurfaceStrideImagery;
 if(!rasterService?.capture)throw Error('New public imagery services did not load. Refresh the page.');
 const result=await rasterService.capture({
  left:p.x-half,right:p.x+half,top:p.y+half,bottom:p.y-half
 },px,{timeoutPerSource:Math.min(8000,Math.max(4500,timeout/2)),onProgress});
 const {canvas,raster:data}=result;
 const imagerySource=result.source;
 const picker=window.SurfaceStrideGroundPicker;
 if(preferOpenGround&&!picker?.choose)throw Error('Open-ground scanner did not load. Refresh the trainer.');
 const trail=window.SurfaceStrideTrailFocus;
 let spot=null,candidates=[];
 if(trailFirst&&trail?.screenCandidates){
  const mapped=[];
  if(Array.isArray(trailHint?.mappedSegments)){
   const entries=trailHint.mappedSegments.slice(0,850);
   for(const seg of entries){
    for(const t of seg.length>80?[.25,.65]:[.5]){
     const point={lat:seg.a.lat*(1-t)+seg.b.lat*t,
      lon:seg.a.lon*(1-t)+seg.b.lon*t};
     const geo=merc(point.lon,point.lat);
     const x=(geo.x-(p.x-half))/(half*2)*px,
      y=((p.y+half)-geo.y)/(half*2)*px;
     if(x<32||y<32||x>px-32||y>px-32)continue;
     mapped.push({x,y,direction:{lat:seg.b.lat-seg.a.lat,
      lon:seg.b.lon-seg.a.lon},name:seg.name,weight:seg.confidence});
    }
   }
  }
  // A wider image can legitimately contain more trails. This is a maximum,
  // not a promise that every visible line will pass the safety heuristics.
  const maxCandidates=Math.max(4,Math.min(16,Math.round(3+spanMeters/65)));
  candidates=trail.screenCandidates(data,{mapped,maxCandidates});
  spot=candidates[0]||null;
 }
 if(!spot&&preferOpenGround&&!trailFirst)spot=picker.choose(data);
 if(preferOpenGround&&!spot&&!trailFirst){
  const err=new Error('This area is too tree-covered or ambiguous for a reliable clear-ground target.');
  err.code='NO_OPEN_GROUND';throw err;
 }
 // For the trail-first trainer, ambiguous imagery remains viewable but has
 // NO automatically selected marker or training vector. The user must
 // click the real trail or skip rather than label a tree or roof by accident.
 const needsClick=trailFirst&&!spot;
 const sample={vector:spot?picker.focus(data,spot.x,spot.y):needsClick?null:features(data),
  preview:canvas.toDataURL('image/jpeg',.91),lat,lon,source:'NAIP',
  patchMeters:half*2,imagerySource,note:'Public NAIP imagery, effective detail is limited by native acquisition resolution.',
  targetX:spot?spot.x/px:needsClick?null:.5,targetY:spot?spot.y/px:needsClick?null:.5,
  selection:spot?spot.source:needsClick?'manual-needed':'original-center',
  candidates:candidates.map((c,i)=>({x:c.x,y:c.y,score:c.score,
   source:c.source,name:c.name||null,rank:i+1,done:false})),
  mappedTrailName:trailHint?.trailAnchor?trailHint.trailName:null,
  _raster:preferOpenGround?data:null,
  _mercatorBounds:preferOpenGround?{left:p.x-half,right:p.x+half,top:p.y+half,bottom:p.y-half}:null};
 if(spot)picker.place(sample,spot.x/px,spot.y/px);
 // place recalculates focused features and center coordinates but not the
 // provenance of the automatic suggestion.
 if(spot)sample.selection=spot.source;
 return sample;
}
async function fromFile(file){
 if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>9000000)
  throw Error('Choose a PNG, JPEG or WebP image under 9 MB.');
 const url=URL.createObjectURL(file);
 try{
  const img=await new Promise((resolve,reject)=>{
   const i=new Image();
   i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Image could not be opened'));i.src=url;
  });
  const n=384,canvas=document.createElement('canvas');canvas.width=n;canvas.height=n;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const side=Math.min(img.naturalHeight,img.naturalWidth);
  ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,n,n);
  return {vector:features(ctx.getImageData(0,0,n,n)),preview:canvas.toDataURL('image/jpeg',.9),
   source:'user-owned image',lat:null,lon:null,patchMeters:null};
 }finally{URL.revokeObjectURL(url);}
}
function exportTraining(){
 // Only numerical features and human labels are exported, not aerial imagery.
 return {format:'SurfaceStride-NAIP-Features',version:1,created:new Date().toISOString(),
  examples:examples.map(x=>({label:x.label,vector:x.vector,source:x.source||'unknown'}))};
}
function importTraining(payload){
 if(!payload||payload.format!=='SurfaceStride-NAIP-Features'||!Array.isArray(payload.examples))
  throw Error('This is not a valid SurfaceStride training dataset.');
 if(payload.examples.length>1000)throw Error('Dataset exceeds the 1,000-example import limit.');
 const cleaned=[];
 for(const x of payload.examples){
  if(!LABELS.includes(x.label)||!Array.isArray(x.vector)||x.vector.length!==24||
     !x.vector.every(v=>Number.isFinite(v)&&v>=0&&v<=2))continue;
  cleaned.push({label:x.label,vector:x.vector.slice(),source:x.source||'imported',
   time:Date.now()});
 }
 if(!cleaned.length)throw Error('No valid labeled image features found.');
 const next=examples.concat(cleaned).slice(-350);
 if(!store(TRAIN,next))throw Error('Browser storage unavailable.');
 examples=next;return count();
}
window.SurfaceStrideVision={capture,fromFile,features,predict,count,addExample,removeLastExample,review,getReviews,
 reviewedCount,removeReview,surfaceKey,getConnectors,saveConnector,exportTraining,importTraining,
 _test:{merc,materialLabels:LABELS.slice(),clearMemory(){examples=[];reviews={};}}};
})();