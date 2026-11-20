import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from './server.mjs';

test('server hosts the actual browser planner, serves API health, blocks dangerous paths', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'surface-'));
 await mkdir(path.join(root,'studio'));
 await writeFile(path.join(root,'studio/index.html'),'<title>Studio</title>');
 await writeFile(path.join(root,'studio/app.js'),'console.log("trail")');
 await writeFile(path.join(root,'app.py'),'sensitive');
 const server=createServer(root); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).service,'surfacestride');
  const page=await fetch(base+'/studio/');assert.equal(page.status,200);assert.match(await page.text(),/Studio/);
  assert.equal((await fetch(base+'/studio/app.js')).status,200);
  assert.equal((await fetch(base+'/app.py')).status,404);
  assert.equal((await fetch(base+'/server/server.mjs')).status,404);
  assert.equal((await fetch(base+'/api/osm?bbox=-97.8,30.1,-70,30.2')).status,400);
  assert.equal((await fetch(base+'/api/geocode?q=x')).status,400);
  assert.equal((await fetch(base+'/studio/..%2F..%2Fapp.py')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});