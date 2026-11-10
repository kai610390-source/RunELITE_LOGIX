/* SurfaceStride ground target picker for random aerial classification.
   Conservative local RGB/texture filter, not proof of walkability or surface.
   Uses photo pixels to reject likely trees, shadows and water before prompting. */
(function(){
'use strict';
const R=6378137;
function analyze(data,x,y){
 const rgba=data.data,w=data.width,h=data.height,step=4,radius=Math.max(13,Math.round(Math.min(w,h)*.029));
 let count=0,sum=0,sum2=0,edge=0,green=0,dark=0,water=0,brown=0;
 for(let dy=-radius;dy<=radius;dy+=step)for(let dx=-radius;dx<=radius;dx+=step){
  const ix=Math.round(x+dx),iy=Math.round(y+dy);
  if(ix<3||iy<3||ix>=w-4||iy>=h-4)continue;
  const at=(iy*w+ix)*4,r=rgba[at]/255,g=rgba[at+1]/255,b=rgba[at+2]/255;
  const lum=.2126*r+.7152*g+.0722*b;
  const other=(iy*w+ix+3)*4,below=((iy+3)*w+ix)*4;
  const l1=(.2126*rgba[other]+.7152*rgba[other+1]+.0722*rgba[other+2])/255;
  const l2=(.2126*rgba[below]+.7152*rgba[below+1]+.0722*rgba[below+2])/255;
  const gradient=(Math.abs(lum-l1)+Math.abs(lum-l2))/2;
  sum+=lum;sum2+=lum*lum;edge+=gradient;
  if(g>r*1.1&&g>b*1.12)green++;
  if(lum<.23)dark++;
  if(b>r*1.18&&b>g*1.12)water++;
  if(r>g*1.08&&g>b*1.05)brown++;
  count++;
 }
 if(count<20)return {accept:false,score:-Infinity};
 const mean=sum/count,std=Math.sqrt(Math.max(0,sum2/count-mean*mean)),texture=edge/count;
 const greenRatio=green/count,darkRatio=dark/count,waterRatio=water/count;
 const canopy=greenRatio>.28&&mean<.52&&(std>.066||texture>.075);
 const denseLeaves=greenRatio>.68&&(std>.095||texture>.085);
 const ambiguous=std>.16||texture>.18||darkRatio>.46;
 const accept=mean>.20&&mean<.92&&!canopy&&!denseLeaves&&!ambiguous&&waterRatio<.28;
 let score=1.1-std*3.6-texture*3.4-darkRatio*.55-waterRatio;
 score+=Math.min(.12,brown/count*.13)+Math.min(.10,greenRatio*.06);
 if(mean<.32)score-=.12;
 return {accept,score,mean,std,texture,greenRatio,darkRatio,waterRatio,canopy};
}
function choose(data){
 const w=data.width,h=data.height;
 if(w<100||h<100)throw Error('Image too small to analyze open ground.');
 const spots=[],margin=Math.max(40,Math.round(Math.min(w,h)*.20));
 const step=Math.max(26,Math.floor(Math.min(w,h)/13));
 for(let y=margin;y<h-margin;y+=step)
  for(let x=margin;x<w-margin;x+=step){
   const result=analyze(data,x,y);
   if(result.accept&&result.score>.23)spots.push({x,y,...result});
  }
 if(!spots.length)return null;
 spots.sort((a,b)=>b.score-a.score);
 const pool=spots.slice(0,Math.min(12,spots.length));
 return pool[Math.floor(Math.random()*pool.length)];
}
function focus(data,x,y){
 const w=data.width,h=data.height,span=Math.min(72,Math.floor(Math.min(w,h)*.12));
 const out=new Uint8ClampedArray(span*span*4);
 const left=Math.round(x-span/2),top=Math.round(y-span/2);
 for(let row=0;row<span;row++)for(let col=0;col<span;col++){
  const xx=Math.max(0,Math.min(w-1,left+col)),yy=Math.max(0,Math.min(h-1,top+row));
  const from=(yy*w+xx)*4,to=(row*span+col)*4;
  out[to]=data.data[from];out[to+1]=data.data[from+1];
  out[to+2]=data.data[from+2];out[to+3]=data.data[from+3];
 }
 if(!window.SurfaceStrideVision?.features)throw Error('Surface feature extractor not loaded.');
 return window.SurfaceStrideVision.features({data:out,width:span,height:span});
}
function place(sample,fractionX,fractionY){
 if(!sample?._raster||!sample._mercatorBounds)throw Error('This image does not support repositioning.');
 const xx=Math.min(.88,Math.max(.12,Number(fractionX)));
 const yy=Math.min(.88,Math.max(.12,Number(fractionY)));
 if(!Number.isFinite(xx)||!Number.isFinite(yy))throw Error('Invalid target position.');
 const x=xx*sample._raster.width,y=yy*sample._raster.height,box=sample._mercatorBounds;
 sample.vector=focus(sample._raster,x,y);
 sample.targetX=xx;sample.targetY=yy;
 const mx=box.left+(box.right-box.left)*xx,my=box.top-(box.top-box.bottom)*yy;
 sample.lon=mx/R*180/Math.PI;
 sample.lat=(2*Math.atan(Math.exp(my/R))-Math.PI/2)*180/Math.PI;
 sample.selection='user-adjusted';
 return sample;
}
window.SurfaceStrideGroundPicker={analyze,choose,focus,place};
})();