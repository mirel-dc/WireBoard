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
// Blocks overlapping `b` on the cross axis form its row (axis 'x') or column (axis 'y').
const sameRow=(a:Bounds,b:Bounds,axis:Axis)=>{const o=other(axis);return start(a,o)<end(b,o)&&start(b,o)<end(a,o);};
interface GapSnap{delta:number;gaps:[number,number][]}
// Equal spacing in the row: centred between the nearest neighbours, or repeating the step between a neighbour and the block beyond it.
function gapSnap(m:Bounds,targets:Bounds[],axis:Axis,threshold:number):GapSnap|null{
  const row=targets.filter(t=>sameRow(t,m,axis)),size=length(m,axis);
  const before=row.filter(t=>end(t,axis)<=start(m,axis)).sort((p,q)=>end(q,axis)-end(p,axis)),after=row.filter(t=>start(t,axis)>=end(m,axis)).sort((p,q)=>start(p,axis)-start(q,axis));
  const l=before[0],r=after[0],candidates:{at:number;gaps:(at:number)=>[number,number][]}[]=[];
  if(l&&r){const gap=(start(r,axis)-end(l,axis)-size)/2;if(gap>=0)candidates.push({at:end(l,axis)+gap,gaps:at=>[[end(l,axis),at],[at+size,start(r,axis)]]});}
  const l2=l?before.find(t=>end(t,axis)<=start(l,axis)):undefined;
  if(l&&l2){const step=start(l,axis)-end(l2,axis);candidates.push({at:end(l,axis)+step,gaps:at=>[[end(l2,axis),start(l,axis)],[end(l,axis),at]]});}
  const r2=r?after.find(t=>start(t,axis)>=end(r,axis)):undefined;
  if(r&&r2){const step=start(r2,axis)-end(r,axis);candidates.push({at:start(r,axis)-step-size,gaps:at=>[[at+size,start(r,axis)],[end(r,axis),start(r2,axis)]]});}
  let best:GapSnap|null=null;
  for(const c of candidates){const delta=c.at-start(m,axis);if(Math.abs(delta)<=threshold&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,gaps:c.gaps(c.at)};}
  return best;
}
export function snapMove(moving:Bounds,targets:Bounds[],threshold:number):MoveSnap{
  const delta={x:0,y:0},spacing:Record<Axis,GapSnap|null>={x:null,y:null};
  for(const axis of AXES){
    const align=nearest(lines(moving,axis),targets.flatMap(t=>lines(t,axis)),threshold),gap=gapSnap(moving,targets,axis,threshold);
    // Alignment wins a tie.
    if(align!==null&&(!gap||Math.abs(align)<=Math.abs(gap.delta)))delta[axis]=align;
    else if(gap){delta[axis]=gap.delta;spacing[axis]=gap;}
  }
  const snapped={...moving,x:moving.x+delta.x,y:moving.y+delta.y},guides:Guide[]=[];
  for(const axis of AXES){
    guides.push(...alignGuides(snapped,targets,axis,lines(snapped,axis)));
    const o=other(axis),at=start(snapped,o)+length(snapped,o)/2;
    for(const [from,to] of spacing[axis]?.gaps??[])guides.push({type:'gap',axis,start:from,end:to,at});
  }
  return{dx:delta.x,dy:delta.y,guides};
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
