// Measures POST /apply latency on a large board with long history.
// Usage: node scripts/apply-bench.mjs http://127.0.0.1:19871
import {deflateSync,crc32} from 'node:zlib';
import {randomBytes,randomUUID} from 'node:crypto';
const base=process.argv[2]??'http://127.0.0.1:19871';
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base},body:body&&JSON.stringify(body)});if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.json();}
function png(width,height){
  const stride=width*4+1,raw=Buffer.alloc(stride*height);for(let y=0;y<height;y++)randomBytes(width*4).copy(raw,y*stride+1);
  const chunk=(type,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const board=await call('/api/boards','POST',{title:`Apply bench ${Date.now()}`});let revision=board.revision;
const operations=[];for(let i=0;i<299;i++)operations.push({op:'create',element:{kind:'rectangle',x:(i%20)*240,y:Math.floor(i/20)*180,width:200,height:112,text:`Блок ${i}`}});
operations.push({op:'create',element:{kind:'image',x:0,y:-600,width:400,height:300,image:`data:image/png;base64,${png(512,512).toString('base64')}`}});
for(let i=0;i<operations.length;i+=100)revision=(await call(`/api/boards/${board.id}/apply`,'POST',{revision,operations:operations.slice(i,i+100)})).revision;
const actor={id:'bench',source:'user'};
async function move(i){const started=performance.now();const next=await call(`/api/boards/${board.id}/apply?state=1`,'POST',{revision,operations:[{op:'move',ids:[1+(i%299)],dx:1,dy:0}],command:{id:randomUUID(),actor,label:'Bench'}});revision=next.board.revision;return performance.now()-started;}
for(let i=0;i<500;i++)await move(i);
const times=[];for(let i=0;i<50;i++)times.push(await move(i));times.sort((a,b)=>a-b);
console.log(JSON.stringify({p50:+times[25].toFixed(1),p90:+times[45].toFixed(1),max:+times[49].toFixed(1)}));
