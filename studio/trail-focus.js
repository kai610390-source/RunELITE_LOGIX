/* Trail-aware aerial target detector.
 * A thin linear corridor is favored over roofs/trees. OSM anchor geometry
 * helps disambiguate but never proves surface/access.
 */
(function(){
'use strict';
function corridor(data,x,y,dx,dy){
 const w=data.width,h=data.height,rgba=data.data,nx=-dy,ny=dx;
 let cLight=0,cLight2=0,sLight=0,cGreen=0,sGreen=0,lGreen=0,rGreen=0,synchronous=0,valid=0;
 const sample=(px,py)=>{
  const ix=Math.round(px),iy=Math.round(py);
  if(ix<2||iy<2||ix>=w-2||iy>=h-2)return null;
  const i=(iy*w+ix)*4,r=rgba[i]/255,g=rgba[i+1]/255,b=rgba[i+2]/255;
  return {l:.2126*r+.7152*g+.0722*b,green:g>r*1.12&&g>b*1.12?1:0};
 };
 for(let t=-24;t<=24;t+=4){
  const px=x+dx*t,py=y+dy*t;
  const c=sample(px,py),l=sample(px+nx*13,py+ny*13),r=sample(px-nx*13,py-ny*13);
  if(!c||!l||!r)continue;
  cLight+=c.l;cLight2+=c.l*c.l;sLight+=(l.l+r.l)/2;
  cGreen+=c.green;sGreen+=(l.green+r.green)/2;
  lGreen+=l.green;rGreen+=r.green;
  if(l.green&&r.green&&!c.green)synchronous++;
  valid++;
 }
 if(valid<10)return {passes:false,score:-1,contrast:0,greenContrast:0};
 const contrast=Math.abs(cLight-sLight)/valid;
 const greenContrast=(sGreen-cGreen)/valid;
 const together=synchronous/valid;
 const centerStd=Math.sqrt(Math.max(0,cLight2/valid-(cLight/valid)**2));
 const brightCenter=(cLight-sLight)/valid;
 // Require linear contrast with vegetation flanking the corridor,
 // or strong contrast plus a ground-like center. This rejects uniform roofs.
 const passes=contrast>.07&&greenContrast>.17&&together>.53&&centerStd<.15;
 const score=contrast*2.1+Math.max(0,greenContrast)*.8+
   Math.max(0,brightCenter)*.2;
 return {passes,score,contrast,greenContrast,brightCenter,together,centerStd};
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
   if(!line.passes||line.greenContrast<.17||line.contrast<.10)continue;
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
 const max=Math.max(1,Math.min(18,Math.round(maxCandidates)));
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
 const step=Math.max(5,Math.round(Math.min(w,h)/105)),margin=38;
 for(let y=margin;y<h-margin;y+=step)
  for(let x=margin;x<w-margin;x+=step){
   for(let a=0;a<8;a++){
    const angle=a*Math.PI/8,dx=Math.cos(angle),dy=Math.sin(angle);
    const line=corridor(data,x,y,dx,dy);
    if(!line.passes||line.contrast<.10||line.greenContrast<.17)continue;
    raw.push({x,y,score:line.score,dx,dy,source:'possible-image-trail'});
   }
  }
 if(!raw.length)return [];
 // Group detections belonging to the same straight/parallel narrow trail
 // while preserving candidates from other paths elsewhere in the image.
 raw.sort((a,b)=>b.score-a.score);
 const selected=[];
 const separation=Math.max(45,Math.min(87,Math.round(w*.11)));
 for(const candidate of raw){
  if(selected.length>=max)break;
  const repeated=selected.some(prev=>{
   if(Math.hypot(prev.x-candidate.x,prev.y-candidate.y)<separation)return true;
   const parallel=Math.abs(prev.dx*candidate.dx+prev.dy*candidate.dy)>.965;
   if(!parallel)return false;
   const across=Math.abs((candidate.x-prev.x)*(-prev.dy)+(candidate.y-prev.y)*prev.dx);
   // Parallel sightings less than 19px apart are likely the same line,
   // even when quite far along it. Limit the span so curves aren't lost.
   const along=Math.abs((candidate.x-prev.x)*prev.dx+(candidate.y-prev.y)*prev.dy);
   return across<19&&along<Math.max(160,w*.28);
  });
  if(!repeated)selected.push(candidate);
 }
 return selected.map((p,i)=>({...p,rank:i+1}));
}
window.SurfaceStrideTrailFocus={anchored,imageLine,screenCandidates,_test:{corridor,unitDirection}};
})();