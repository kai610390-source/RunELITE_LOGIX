/* SurfaceStride Pixel Trail Lab v17
 * Small, supervised browser-local segmentation network: 16 context features
 * -> 18 hidden units -> pixel trail probability. No auto-route authority.
 * Examples and weights stay in localStorage; browser-independent dataset
 * export is supported. This is NOT a pretrained satellite foundation model.
 */
(function(){
'use strict';
const KEY='surfacestride.trail.pixel-segmentation.v1';
const FEATURES=16,HIDDEN=18,MAX_EXAMPLES=12000,WORK=224;
let examples=[],weights=null,iterations=0,images=new Set();
function storageGet(){
 try{const s=JSON.parse(localStorage.getItem(KEY)||'null');
  if(s?.version!==1)return;
  examples=(Array.isArray(s.examples)?s.examples:[]).filter(e=>
   (e.y===0||e.y===1)&&Array.isArray(e.x)&&e.x.length===FEATURES&&
   e.x.every(Number.isFinite)).slice(-MAX_EXAMPLES);
  images=new Set(examples.map(e=>String(e.group||'')));
  if(s.weights?.w1?.length===FEATURES*HIDDEN&&s.weights?.w2?.length===HIDDEN&&
   s.weights.b1?.length===HIDDEN&&Number.isFinite(s.weights.b2)&&
   [...s.weights.w1,...s.weights.b1,...s.weights.w2,s.weights.b2].every(Number.isFinite)){
   weights=s.weights;
  }
  iterations=Number.isFinite(s.iterations)?s.iterations:0;
 }catch(e){/* Disabled browser storage: still usable in current tab. */}
}
function save(){
 try{localStorage.setItem(KEY,JSON.stringify({
  version:1,examples,weights,iterations
 }));return true;}catch(e){return false;}
}
function initWeights(){
 const w1=[],w2=[],b1=Array(HIDDEN).fill(0);
 for(let i=0;i<FEATURES*HIDDEN;i++)
  w1.push(Math.sin((i+11)*12.9898)*.09);
 for(let i=0;i<HIDDEN;i++)w2.push(Math.cos((i+17)*7.321)*.12);
 return {w1,b1,w2,b2:0};
}
const lim=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function sample(r,x,y){
 const xx=Math.max(0,Math.min(r.width-1,Math.round(x))),
  yy=Math.max(0,Math.min(r.height-1,Math.round(y))),
  i=(yy*r.width+xx)*4;
 const R=r.data[i]/255,G=r.data[i+1]/255,B=r.data[i+2]/255;
 return [R,G,B,.2126*R+.7152*G+.0722*B,
  lim((G-Math.max(R,B))*2),lim((R-G)*2)];
}
function extract(r,x,y){
 const c=sample(r,x,y),n3=sample(r,x,y-3),s3=sample(r,x,y+3),
  w3=sample(r,x-3,y),e3=sample(r,x+3,y),
  n10=sample(r,x,y-10),s10=sample(r,x,y+10),
  w10=sample(r,x-10,y),e10=sample(r,x+10,y);
 const local=[n3,s3,w3,e3],outer=[n10,s10,w10,e10];
 const mean=(a,k)=>a.reduce((n,z)=>n+z[k],0)/a.length;
 const close=mean(local,3),far=mean(outer,3);
 const nearVar=Math.sqrt(mean(local.map(a=>[(a[3]-close)**2]),0));
 const edge=Math.max(Math.abs(n3[3]-s3[3]),Math.abs(w3[3]-e3[3]));
 const line=Math.max(0,
  Math.min(Math.abs(c[3]-n3[3]),Math.abs(c[3]-s3[3])),
  Math.min(Math.abs(c[3]-w3[3]),Math.abs(c[3]-e3[3])));
 const vegetation=mean(local,4),farVeg=mean(outer,4);
 return [c[0],c[1],c[2],c[3],c[4],c[5],
  lim(Math.max(c[0],c[1],c[2])-Math.min(c[0],c[1],c[2])),
  close,far,lim(nearVar*3),lim(Math.abs(close-far)*3),
  lim(line*3),lim(edge*2),vegetation,farVeg,
  lim(Math.abs(c[3]-far)*2)];
}
function counts(){
 return {positive:examples.filter(e=>e.y===1).length,
  negative:examples.filter(e=>e.y===0).length,
  images:images.size,trained:iterations>0&&!!weights,
  iterations,examples:examples.length};
}
function ready(){
 const c=counts();
 return c.trained&&c.positive>=90&&c.negative>=90;
}
function forward(x,w){
 const h=new Float32Array(HIDDEN);
 for(let j=0;j<HIDDEN;j++){
  let z=w.b1[j];
  for(let i=0;i<FEATURES;i++)z+=x[i]*w.w1[i*HIDDEN+j];
  h[j]=Math.tanh(z);
 }
 let z=w.b2;
 for(let j=0;j<HIDDEN;j++)z+=h[j]*w.w2[j];
 return {h,p:1/(1+Math.exp(-Math.max(-25,Math.min(25,z))))};
}
function predictFeatures(x){
 return weights?forward(x,weights).p:0;
}
function addAnnotated(raster,mask,{group=Date.now().toString(36),maxPerClass=700}={}){
 if(!raster?.data||raster.width*raster.height*4>raster.data.length||
 !mask||mask.length!==raster.width*raster.height)
  throw Error('Aerial image and painted mask must have matching dimensions.');
 const positive=[],negative=[];
 for(let y=2;y<raster.height-2;y+=2)
  for(let x=2;x<raster.width-2;x+=2){
   const label=mask[y*raster.width+x];
   if(label===1)positive.push([x,y]);
   else if(label===2)negative.push([x,y]);
  }
 if(positive.length<4||negative.length<4)
  throw Error('Paint several trail pixels AND several non-trail pixels before training.');
 const batch=[];
 for(const [locations,y] of [[positive,1],[negative,0]]){
  const take=Math.min(maxPerClass,locations.length);
  for(let i=0;i<take;i++){
   const point=locations[Math.floor((i+.5)*locations.length/take)];
   batch.push({x:extract(raster,point[0],point[1]),y,group:String(group)});
  }
 }
 examples=examples.concat(batch).slice(-MAX_EXAMPLES);
 images=new Set(examples.map(e=>String(e.group||'')));
 save();
 return {added:batch.length,positive:positive.length,negative:negative.length,counts:counts()};
}
function train({epochs=16,rate=.023}={}){
 const c=counts();
 if(c.positive<20||c.negative<20)throw Error('Need trail and non-trail examples first.');
 weights=weights||initWeights();
 const positives=examples.filter(e=>e.y===1);
 const negatives=examples.filter(e=>e.y===0);
 const length=Math.min(2500,Math.max(positives.length,negatives.length));
 let loss=0;
 for(let epoch=0;epoch<Math.max(1,Math.min(40,epochs));epoch++){
  loss=0;
  for(let k=0;k<length*2;k++){
   const y=k%2;
   const arr=y?positives:negatives;
   const index=(k*811+epoch*197+Math.floor(k/3)*113)%arr.length;
   const ex=arr[index],q=forward(ex.x,weights);
   const err=q.p-y;
   loss+=-(y*Math.log(Math.max(1e-6,q.p))+
    (1-y)*Math.log(Math.max(1e-6,1-q.p)));
   const old2=weights.w2.slice();
   for(let j=0;j<HIDDEN;j++){
    const derivative=(1-q.h[j]*q.h[j])*err*old2[j];
    for(let i=0;i<FEATURES;i++)
     weights.w1[i*HIDDEN+j]-=rate*(derivative*ex.x[i]+.0001*weights.w1[i*HIDDEN+j]);
    weights.b1[j]-=rate*derivative;
    weights.w2[j]-=rate*(err*q.h[j]+.0001*weights.w2[j]);
   }
   weights.b2-=rate*err;
  }
 }
 iterations+=Math.max(1,Math.min(40,epochs));
 save();
 return {loss:loss/(length*2),...counts()};
}
function resize(r,n=WORK){
 if(r.width===n&&r.height===n)return r;
 const d=new Uint8ClampedArray(n*n*4);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const yy=Math.min(r.height-1,Math.round((y+.5)*r.height/n-.5));
  const xx=Math.min(r.width-1,Math.round((x+.5)*r.width/n-.5));
  const i=(yy*r.width+xx)*4,j=(y*n+x)*4;
  d[j]=r.data[i];d[j+1]=r.data[i+1];d[j+2]=r.data[i+2];d[j+3]=255;
 }
 return {width:n,height:n,data:d};
}
function probabilities(raster,{size=WORK}={}){
 if(!ready())throw Error('Train with trail and non-trail paint examples before segmentation.');
 const r=resize(raster,size),p=new Float32Array(r.width*r.height);
 for(let y=3;y<r.height-3;y++)for(let x=3;x<r.width-3;x++)
  p[y*r.width+x]=predictFeatures(extract(r,x,y));
 return {width:r.width,height:r.height,data:p};
}
function hysteresis(prob,{high=.70,low=.46}={}){
 const {width:w,height:h,data:p}=prob,out=new Uint8Array(w*h);
 const queue=[];
 for(let i=0;i<p.length;i++)if(p[i]>=high){out[i]=1;queue.push(i);}
 for(let head=0;head<queue.length;head++){
  const i=queue[head],x=i%w,y=Math.floor(i/w);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;
   const nx=x+dx,ny=y+dy;
   if(nx<1||ny<1||nx>=w-1||ny>=h-1)continue;
   const j=ny*w+nx;
   if(!out[j]&&p[j]>=low){out[j]=1;queue.push(j);}
  }
 }
 return {width:w,height:h,data:out};
}
function thin(mask,maxRounds=24){
 const {width:w,height:h}=mask,m=new Uint8Array(mask.data),n=w*h;
 const index=(x,y)=>y*w+x;
 function neighbors(i){
  const a=i-w,b=i+w;
  return [m[a],m[a+1],m[i+1],m[b+1],m[b],m[b-1],m[i-1],m[a-1]];
 }
 for(let round=0;round<maxRounds;round++){
  let removed=0;
  for(let pass=0;pass<2;pass++){
   const drop=[];
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=index(x,y);if(!m[i])continue;
    const p=neighbors(i),count=p.reduce((a,b)=>a+b,0);
    if(count<2||count>6)continue;
    let transitions=0;for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])transitions++;
    if(transitions!==1)continue;
    if(pass===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):
       (p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
    drop.push(i);
   }
   for(const i of drop)m[i]=0;
   removed+=drop.length;
  }
  if(!removed)break;
 }
 return {width:w,height:h,data:m};
}
function trace(skeleton,prob,{minPixels=12,maxPaths=70}={}){
 const w=skeleton.width,h=skeleton.height,m=skeleton.data,p=prob.data,
  visited=new Set(),paths=[],dirs=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
 const neigh=i=>{
  const x=i%w,y=(i/w)|0,n=[];
  for(const [dx,dy] of dirs){
   const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
   const j=yy*w+xx;if(m[j])n.push(j);
  }
  return n;
 };
 const hash=(a,b)=>a<b?a*w*h+b:b*w*h+a;
 const degree=new Uint8Array(w*h);
 const points=[];
 for(let i=w;i<m.length-w;i++)if(m[i]){degree[i]=neigh(i).length;points.push(i);}
 // Start from endpoints first, then junctions, and finally cycles.
 const ordered=points.slice().sort((a,b)=>{
  const pri=d=>d===1?0:d>2?1:2;
  return pri(degree[a])-pri(degree[b]);
 });
 for(const start of ordered){
  if(paths.length>=maxPaths)break;
  for(const next of neigh(start)){
   if(visited.has(hash(start,next)))continue;
   const chain=[start,next];visited.add(hash(start,next));
   let previous=start,current=next,guard=0;
   while(guard++<5000){
    const possible=neigh(current).filter(j=>j!==previous&&!visited.has(hash(current,j)));
    if(!possible.length)break;
    const ax=current%w-previous%w,ay=Math.floor(current/w)-Math.floor(previous/w);
    possible.sort((a,b)=>{
     const metric=j=>{const dx=j%w-current%w,dy=Math.floor(j/w)-Math.floor(current/w);
      return (ax*dx+ay*dy)/(Math.hypot(ax,ay)*Math.hypot(dx,dy)||1)};
     return metric(b)-metric(a);
    });
    const following=possible[0];
    visited.add(hash(current,following));chain.push(following);
    previous=current;current=following;
    if(current===start)break;
   }
   if(chain.length<minPixels)continue;
   let confidence=0;
   for(const i of chain)confidence+=p[i]||0;
   confidence/=chain.length;
   if(confidence<.57)continue;
   const simplified=[];
   for(let i=0;i<chain.length;i+=Math.max(1,Math.floor(chain.length/80))){
    const idx=chain[i];simplified.push({x:idx%w,y:Math.floor(idx/w)});
   }
   const last=chain[chain.length-1],end={x:last%w,y:Math.floor(last/w)};
   if(!simplified.length||simplified[simplified.length-1].x!==end.x||
    simplified[simplified.length-1].y!==end.y)simplified.push(end);
   paths.push({points:simplified,pixels:chain.length,confidence,
    score:confidence,kind:'predicted continuous trail',source:'pixel-segmentation'});
  }
 }
 return paths.sort((a,b)=>b.pixels-a.pixels);
}
function segment(raster,{size=WORK,high=.70,low=.46,maxPaths=60}={}){
 const p=probabilities(raster,{size});
 const mask=hysteresis(p,{high,low});
 const skeleton=thin(mask);
 const lines=trace(skeleton,p,{maxPaths});
 return {paths:lines,probabilities:p,mask,skeleton,
  confidence:'experimental; human review required'};
}
function exportData(){
 return JSON.stringify({version:1,examples,weights,iterations},null,2);
}
function importData(text,{replace=false}={}){
 let item;try{item=JSON.parse(text)}catch(e){throw Error('Invalid JSON dataset');}
 if(item?.version!==1||!Array.isArray(item.examples))throw Error('Not a Pixel Trail Lab dataset');
 const imported=item.examples.filter(e=>(e.y===0||e.y===1)&&
  Array.isArray(e.x)&&e.x.length===FEATURES&&e.x.every(Number.isFinite)).slice(-MAX_EXAMPLES);
 if(!imported.length)throw Error('No valid labeled pixels in the file');
 examples=(replace?imported:examples.concat(imported)).slice(-MAX_EXAMPLES);
 images=new Set(examples.map(e=>String(e.group||'')));
 // Merged datasets require retraining. In replace mode, accept weights only
 // when their shapes match and all values are finite.
 weights=null;iterations=0;
 if(replace&&item.weights?.w1?.length===FEATURES*HIDDEN&&
 item.weights?.w2?.length===HIDDEN&&item.weights?.b1?.length===HIDDEN&&
 Number.isFinite(item.weights?.b2)&&
 [...item.weights.w1,...item.weights.w2,...item.weights.b1].every(Number.isFinite)){
  weights=item.weights;iterations=Math.max(0,Number(item.iterations)||0);
 }
 save();return counts();
}
function reset(){
 examples=[];weights=null;iterations=0;images=new Set();save();
}
storageGet();
window.SurfaceStrideTrailSegmentation={
 counts,ready,extract,addAnnotated,train,predictFeatures,probabilities,segment,
 exportData,importData,reset,_test:{resize,hysteresis,thin,trace,initWeights,forward}};
})();