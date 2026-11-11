/* Trail-aware aerial target detector.
 * A thin linear corridor is favored over roofs/trees. OSM anchor geometry
 * helps disambiguate but never proves surface/access.
 */
(function(){
'use strict';
function corridor(data,x,y,dx,dy){
 const w=data.width,h=data.height,rgba=data.data,nx=-dy,ny=dx;
 const sample=(px,py)=>{
  const ix=Math.round(px),iy=Math.round(py);
  if(ix<2||iy<2||ix>=w-2||iy>=h-2)return null;
  const i=(iy*w+ix)*4,r=rgba[i]/255,g=rgba[i+1]/255,b=rgba[i+2]/255;
  return {l:.2126*r+.7152*g+.0722*b,green:g>r*1.12&&g>b*1.12?1:0};
 };
 // Different pixel widths can reveal fine gravel/dirt strips or slightly
 // wider natural paths, including those with bare rather than green flanks.
 let best=null;
 for(const width of [4,7,12,18]){
  let cLight=0,c2=0,flank=0,cGreen=0,sGreen=0,vegTogether=0;
  let valid=0,twoSides=0,positive=0,negative=0,sideDiff=0;
  for(let t=-24;t<=24;t+=3){
   const px=x+dx*t,py=y+dy*t;
   const c=sample(px,py),l=sample(px+nx*width,py+ny*width),r=sample(px-nx*width,py-ny*width);
   if(!c||!l||!r)continue;
   const dl=c.l-l.l,dr=c.l-r.l;
   if(Math.abs(dl)>.065&&Math.abs(dr)>.065&&dl*dr>0){
    twoSides++;
    if(dl>0)positive++;else negative++;
   }
   sideDiff+=Math.abs(l.l-r.l);
   cLight+=c.l;c2+=c.l*c.l;flank+=(l.l+r.l)/2;
   cGreen+=c.green;sGreen+=(l.green+r.green)/2;
   if(l.green&&r.green&&!c.green)vegTogether++;
   valid++;
  }
  if(valid<10)continue;
  const contrast=Math.abs(cLight-flank)/valid;
  const greenContrast=(sGreen-cGreen)/valid;
  const together=vegTogether/valid;
  const centerStd=Math.sqrt(Math.max(0,c2/valid-(cLight/valid)**2));
  const bilateral=twoSides/valid;
  const consistency=Math.max(positive,negative)/valid;
  const symmetry=1-Math.min(1,sideDiff/valid/.19);
  // Green-flanked corridor OR narrow uniform line on both sides.
  // Building edges normally have contrast on only one side;
  // tree texture doesn't maintain a continuous two-sided stripe.
  const vegetated=contrast>.039&&greenContrast>.17&&together>.49&&centerStd<.11;
  const openLine=contrast>.11&&bilateral>.80&&consistency>.79&&
   symmetry>.55&&centerStd<.043;
  const passes=vegetated||openLine;
  const score=contrast*2.1+Math.max(0,greenContrast)*.72+
   (openLine?bilateral*.19:0)+symmetry*.08;
  const result={passes,score,contrast,greenContrast,
   bilateral,consistency,symmetry,centerStd,vegetated,openLine,width};
  if(!best||((result.passes?1:0)+result.score)>
             ((best.passes?1:0)+best.score))best=result;
  if(vegetated&&score>.55)break;
 }
 return best||{passes:false,score:-1,contrast:0,greenContrast:0};
}
function unitDirection(dir){
 if(!dir)return {x:0,y:1};
 const dx=Number(dir.lon)*Math.cos(30*Math.PI/180),dy=-Number(dir.lat);
 const mag=Math.hypot(dx,dy);
 return mag>1e-9?{x:dx/mag,y:dy/mag}:{x:0,y:1};
}
function anchored(data,dir){
 const {x:dx,y:dy}=unitDirection(dir),nx=-dy,ny=dx;
 let best=null;
 const w=data.width,h=data.height;
 for(let along=-33;along<=33;along+=6)for(let side=-24;side<=24;side+=3){
  const x=Math.round(w/2+along*dx+side*nx);
  const y=Math.round(h/2+along*dy+side*ny);
  const line=corridor(data,x,y,dx,dy);
  if(!line.passes)continue;
  // Favor the mapped centerline and reject a distant roof edge.
  const score=line.score-Math.abs(side)*.014-Math.abs(along)*.004;
  if(!best||score>best.score)best={x,y,score,source:'mapped-visible-trail',line};
 }
 return best&&best.score>.14?best:null;
}
function imageLine(data){
 const w=data.width,h=data.height,step=Math.max(4,Math.round(Math.min(w,h)/105));
 const margin=Math.round(Math.min(w,h)*.16),best=[];
 for(let y=margin;y<h-margin;y+=step)for(let x=margin;x<w-margin;x+=step){
  for(let i=0;i<8;i++){
   const angle=Math.PI*i/8,dx=Math.cos(angle),dy=Math.sin(angle);
   const line=corridor(data,x,y,dx,dy);
   if(!line.passes||(line.vegetated?line.contrast<.039:line.contrast<.10))continue;
   best.push({x,y,score:line.score,source:'possible-image-trail',line});
  }
 }
 if(!best.length)return null;
 best.sort((a,b)=>b.score-a.score);
 return best[Math.floor(Math.random()*Math.min(7,best.length))];
}

// Suggest multiple distinct trail-like locations across the ENTIRE aerial
// image, not just around the center. Visual detections are not ground truth.
function screenCandidates(data,{mapped=[],maxCandidates=8}={}){
 const w=data.width,h=data.height;
 if(w<120||h<120)return [];
 const max=Math.max(1,Math.min(40,Math.round(maxCandidates)));
 const raw=[];
 // Mapped path coordinates can appear anywhere in the camera footprint.
 // Keep only those that also show a visually convincing corridor.
 const anchors=(Array.isArray(mapped)?mapped:[]).slice(0,200);
 for(const p of anchors){
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
  const {x:dx,y:dy}=unitDirection(p.direction);
  const nx=-dy,ny=dx;
  let best=null;
  for(let along=-24;along<=24;along+=8)
   for(let side=-18;side<=18;side+=6){
    const x=Math.round(p.x+along*dx+side*nx),y=Math.round(p.y+along*dy+side*ny);
    if(x<34||x>w-34||y<34||y>h-34)continue;
    const line=corridor(data,x,y,dx,dy);
    if(!line.passes)continue;
    const score=line.score+.25-Math.abs(side)*.008-Math.abs(along)*.002;
    if(!best||score>best.score)best={x,y,score,dx,dy,
     source:'mapped-visible-trail',name:p.name||'Mapped footpath'};
   }
  if(best)raw.push(best);
 }
 // Search all of the visible frame, including off-center trails.
 // The margins are the minimum needed for our 24px corridor samples.
 const step=Math.max(7,Math.round(Math.min(w,h)/74)),margin=28;
 for(let y=margin;y<h-margin;y+=step)
  for(let x=margin;x<w-margin;x+=step){
   for(let a=0;a<8;a++){
    const angle=a*Math.PI/8,dx=Math.cos(angle),dy=Math.sin(angle);
    const line=corridor(data,x,y,dx,dy);
    if(!line.passes||(line.vegetated?line.contrast<.039:line.contrast<.10))continue;
    raw.push({x,y,score:line.score,dx,dy,source:'possible-image-trail'});
   }
  }
 if(!raw.length)return [];
 // Group detections belonging to the same straight/parallel narrow trail
 // while preserving candidates from other paths elsewhere in the image.
 raw.sort((a,b)=>b.score-a.score);
 const selected=[];
 const separation=Math.max(20,Math.min(38,Math.round(w*.065)));
 // Prioritize different parts of the image before filling remaining slots.
 // Otherwise the highest-scoring single trail can consume all candidates.
 const groups=Array.from({length:16},()=>[]);
 for(const candidate of raw){
  const col=Math.min(3,Math.floor(candidate.x/w*4));
  const row=Math.min(3,Math.floor(candidate.y/h*4));
  if(groups[row*4+col].length<16)groups[row*4+col].push(candidate);
 }
 const ordered=[];
 for(let rank=0;rank<3;rank++)for(const group of groups)if(group[rank])ordered.push(group[rank]);
 ordered.push(...raw);
 for(const candidate of ordered){
  if(selected.length>=max)break;
  const repeated=selected.some(prev=>{
   if(Math.hypot(prev.x-candidate.x,prev.y-candidate.y)<separation)return true;
   const parallel=Math.abs(prev.dx*candidate.dx+prev.dy*candidate.dy)>.965;
   if(!parallel)return false;
   const across=Math.abs((candidate.x-prev.x)*(-prev.dy)+(candidate.y-prev.y)*prev.dx);
   // Parallel sightings less than 19px apart are likely the same line,
   // even when quite far along it. Limit the span so curves aren't lost.
   const along=Math.abs((candidate.x-prev.x)*prev.dx+(candidate.y-prev.y)*prev.dy);
   return across<7&&along<Math.max(75,w*.18);
  });
  if(!repeated)selected.push(candidate);
 }
 return selected.map((p,i)=>({...p,rank:i+1}));
}
window.SurfaceStrideTrailFocus={anchored,imageLine,screenCandidates,_test:{corridor,unitDirection}};
})();