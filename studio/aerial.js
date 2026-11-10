/* Public NAIP aerial scan: potential line-like features, NOT verified trails. */
(function(){
'use strict';
const SERVICE='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
function darkLines(image,w,h){
 const rgba=image.data||image,light=new Uint8Array(w*h),green=new Uint8Array(w*h),soil=new Uint8Array(w*h);
 for(let i=0;i<w*h;i++){
  const j=i*4,r=rgba[j],g=rgba[j+1],b=rgba[j+2],l=.21*r+.72*g+.07*b;
  light[i]=Math.round(l);green[i]=g>r+6&&g>b+8&&l>38?1:0;
  soil[i]=l>35&&l<200&&r>=g*.88&&g>=b*.85?1:0;
 }
 const at=(x,y)=>{x=Math.round(x);y=Math.round(y);return x<0||y<0||x>=w||y>=h?-1:y*w+x;};
 const raw=[],edge=45;
 for(let y=edge;y<h-edge;y+=8)for(let x=edge;x<w-edge;x+=8){
  for(let angle=0;angle<12;angle++){
   const theta=angle*Math.PI/12,dx=Math.cos(theta),dy=Math.sin(theta);
   let n=0,hits=0,sideGreen=0,contrast=0;
   for(let t=-32;t<=32;t+=8){
    const cx=x+t*dx,cy=y+t*dy;
    const a=at(cx,cy),b=at(cx-10*dy,cy+10*dx),c=at(cx+10*dy,cy-10*dx);
    if(a<0||b<0||c<0)continue;
    hits+=soil[a];sideGreen+=green[b]+green[c];
    contrast+=(light[b]+light[c])/2-light[a];n++;
   }
   if(n<8||hits/n<.65||sideGreen/(2*n)<.4||contrast/n<12)continue;
   raw.push({x,y,dx,dy,angle:theta,score:contrast/n+sideGreen/n*7});
  }
 }
 raw.sort((a,b)=>b.score-a.score);
 const out=[];
 for(const z of raw){
  if(out.length>=12)break;
  if(out.some(p=>Math.hypot(p.x-z.x,p.y-z.y)<39))continue;
  out.push(z);
 }
 return out;
}
async function scan(point){
 const scout=window.SurfaceStrideScout?._test;
 if(!scout?.detect||!scout?.merc||!scout?.pixelPoint)throw Error('Aerial module unavailable; refresh the page.');
 const lon=Number.isFinite(point.lon)?point.lon:point.lng;
 if(!Number.isFinite(lon)||!Number.isFinite(point.lat))throw Error('Invalid map center');
 if(point.lat<24||point.lat>50||lon< -125||lon> -66)throw Error('NAIP currently covers the contiguous US only');
 const m=scout.merc(lon,point.lat),half=255,w=640,h=640;
 const box={left:m.x-half,right:m.x+half,bottom:m.y-half,top:m.y+half};
 const query=new URLSearchParams({bbox:[box.left,box.bottom,box.right,box.top].map(v=>v.toFixed(1)).join(','),
  bboxSR:'3857',imageSR:'3857',size:'640,640',format:'jpg',f:'image'});
 const image=await new Promise((resolve,reject)=>{
  const img=new Image(),timer=setTimeout(()=>reject(Error('Aerial image timed out')),26000);
  img.crossOrigin='anonymous';
  img.onload=()=>{clearTimeout(timer);resolve(img)};
  img.onerror=()=>{clearTimeout(timer);reject(Error('Image could not load'))};
  img.src=SERVICE+'?'+query;
 });
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('Image pixel analysis unavailable');
 ctx.drawImage(image,0,0,w,h);
 const rgba=ctx.getImageData(0,0,w,h);
 const lines=[
  ...scout.detect(rgba,w,h).map(x=>({...x,kind:'pale line'})),
  ...darkLines(rgba,w,h).map(x=>({...x,kind:'dark corridor'}))
 ];
 const out=[];
 for(const z of lines){
  if(out.length>=22)break;
  if(out.some(v=>Math.hypot(v.x-z.x,v.y-z.y)<34))continue;
  const a=scout.pixelPoint(z.x-34*z.dx,z.y-34*z.dy,box,w,h),
   b=scout.pixelPoint(z.x+34*z.dx,z.y+34*z.dy,box,w,h);
  out.push({a,b,kind:z.kind,x:z.x,y:z.y,source:'Unverified NAIP image line'});
 }
 return out;
}
window.SurfaceStrideAerial={scan,_test:{darkLines}};
})();