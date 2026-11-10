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
 const w=data.width,h=data.height,step=Math.max(10,Math.round(Math.min(w,h)/50));
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
window.SurfaceStrideTrailFocus={anchored,imageLine,_test:{corridor,unitDirection}};
})();