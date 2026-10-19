import type {Board,Element} from './types';
const FIELDS:readonly (keyof Element)[]=['kind','x','y','width','height','text','title','fontWeight','fill','stroke','fontSize','from','to','fromPort','toPort','image','parentFrameId'];
export const sameElement=(a:Element,b:Element)=>FIELDS.every(field=>a[field]===b[field]);
export function changedIds(prev:Board|null,next:Board):Set<number>|'all'{
  if(!prev||prev.id!==next.id)return 'all';
  const before=new Map(prev.elements.map(e=>[e.id,e])),changed=new Set<number>();
  for(const e of next.elements){const old=before.get(e.id);if(!old||!sameElement(old,e))changed.add(e.id);before.delete(e.id);}
  for(const id of before.keys())changed.add(id);
  return changed;
}
