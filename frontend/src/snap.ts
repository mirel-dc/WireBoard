import type {Board,Bounds} from './types';
import type {ResizeHandle} from './interaction';
// Screen pixels within which an edge, centre, gap or size snaps; callers divide by zoom.
export const SNAP_PX=6;
// Coordinates closer than this (world units) are the same line when drawing guides.
const SAME=.5;
// The size limits of resizeBounds.
const MIN_SIZE=20,MAX_SIZE=10000;
export type Axis='x'|'y';
export type Guide=
  // axis 'x': the vertical line x=at from y=from to y=to; axis 'y': the horizontal line y=at.
  {type:'align';axis:Axis;at:number;from:number;to:number}|
  // axis 'x': a horizontal gap from x=start to x=end drawn at y=at; axis 'y': a vertical gap drawn at x=at.
  {type:'gap';axis:Axis;start:number;end:number;at:number}|
  // A block whose width (axis 'x') or height (axis 'y') equals the resized one.
  {type:'size';axis:Axis;bounds:Bounds};
export interface MoveSnap{dx:number;dy:number;guides:Guide[]}
export interface ResizeSnap{bounds:Bounds;guides:Guide[]}
const SNAPPABLE=new Set(['rectangle','text','image','frame']);
const AXES=['x','y'] as const;
const other=(a:Axis):Axis=>a==='x'?'y':'x';
const start=(b:Bounds,a:Axis)=>a==='x'?b.x:b.y;
const length=(b:Bounds,a:Axis)=>a==='x'?b.width:b.height;
const end=(b:Bounds,a:Axis)=>start(b,a)+length(b,a);
const lines=(b:Bounds,a:Axis)=>[start(b,a),start(b,a)+length(b,a)/2,end(b,a)];
const intersects=(a:Bounds,b:Bounds)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
export function snapTargets(board:Board,exclude:number[],view:Bounds):Bounds[]{
  const skip=new Set(exclude);
  return board.elements.filter(e=>SNAPPABLE.has(e.kind)&&!skip.has(e.id)&&intersects(e,view)).map(({x,y,width,height})=>({x,y,width,height}));
}
export function unionBounds(bounds:Bounds[]):Bounds|null{
  if(!bounds.length)return null;
  const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y));
  return{x,y,width:Math.max(...bounds.map(b=>b.x+b.width))-x,height:Math.max(...bounds.map(b=>b.y+b.height))-y};
}
// The smallest correction within the threshold that puts one of `from` on one of `to`.
function nearest(from:number[],to:number[],threshold:number):number|null{
  let best:number|null=null;
  for(const a of from)for(const b of to){const d=b-a;if(Math.abs(d)<=threshold&&(best===null||Math.abs(d)<Math.abs(best)))best=d;}
  return best;
}
// One guide per position of `b` that some target shares, spanning b and every such target.
function alignGuides(b:Bounds,targets:Bounds[],axis:Axis,positions:number[]):Guide[]{
  const o=other(axis),guides:Guide[]=[];
  for(const at of new Set(positions)){
    const hits=targets.filter(t=>lines(t,axis).some(v=>Math.abs(v-at)<SAME));if(!hits.length)continue;
    const all=[b,...hits];guides.push({type:'align',axis,at,from:Math.min(...all.map(n=>start(n,o))),to:Math.max(...all.map(n=>end(n,o)))});
  }
  return guides;
}
export function snapMove(moving:Bounds,targets:Bounds[],threshold:number):MoveSnap{
  const delta={x:0,y:0};
  for(const axis of AXES)delta[axis]=nearest(lines(moving,axis),targets.flatMap(t=>lines(t,axis)),threshold)??0;
  const snapped={...moving,x:moving.x+delta.x,y:moving.y+delta.y};
  return{dx:delta.x,dy:delta.y,guides:AXES.flatMap(axis=>alignGuides(snapped,targets,axis,lines(snapped,axis)))};
}
// Only the dragged edges snap: to target edges and centres, or so that the size matches a target; the nearer one wins, an edge on a tie.
export function snapResize(bounds:Bounds,handle:ResizeHandle,targets:Bounds[],threshold:number):ResizeSnap{
  let b={...bounds};
  const dragged=AXES.map(axis=>({axis,low:handle.includes(axis==='x'?'w':'n'),high:handle.includes(axis==='x'?'e':'s')})).filter(d=>d.low||d.high);
  for(const {axis,low} of dragged){
    const size=length(b,axis),toEdge=nearest([low?start(b,axis):end(b,axis)],targets.flatMap(t=>lines(t,axis)),threshold);
    // A larger size moves the dragged edge outward.
    const toSize=nearest([size],targets.map(t=>length(t,axis)),threshold),sizeShift=toSize===null?null:low?-toSize:toSize;
    const d=toEdge!==null&&(sizeShift===null||Math.abs(toEdge)<=Math.abs(sizeShift))?toEdge:sizeShift;if(d===null)continue;
    const next=low?size-d:size+d;if(next<MIN_SIZE||next>MAX_SIZE)continue;
    b=axis==='x'?{...b,x:low?b.x+d:b.x,width:next}:{...b,y:low?b.y+d:b.y,height:next};
  }
  const guides:Guide[]=[];
  for(const {axis,low} of dragged){
    guides.push(...alignGuides(b,targets,axis,[low?start(b,axis):end(b,axis)]));
    const same=targets.filter(t=>Math.abs(length(t,axis)-length(b,axis))<SAME);
    if(same.length)guides.push({type:'size',axis,bounds:b},...same.map(t=>({type:'size' as const,axis,bounds:t})));
  }
  return{bounds:b,guides};
}
