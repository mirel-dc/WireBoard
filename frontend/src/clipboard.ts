import {members} from './canvas';
import {dropTarget} from './interaction';
import type {Board,Element,Operation} from './types';

export const CLIPBOARD_TYPE='application/x-wireboard-elements';
export interface ClipboardSnapshot{type:'wireboard-elements';version:1;sourceBoardId:string;elements:Element[]}
const failure=()=>new Error('Некорректная копия Wireboard. Скопируйте объекты заново.');
const limit=()=>new Error('За один раз можно скопировать до 50 объектов вместе со связями.');
const validId=(id:unknown):id is number=>Number.isSafeInteger(id)&&Number(id)>0;
const number=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const text=(s:unknown,max:number)=>typeof s==='string'&&[...s].length<=max&&!/[\u0000-\u0008\u000b-\u001f\ufffe\uffff]/u.test(s);
const color=(s:unknown)=>typeof s==='string'&&/^(none|#[0-9a-f]{6})$/i.test(s);
const fields=['id','kind','x','y','width','height','text','title','fontWeight','fill','stroke','fontSize','from','to','fromPort','toPort','image','parentFrameId'];

export function copySelection(board:Board,ids:number[]):ClipboardSnapshot|null{
  const included=new Set(members(board,ids));
  const nodes=board.elements.filter(e=>e.kind!=='connector'&&included.has(e.id));
  const nodeIds=new Set(nodes.map(e=>e.id));
  const elements=structuredClone([...nodes,...board.elements.filter(e=>e.kind==='connector'&&e.from!==null&&e.to!==null&&nodeIds.has(e.from)&&nodeIds.has(e.to))]).sort((a,b)=>a.id-b.id);
  if(!elements.length)return null;if(elements.length>50)throw limit();
  for(const e of elements)if(e.parentFrameId!==null&&!nodeIds.has(e.parentFrameId))e.parentFrameId=null;
  return {type:'wireboard-elements',version:1,sourceBoardId:board.id,elements};
}

export function parseClipboard(raw:string):ClipboardSnapshot|null{
  if(raw.length>32*1024*1024)throw new Error('Копия превышает 32 MiB.');
  let value:any;try{value=JSON.parse(raw);}catch{return null;}
  if(value?.type!=='wireboard-elements')return null;
  if(value.version!==1||typeof value.sourceBoardId!=='string'||!Array.isArray(value.elements)||!value.elements.length)throw failure();
  if(value.elements.length>50)throw limit();
  const ids=new Map<number,Element>();
  for(const e of value.elements){
    if(!e||typeof e!=='object'||Object.keys(e).length!==fields.length||fields.some(f=>!Object.hasOwn(e,f))||!validId(e.id)||ids.has(e.id)||!['rectangle','text','frame','image','connector'].includes(e.kind)||!number(e.x,-100000,100000)||!number(e.y,-100000,100000)||!number(e.width,20,10000)||!number(e.height,20,10000)||!text(e.text,10000)||!text(e.title,256)||![400,600].includes(e.fontWeight)||!color(e.fill)||!color(e.stroke)||!number(e.fontSize,10,96)||!(e.from===null||validId(e.from))||!(e.to===null||validId(e.to))||!(e.parentFrameId===null||validId(e.parentFrameId))||!['auto','left','right','top','bottom'].includes(e.fromPort)||!['auto','left','right','top','bottom'].includes(e.toPort)||!(e.image===null||typeof e.image==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(e.image)))throw failure();
    ids.set(e.id,e);
  }
  for(const e of ids.values()){
    if(e.kind==='connector'&&(e.from===null||e.to===null||e.from===e.to||!ids.has(e.from)||!ids.has(e.to)||ids.get(e.from)?.kind==='connector'||ids.get(e.to)?.kind==='connector'))throw failure();
    if(e.kind!=='connector'&&(e.from!==null||e.to!==null))throw failure();
    const visited=new Set([e.id]);let parent=e.parentFrameId;
    while(parent!==null){if(visited.has(parent)||ids.get(parent)?.kind!=='frame')throw failure();visited.add(parent);parent=ids.get(parent)!.parentFrameId;}
  }
  return value as ClipboardSnapshot;
}

export function pasteSelection(snapshot:ClipboardSnapshot,board:Board,offset:{x:number;y:number}):{operations:Operation[];ids:number[]}{
  const mapping=new Map(snapshot.elements.map((e,i)=>[e.id,board.nextId+i]));
  const operations:Operation[]=[],ids=[...mapping.values()];
  if(!Number.isSafeInteger(board.nextId+ids.length))throw new Error('ID объектов исчерпаны.');
  for(const old of snapshot.elements){
    const e={...old,id:mapping.get(old.id)!,x:old.x+offset.x,y:old.y+offset.y,from:old.from===null?null:mapping.get(old.from)!,to:old.to===null?null:mapping.get(old.to)!,parentFrameId:old.parentFrameId===null?null:mapping.get(old.parentFrameId)!};
    const parentFrameId=e.kind==='connector'?null:e.parentFrameId??dropTarget(board,-1,{x:e.x+e.width/2,y:e.y+e.height/2},[]);
    operations.push({op:'create',element:e},{op:'update',id:e.id,patch:{parentFrameId}});
  }
  return {operations,ids};
}
