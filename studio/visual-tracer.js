/* SurfaceStride V19: inspect a visible trail at native aerial detail.
 * Results are review-only, never automatically routable.
 */
(function(){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function pixel(r,x,y){
 const xx=Math.round(x),yy=Math.round(y);
 if(xx<2||yy<2||xx>=r.width-2||yy>=r.height-2)return null;
 const i=(yy*r.width+xx)*4,d=r.data,R=d[i]/255,G=d[i+1]/255,B=d[i+2]/255;
 return {l:.2126*R+.7152*G+.0722*B,vegetation:clamp((G-Math.max(R,B))*2,0,1)};
}
function scoreAt(r,x,y,angle,length=12){
 const dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx;
 let best=null;
 for(const width of [3,5,8,12]){
  let n=0,paired=0,plus=0,minus=0,total=0,lum=0,lum2=0,side=0,green=0;
  for(let d=-length;d<=length;d+=3){
   const cx=x+dx*d,cy=y+dy*d;
   const c=pixel(r,cx,cy),left=pixel(r,cx+nx*width,cy+ny*width),
    right=pixel(r,cx-nx*width,cy-ny*width);
   if(!c||!left||!right)continue;
   const a=c.l-left.l,b=c.l-right.l;
   if(a*b>0&&Math.abs(a)>.028&&Math.abs(b)>.028){
    paired++;if(a+b>0)plus++;else minus++;
   }
   total+=Math.min(Math.abs(a),Math.abs(b));
   side+=Math.abs(left.l-right.l);
   lum+=c.l;lum2+=c.l*c.l;
   green+=Math.max(0,(left.vegetation+right.vegetation)/2-c.vegetation);
   n++;
  }
  if(n<Math.max(6,Math.floor(length/2)))continue;
  const consistency=Math.max(plus,minus)/n,pairedFraction=paired/n,
   contrast=total/n,centerStd=Math.sqrt(Math.max(0,lum2/n-(lum/n)**2)),
   sideSimilarity=1-clamp(side/n/.24,0,1),greenContrast=green/n;
  const valid=pairedFraction>.60&&consistency>.59&&contrast>.045&&
   sideSimilarity>.42&&centerStd<.088;
  const score=contrast*.95+pairedFraction*.10+consistency*.04+
   sideSimilarity*.03+greenContrast*.05-centerStd*.4;
  const q={x,y,angle,dx,dy,width,valid,score,pairedFraction,
   consistency,contrast,sideSimilarity,centerStd};
  if(!best||score+(valid?.14:0)>best.score+(best.valid?.14:0))best=q;
 }
 return best;
}
function seeds(r,center,{radius=16,limit=10}={}){
 const list=[];
 for(let oy=-radius;oy<=radius;oy+=4)for(let ox=-radius;ox<=radius;ox+=4)
  for(let a=0;a<Math.PI;a+=Math.PI/12){
   if(Math.hypot(ox,oy)>radius*1.25)continue;
   const q=scoreAt(r,center.x+ox,center.y+oy,a);
   if(q?.valid)list.push({...q,rank:q.score-.002*Math.hypot(ox,oy)});
  }
 list.sort((a,b)=>b.rank-a.rank);
 const chosen=[];
 for(const s of list){
  if(chosen.some(c=>Math.hypot(c.x-s.x,c.y-s.y)<8&&Math.abs(Math.cos(c.angle-s.angle))>.93))continue;
  chosen.push(s);if(chosen.length===limit)break;
 }
 return chosen;
}
function follow(r,start,reverse,{step=7,limit=60}={}){
 const points=[{x:start.x,y:start.y}];
 let x=start.x,y=start.y,angle=start.angle+(reverse?Math.PI:0),
  consecutive=0,score=0,confirmed=0;
 for(let i=0;i<limit;i++){
  let best=null;
  for(const da of [-.28,-.14,0,.14,.28])for(const across of [-4,0,4]){
   const a=angle+da,dx=Math.cos(a),dy=Math.sin(a),
    px=x+dx*step-Math.sin(a)*across,py=y+dy*step+Math.cos(a)*across;
   if(px<23||py<23||px>=r.width-23||py>=r.height-23)continue;
   const q=scoreAt(r,px,py,a,9);
   if(!q)continue;
   const rank=q.score-Math.abs(da)*.035-Math.abs(across)*.008;
   if(!best||rank>best.rank)best={...q,rank,x:px,y:py,angle:a};
  }
  if(!best)break;
  if(!best.valid||best.rank<.085){
   consecutive++;if(consecutive>=2)break;
  }else{consecutive=0;confirmed++;score+=best.rank;}
  x=best.x;y=best.y;angle=best.angle;
  points.push({x,y,uncertain:consecutive>0});
  if(points.length>20&&Math.hypot(x-start.x,y-start.y)<step)break;
 }
 return {points,confirmed,score:confirmed?score/confirmed:0};
}
function traceAt(r,point,{limit=3}={}){
 if(!r?.data||r.width<120||r.height<120)throw Error('No readable aerial pixels.');
 const candidates=[];
 for(const seed of seeds(r,point)){
  const a=follow(r,seed,true),b=follow(r,seed,false);
  const points=a.points.slice().reverse().concat(b.points.slice(1));
  if(points.length<7||a.confirmed+b.confirmed<8)continue;
  const average=(a.score*a.confirmed+b.score*b.confirmed)/(a.confirmed+b.confirmed);
  // A visual path must progress beyond the seed in both directions.
  if(Math.hypot(points[0].x-points[points.length-1].x,
   points[0].y-points[points.length-1].y)<22)continue;
  if(candidates.some(c=>Math.hypot(c.points[Math.floor(c.points.length/2)].x-seed.x,
   c.points[Math.floor(c.points.length/2)].y-seed.y)<11))continue;
  candidates.push({points,score:average,kind:'close-up visible trail',
   confidence:'unverified',source:'Clicked high-resolution aerial inspection'});
  if(candidates.length>=limit)break;
 }
 return candidates.sort((a,b)=>b.points.length-a.points.length);
}
function scanLoose(r,{limit=12,step=20}={}){
 if(!r?.data)return [];
 const candidates=[];
 for(let y=26;y<r.height-26;y+=step)for(let x=26;x<r.width-26;x+=step)
  for(let a=0;a<Math.PI;a+=Math.PI/9){
   const q=scoreAt(r,x,y,a,12);
   if(q?.valid)candidates.push({...q,kind:'weak two-sided trail pattern',
    confidence:'low',source:'High-recall aerial search'});
  }
 candidates.sort((a,b)=>b.score-a.score);
 const selected=[];
 for(const c of candidates){
  if(selected.length>=limit)break;
  if(selected.some(q=>{
   const dx=c.x-q.x,dy=c.y-q.y,dist=Math.hypot(dx,dy);
   if(dist<15)return true;
   return Math.abs(Math.cos(q.angle-c.angle))>.95&&dist<85&&
    Math.abs(dx*(-Math.sin(q.angle))+dy*Math.cos(q.angle))<7;
  }))continue;
  selected.push(c);
 }
 return selected;
}
window.SurfaceStrideVisualInspector={traceAt,scanLoose,_test:{scoreAt,seeds,follow}};
})();