type WheelInput=Pick<WheelEvent,'deltaX'|'deltaY'|'deltaMode'|'ctrlKey'|'metaKey'|'shiftKey'>;
export type WheelIntent={type:'pan';dx:number;dy:number}|{type:'zoom';factor:number};
const clamp=(value:number,limit:number)=>Math.max(-limit,Math.min(limit,value));
export function wheelIntent(event:WheelInput,viewport:{width:number;height:number}):WheelIntent|null{
  if(!Number.isFinite(event.deltaX)||!Number.isFinite(event.deltaY)||![0,1,2].includes(event.deltaMode))return null;
  const scaleX=event.deltaMode===1?16:event.deltaMode===2?viewport.width:1,scaleY=event.deltaMode===1?16:event.deltaMode===2?viewport.height:1;
  let dx=clamp(event.deltaX*scaleX,2000),dy=clamp(event.deltaY*scaleY,2000);
  if(event.ctrlKey||event.metaKey)return dy===0?null:{type:'zoom',factor:Math.exp(-clamp(dy,1000)*.002)};
  if(event.shiftKey&&dx===0){dx=dy;dy=0;}
  return dx===0&&dy===0?null:{type:'pan',dx,dy};
}
