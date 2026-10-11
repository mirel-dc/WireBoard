import type { Board, Element, Port } from './types';
export type Point = { x: number; y: number };
export type ConnectorEnd='from'|'to';
export interface ConnectorTarget{id:number;port:Port}
export function connectorTarget(board:Board,link:Element,end:ConnectorEnd,point:Point,zoom:number):ConnectorTarget|null{
  const nodes=board.elements.filter(e=>!['frame','connector'].includes(e.kind)).slice().reverse(),halo=12/zoom;
  const inside=(e:Element,padding:number)=>point.x>=e.x-padding&&point.x<=e.x+e.width+padding&&point.y>=e.y-padding&&point.y<=e.y+e.height+padding;
  const hit=nodes.find(e=>inside(e,0))??nodes.find(e=>inside(e,halo));
  if(!hit||hit.id===link[end==='from'?'to':'from'])return null;
  const sides=[['left',Math.hypot(point.x-hit.x,point.y-hit.y-hit.height/2)],['right',Math.hypot(point.x-hit.x-hit.width,point.y-hit.y-hit.height/2)],['top',Math.hypot(point.x-hit.x-hit.width/2,point.y-hit.y)],['bottom',Math.hypot(point.x-hit.x-hit.width/2,point.y-hit.y-hit.height)]]as const;
  const port=[...sides].sort((a,b)=>a[1]-b[1])[0][0];return{id:hit.id,port};
}
export function connectorPreviewPoints(board:Board,link:Element,end:ConnectorEnd,point:Point,target:ConnectorTarget|null):Point[]{
  if(target)return connectorPoints(board,{...link,[end]:target.id,[`${end}Port`]:target.port},e=>e);
  const a=board.elements.find(e=>e.id===link.from),b=board.elements.find(e=>e.id===link.to);if(!a||!b)return [];
  const fixed=end==='from'?portPoint(b,link.toPort,a):portPoint(a,link.fromPort,b);
  if(end==='from')return[point,fixed.horizontal?{x:point.x,y:fixed.y}:{x:fixed.x,y:point.y},fixed];
  return[fixed,fixed.horizontal?{x:point.x,y:fixed.y}:{x:fixed.x,y:point.y},point];
}
function portPoint(e: Element, port: Port, target: Element): Point & { horizontal: boolean } {
  if (port === 'auto') { const dx = target.x + target.width / 2 - e.x - e.width / 2, dy = target.y + target.height / 2 - e.y - e.height / 2; port = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top'; }
  switch (port) { case 'left': return { x: e.x, y: e.y + e.height / 2, horizontal: true }; case 'right': return { x: e.x + e.width, y: e.y + e.height / 2, horizontal: true }; case 'top': return { x: e.x + e.width / 2, y: e.y, horizontal: false }; default: return { x: e.x + e.width / 2, y: e.y + e.height, horizontal: false }; }
}
/** Mirrors Rust's orthogonal route for ephemeral drag/resize previews only. */
export function connectorPoints(board: Board, link: Element, project: (e: Element) => Element): Point[] {
  const from = board.elements.find(e => e.id === link.from), to = board.elements.find(e => e.id === link.to); if (!from || !to) return [];
  const a = project(from), b = project(to), start = portPoint(a, link.fromPort, b), end = portPoint(b, link.toPort, a);
  if (start.horizontal && end.horizontal) return [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end];
  if (!start.horizontal && !end.horizontal) return [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end];
  return [start, start.horizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y }, end];
}
export function pointOnRoute(points: Point[], t: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y)); let distance = lengths.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lengths.length; i++) { const length = lengths[i]; if (length > 0 && distance <= length) { const a = points[i], b = points[i + 1], ratio = distance / length; return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }; } distance -= length; }
  return points.at(-1) ?? { x: 0, y: 0 };
}
