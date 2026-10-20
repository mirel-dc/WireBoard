import type {Bounds,Element,Operation} from './types';
export type Side='left'|'right'|'top'|'bottom';
export const SIDES:Side[]=['left','right','top','bottom'];
export const ADD_GAP=80,CLEARANCE=24,MAX_STEPS=50;
export const oppositeSide=(side:Side):Side=>({left:'right',right:'left',top:'bottom',bottom:'top'} as const)[side];
const horizontal=(side:Side)=>side==='left'||side==='right';
const overlaps=(a:Bounds,b:Bounds,pad:number)=>a.x-pad<b.x+b.width&&a.x+a.width+pad>b.x&&a.y-pad<b.y+b.height&&a.y+a.height+pad>b.y;
// "+" places the copy beside the source; an occupied spot pushes it past the obstacle along the same axis.
export function besideBounds(source:Bounds,side:Side,others:Bounds[]):Bounds{
  const forward=side==='right'||side==='bottom',{width,height}=source;
  let b:Bounds=horizontal(side)?{x:forward?source.x+width+ADD_GAP:source.x-ADD_GAP-width,y:source.y,width,height}:{x:source.x,y:forward?source.y+height+ADD_GAP:source.y-ADD_GAP-height,width,height};
  for(let step=0;step<MAX_STEPS;step++){
    const hit=others.find(o=>overlaps(b,o,CLEARANCE));if(!hit)return b;
    b=horizontal(side)?{...b,x:forward?hit.x+hit.width+CLEARANCE:hit.x-CLEARANCE-width}:{...b,y:forward?hit.y+hit.height+CLEARANCE:hit.y-CLEARANCE-height};
  }
  return b;
}
// A drop in empty space puts the middle of the copy's side that faces the source on the drop point.
export function dropBounds(source:Bounds,point:{x:number;y:number}):{bounds:Bounds;side:Side}{
  const dx=point.x-(source.x+source.width/2),dy=point.y-(source.y+source.height/2),{width,height}=source;
  const side:Side=Math.abs(dx)>=Math.abs(dy)?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
  const x=side==='right'?point.x:side==='left'?point.x-width:point.x-width/2,y=side==='bottom'?point.y:side==='top'?point.y-height:point.y-height/2;
  return{bounds:{x,y,width,height},side};
}
export function addOperations(source:Element,bounds:Bounds,fromPort:Side,toPort:Side,id:number):Operation[]{
  const copy={id,kind:source.kind,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,fill:source.fill,stroke:source.stroke,fontSize:source.fontSize,fontWeight:source.fontWeight,title:'',text:'',...(source.kind==='image'?{image:source.image}:{})};
  return[{op:'create',element:copy},{op:'create',element:{id:id+1,kind:'connector',from:source.id,to:id,fromPort,toPort}}];
}
