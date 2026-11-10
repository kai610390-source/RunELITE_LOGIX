/* SurfaceStride area inventory v15.
 * Candidate regions, NOT semantic segmentation or verified land cover.
 * Aerial RGB alone often cannot separate roofs from pavement, or dirt from
 * gravel. The UI must preserve uncertainty and never auto-add to routes.
 */
(function(){
'use strict';
const TYPES=['trail','grass','tree','dirt','gravel','hardscape','building','paved','water','unknown'];
function patchStats(image,x,y,radius=15){
 const d=image.data,w=image.width,h=image.height;
 const step=3;let n=0,r=0,g=0,b=0,l=0,l2=0,edge=0,green=0,brown=0,blue=0,dark=0;
 for(let yy=y-radius;yy<=y+radius;yy+=step)for(let xx=x-radius;xx<=x+radius;xx+=step){
  const ix=Math.round(xx),iy=Math.round(yy);
  if(ix<1||iy<1||ix>=w-2||iy>=h-2)continue;
  const p=(iy*w+ix)*4,R=d[p]/255,G=d[p+1]/255,B=d[p+2]/255;
  const lum=.2126*R+.7152*G+.0722*B;
  const q=p+4,rr=d[q]/255,gg=d[q+1]/255,bb=d[q+2]/255;
  r+=R;g+=G;b+=B;l+=lum;l2+=lum*lum;
  edge+=Math.abs(lum-(.2126*rr+.7152*gg+.0722*bb));
  if(G>R*1.12&&G>B*1.12)green++;
  if(R>G*1.12&&G>B*1.04)brown++;
  if(B>R*1.16&&B>G*1.09)blue++;
  if(lum<.25)dark++;
  n++;
 }
 if(n<15)return null;
 r/=n;g/=n;b/=n;l/=n;
 const spread=Math.max(r,g,b)-Math.min(r,g,b);
 return {r,g,b,lum:l,saturation:spread/Math.max(.08,Math.max(r,g,b)),
  contrast:Math.sqrt(Math.max(0,l2/n-l*l)),
  texture:edge/n,green:green/n,brown:brown/n,blue:blue/n,dark:dark/n};
}
function classify(stats,{model=null}={}){
 if(!stats)return {kind:'unknown',score:0,reason:'No valid image samples'};
 const p=stats;
 if(p.blue>.59&&p.green<.23&&p.b>.20)
  return {kind:'water',score:Math.min(.9,.5+p.blue*.32),reason:'Blue-dominant aerial patch; may be water or colored roof'};
 if(p.green>.46){
  const wooded=p.texture>.068||p.contrast>.063||p.dark>.24||p.lum<.37;
  return wooded?
   {kind:'tree',score:Math.min(.92,.49+p.green*.25+p.texture*.7),
    reason:'Vegetated, textured patch; possible tree canopy'}:
   {kind:'grass',score:Math.min(.88,.48+p.green*.24+(1-Math.min(1,p.texture*6))*.10),
    reason:'Vegetated, relatively uniform open ground; possible grass'};
 }
 if(p.saturation<.135&&p.lum>.30&&p.lum<.91){
  // Color alone cannot reliably tell rooftops from pavement.
  let kind='hardscape',reason='Flat gray hardscape; roof versus pavement uncertain',score=.52;
  if(model?.trained&&model.confidence>.82&&
      (model.label==='building'||model.label==='paved')&&
      model.nearestDistance<.33){
   kind=model.label;score=.57+Math.min(.2,(model.confidence-.82)*.5);
   reason='Tentative trained example match ('+kind+'); roof/pavement is not verified';
  }
  return {kind,score,reason};
 }
 if(p.brown>.24){
  const rough=p.texture>.067||p.contrast>.039;
  return {kind:rough&&p.saturation<.33?'gravel':'dirt',
   score:Math.min(.84,.46+p.brown*.22+p.texture*.6),
   reason:rough?'Earth-toned textured ground; possible gravel or coarse dirt':
    'Earth-toned ground; possible dirt'};
 }
 if(p.saturation<.24&&p.contrast>.026&&p.texture>.042&&p.lum>.38){
  return {kind:'gravel',score:.49,reason:'Light textured ground; could be gravel or pale dirt'};
 }
 if(p.lum<.17&&p.dark>.6)
  return {kind:'unknown',score:.24,reason:'Too much shadow to identify reliably'};
 return {kind:'unknown',score:.28,reason:'Aerial colors do not identify this material'};
}
function inspect(image,{maxRegions=32,vision=null}={}){
 if(!image?.data||image.width<96||image.height<96)return [];
 const w=image.width,h=image.height,cell=Math.max(27,Math.round(Math.min(w,h)/8));
 const spots=[];
 for(let y=Math.round(cell*.8);y<h-cell*.7;y+=cell)
  for(let x=Math.round(cell*.8);x<w-cell*.7;x+=cell){
   const stats=patchStats(image,x,y,Math.max(10,Math.round(cell*.3)));
   if(!stats)continue;
   let model=null;
   if(vision?.features&&vision?.predict){
    try{
     const win=Math.min(70,Math.round(cell*.9)),patch=new Uint8ClampedArray(win*win*4);
     for(let j=0;j<win;j++)for(let i=0;i<win;i++){
      const px=Math.max(0,Math.min(w-1,Math.round(x-win/2+i)));
      const py=Math.max(0,Math.min(h-1,Math.round(y-win/2+j)));
      const from=(py*w+px)*4,to=(j*win+i)*4;
      patch.set(image.data.subarray(from,from+4),to);
     }
     model=vision.predict(vision.features({data:patch,width:win,height:win}));
    }catch(err){/* Pixels are still classifiable without the local model. */}
   }
   const observation=classify(stats,{model});
   spots.push({x,y,kind:observation.kind,score:observation.score,
    reason:observation.reason,stats,modelGuess:model?.hasGuess?model.label:null});
  }
 // Preserve diversity instead of filling the screen with only one material.
 const groups=new Map();
 for(const p of spots){if(!groups.has(p.kind))groups.set(p.kind,[]);groups.get(p.kind).push(p);}
 const selected=[],limit=Math.min(72,Math.max(1,Math.round(maxRegions)));
 for(const [kind,group] of groups){
  group.sort((a,b)=>b.score-a.score);
  const cap=kind==='unknown'?2:Math.max(2,Math.ceil(limit/6));
  let count=0;
  for(const p of group){
   if(count>=cap)break;
   if(selected.some(other=>other.kind===kind&&Math.hypot(other.x-p.x,other.y-p.y)<cell*1.15))continue;
   selected.push(p);count++;
  }
 }
 selected.sort((a,b)=>b.score-a.score);
 return selected.slice(0,limit);
}
function tally(areas){
 const counts=Object.fromEntries(TYPES.map(type=>[type,0]));
 for(const p of areas)if(p.kind in counts)counts[p.kind]++;
 return counts;
}
window.SurfaceStrideSurfaceScout={patchStats,classify,inspect,tally,TYPES};
})();