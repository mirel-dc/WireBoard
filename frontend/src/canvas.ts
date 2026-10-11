import type { Board, Element,FontMetrics,TextRow } from './types';
import {projectScene,textWidth} from './preview';
import { connectorPoints,connectorPreviewPoints,pointOnRoute,type ConnectorEnd,type ConnectorTarget, type Point } from './anchors';
const ns = 'http://www.w3.org/2000/svg';
function svgElement<K extends keyof SVGElementTagNameMap>(kind: K, attrs: Record<string, string | number>) { const node = document.createElementNS(ns, kind); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; }
export function members(board: Board, ids: number[]) {
  const set = new Set(ids);
  const frontier=board.elements.filter(e=>ids.includes(e.id)&&e.kind==='frame').map(e=>e.id);
  while(frontier.length){const parent=frontier.pop()!;for(const e of board.elements)if(e.parentFrameId===parent&&!set.has(e.id)){set.add(e.id);frontier.push(e.id);}}
  return [...set];
}
export function orderedFrames(board: Board) { return board.elements.filter(e => e.kind === 'frame').sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id); }
export class CanvasView {
  svg = document.querySelector<SVGSVGElement>('#canvas')!;
  world = document.querySelector<SVGGElement>('#world')!;
  scene = document.querySelector<SVGGElement>('#scene')!;
  overlay = document.querySelector<SVGGElement>('#selection')!;
  board: Board | null = null; selected: number[] = []; camera = { x: 80, y: 70, zoom: 1 }; onCamera: (() => void) | null = null;
  sourceBoard:Board|null=null;
  metrics:FontMetrics|null=null;private previewFrame:number|null=null;
  preview: { ids: number[]; dx: number; dy: number } | null = null;
  resizePreview: {id:number;width:number;height:number;x:number;y:number} | null = null;
  private connectorPreview:{board:Board;id:number;end:ConnectorEnd;point:Point;target:ConnectorTarget|null}|null=null;
  onPreview: (() => void) | null = null;
  constructor() { new ResizeObserver(() => this.updateCamera()).observe(this.svg); }
  setBoard(board: Board, source: string) {
    const preserve=this.metrics&&this.board?.id===board.id;
    this.board = board; this.sourceBoard=board;this.svg.dataset.board = board.id;
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml'); if (parsed.querySelector('parsererror')) throw new Error('Некорректное изображение доски');
    const defs = parsed.querySelector('defs'); defs?.querySelectorAll('style').forEach(el => el.remove());
    document.querySelector('#scene-defs')!.replaceChildren(...Array.from(defs?.children ?? []).map(el => document.importNode(el, true)));
    const scene = parsed.querySelector('#scene');if(!preserve)this.scene.replaceChildren(...Array.from(scene?.children ?? []).map(el => document.importNode(el, true)));
    this.scene.querySelectorAll('[data-id]:not([data-kind="frame"]) text').forEach(t=>t.setAttribute('pointer-events','none'));
    this.setSelection(this.selected); document.querySelector('#canvas-hint')!.toggleAttribute('hidden', board.elements.length > 0);
  }
  updateCamera() { this.world.setAttribute('transform', `translate(${this.camera.x} ${this.camera.y}) scale(${this.camera.zoom})`); const dots = document.querySelector('#dots')!; dots.setAttribute('patternTransform', `translate(${this.camera.x} ${this.camera.y}) scale(${this.camera.zoom})`);this.setSelection(this.selected); this.onCamera?.(); }
  worldPoint(clientX: number, clientY: number) { const rect = this.svg.getBoundingClientRect(); return { x: (clientX - rect.x - this.camera.x) / this.camera.zoom, y: (clientY - rect.y - this.camera.y) / this.camera.zoom }; }
  pan(dx:number,dy:number){this.camera.x=Math.max(-1e7,Math.min(1e7,this.camera.x-dx));this.camera.y=Math.max(-1e7,Math.min(1e7,this.camera.y-dy));this.updateCamera();}
  zoom(factor: number, clientX?: number, clientY?: number) {
    const rect = this.svg.getBoundingClientRect(); const x = clientX ?? rect.x + rect.width / 2, y = clientY ?? rect.y + rect.height / 2;
    const world = this.worldPoint(x, y); this.camera.zoom = Math.min(4, Math.max(.1, this.camera.zoom * factor)); this.camera.x = Math.max(-1e7,Math.min(1e7,x - rect.x - world.x * this.camera.zoom)); this.camera.y = Math.max(-1e7,Math.min(1e7,y - rect.y - world.y * this.camera.zoom)); this.updateCamera();
  }
  fit(frameId?: number) {
    if (!this.board) return; const elements = frameId === undefined ? this.board.elements.filter(e => e.kind !== 'connector') : this.board.elements.filter(e => e.id === frameId); if (!elements.length) { this.camera = { x: 80, y: 70, zoom: 1 }; this.updateCamera(); return; }
    const x = Math.min(...elements.map(e => e.x)), y = Math.min(...elements.map(e => e.y)) - 25, right = Math.max(...elements.map(e => e.x + e.width)), bottom = Math.max(...elements.map(e => e.y + e.height));
    const rect = this.svg.getBoundingClientRect(); const zoom = Math.min(1.25, Math.max(.1, Math.min((rect.width - 100) / (right - x), (rect.height - 160) / (bottom - y)))); this.camera = { x: (rect.width - (right - x) * zoom) / 2 - x * zoom, y: (rect.height - (bottom - y) * zoom) / 2 - y * zoom, zoom }; this.updateCamera();
  }
  setSelection(ids: number[]) {
    this.selected = ids.filter(id => this.board?.elements.some(e => e.id === id)); this.overlay.replaceChildren();
    for (const item of this.board?.elements.filter(e => this.selected.includes(e.id)) ?? []) {
      const e=this.project(item);
      if (e.kind === 'connector') {
        const group = this.scene.querySelector(`[data-id="${e.id}"]`); group?.setAttribute('data-selected', 'true');
        if(this.selected.length===1){const points=this.linkPoints(e);for(const [end,p]of [['from',points[0]],['to',points.at(-1)]]as const){if(!p)continue;const handle=svgElement('g',{'data-connector-end':e.id,'data-end':end,cursor:'crosshair','aria-label':end==='from'?'Начало связи':'Конец связи'});handle.append(svgElement('circle',{cx:p.x,cy:p.y,r:12/this.camera.zoom,fill:'transparent'}),svgElement('circle',{cx:p.x,cy:p.y,r:4/this.camera.zoom,fill:'#ffffff',stroke:'#7e4bb2','stroke-width':1.5/this.camera.zoom,'pointer-events':'none'}));this.overlay.append(handle);}}
        continue;
      }
      this.overlay.append(svgElement('rect', { x: e.x - 4, y: e.y - 4, width: e.width + 8, height: e.height + 8, rx: 6, fill: 'none', stroke: '#7e4bb2', 'stroke-width': 1.5 / this.camera.zoom, 'pointer-events': 'none' }));
      if (this.selected.length === 1)for(const [handle,u,v,cursor]of [['nw',0,0,'nwse'],['n',.5,0,'ns'],['ne',1,0,'nesw'],['e',1,.5,'ew'],['se',1,1,'nwse'],['s',.5,1,'ns'],['sw',0,1,'nesw'],['w',0,.5,'ew']]as const){const x=e.x+e.width*u,y=e.y+e.height*v,size=24/this.camera.zoom,mark=8/this.camera.zoom;const group=svgElement('g',{'data-resize':e.id,'data-handle':handle,cursor:`${cursor}-resize`});group.append(svgElement('rect',{x:x-size/2,y:y-size/2,width:size,height:size,fill:'transparent'}),svgElement('rect',{x:x-mark/2,y:y-mark/2,width:mark,height:mark,rx:1.5/this.camera.zoom,fill:'#ffffff',stroke:'#7e4bb2','stroke-width':1/this.camera.zoom,'pointer-events':'none'}));this.overlay.append(group);}
    }
    this.scene.querySelectorAll('[data-selected]').forEach(el => { if (!this.selected.includes(Number(el.getAttribute('data-id')))) el.removeAttribute('data-selected'); });
  }
  project(e:Element):Element;
  project(board:Board):void;
  project(input:Element|Board):Element|void {
    if('kind' in input){const resize=this.resizePreview?.id===input.id?this.resizePreview:null;const move=this.preview?.ids.includes(input.id)?this.preview:null;return {...input,x:resize?.x??input.x+(move?.dx??0),y:resize?.y??input.y+(move?.dy??0),width:resize?.width??input.width,height:resize?.height??input.height};}
    this.board=input;this.syncGeometry();this.setSelection(this.selected);this.onPreview?.();
  }
  private syncGeometry(){
    if(!this.board)return;
    if(this.metrics){if(this.previewFrame===null)this.previewFrame=requestAnimationFrame(()=>{this.previewFrame=null;this.paintScene();});return;}
    for(const e of this.board.elements.filter(e=>e.kind!=='connector')) {
      const projected=this.project(e),base=this.sourceBoard?.elements.find(n=>n.id===e.id);if(!base)continue;
      const group=this.scene.querySelector(`[data-id="${e.id}"]`);group?.setAttribute('transform',`translate(${projected.x-base.x} ${projected.y-base.y})`);
      const shape=group?.querySelector('rect,image');shape?.setAttribute('width',String(projected.width));shape?.setAttribute('height',String(projected.height));
    }
    for(const group of this.scene.querySelectorAll('[data-id]')){const id=Number(group.getAttribute('data-id'));(group as SVGElement).style.display=this.board.elements.some(e=>e.id===id)?'':'none';}
    this.previewLinks();
  }
  private paintScene(){
    if(!this.board||!this.metrics)return;
    const board={...this.board,elements:this.board.elements.map(e=>this.project(e))},scene=projectScene(board,this.metrics);
    const groupFor=(e:Element)=>{let group=this.scene.querySelector<SVGGElement>(`[data-id="${e.id}"]`);if(!group){group=svgElement('g',{'data-id':e.id,'data-kind':e.kind});const before=e.kind==='frame'?this.scene.querySelector('[data-kind="connector"],[data-kind="Rectangle"],[data-kind="rectangle"],[data-kind="Text"],[data-kind="text"],[data-kind="image"],[data-kind="Image"]'):e.kind==='connector'?this.scene.querySelector('[data-kind="Rectangle"],[data-kind="rectangle"],[data-kind="Text"],[data-kind="text"],[data-kind="image"],[data-kind="Image"]'):null;this.scene.insertBefore(group,before);}group.removeAttribute('transform');group.style.display='';return group;};
    const attrs=(node:globalThis.Element,values:Record<string,string|number>)=>{for(const [key,value]of Object.entries(values))node.setAttribute(key,String(value));};
    const text=(row:TextRow,anchor:string)=>{const t=svgElement('text',{x:row.x,y:row.y,'font-family':'Golos Text','font-size':row.size,'font-weight':row.weight,'font-kerning':'none','font-variant-ligatures':'none','text-anchor':anchor,fill:'#302b3b','pointer-events':'none'});const span=svgElement('tspan',{x:row.x,y:row.y});span.textContent=row.text;t.append(span);return t;};
    for(const layout of scene.elements){
      const e=board.elements.find(e=>e.id===layout.id)!,group=groupFor(e);
      let shape=group.querySelector(':scope > rect,:scope > image');if(!shape){shape=svgElement(e.kind==='image'?'image':'rect',{});group.prepend(shape);}
      attrs(shape,{...layout.bounds,rx:e.kind==='frame'?12:5,fill:e.kind==='text'?'transparent':e.fill,stroke:e.kind==='text'?'none':e.kind==='frame'?'#b0bdb4':e.stroke,'stroke-width':e.kind==='frame'?1.5:2});
      if(e.kind==='image')attrs(shape,{href:e.image??'',preserveAspectRatio:'xMidYMid meet'});
      if(e.kind==='frame'){
        let hit=group.querySelector('[data-frame-header-hit]');if(!hit){hit=svgElement('rect',{'data-frame-header-hit':'','fill':'transparent','pointer-events':'all'});group.append(hit);}
        const height=Math.max(24/this.camera.zoom,20);attrs(hit,{x:e.x-4/this.camera.zoom,y:e.y-18-height/2,width:Math.max(24/this.camera.zoom,textWidth(e.text,15,e.fontWeight,this.metrics)+8/this.camera.zoom),height});
        let title=group.querySelector(':scope > text');if(!title){title=svgElement('text',{});group.append(title);}attrs(title,{x:e.x,y:e.y-12,'font-family':'Golos Text','font-size':15,'font-weight':e.fontWeight,fill:'#66786c','pointer-events':'none'});title.textContent=e.text;continue;
      }
      // Preserve the shape target between clicks; repaint only changed text rows.
      const signature=JSON.stringify(layout);if(group.dataset.layout===signature)continue;group.dataset.layout=signature;
      group.querySelectorAll(':scope > g,:scope > clipPath').forEach(n=>n.remove());
      const clip=svgElement('clipPath',{id:`text-${e.id}`});clip.append(svgElement('rect',{...layout.bounds}));const rows=svgElement('g',{'clip-path':`url(#text-${e.id})`,'data-fit-height':layout.fitHeight,'data-text-overflow':String(layout.overflow),'pointer-events':'none'});rows.append(...[...layout.title,...layout.body].map(row=>text(row,e.kind==='rectangle'?'middle':'start')));group.append(clip,rows);
    }
    for(const layout of scene.connectors){const e=board.elements.find(e=>e.id===layout.id)!,group=groupFor(e);if(this.connectorPreview?.id===e.id){const points=this.linkPoints(e),a=pointOnRoute(layout.points,.5),b=pointOnRoute(points,.5),dx=b.x-a.x,dy=b.y-a.y;layout.points=points;layout.captionBounds={...layout.captionBounds,x:layout.captionBounds.x+dx,y:layout.captionBounds.y+dy};layout.caption=layout.caption.map(r=>({...r,x:r.x+dx,y:r.y+dy}));group.setAttribute('data-connector-preview',String(e.id));}else group.removeAttribute('data-connector-preview');const d=layout.points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');let paths=group.querySelectorAll(':scope > path');if(!paths.length){group.prepend(svgElement('path',{}),svgElement('path',{}));paths=group.querySelectorAll(':scope > path');}attrs(paths[0],{d,fill:'none',stroke:e.stroke,'stroke-width':2,'marker-end':`url(#arrow-${e.id})`});attrs(paths[1],{d,fill:'none',stroke:'transparent','stroke-width':16});const signature=JSON.stringify(layout.caption);if(group.dataset.layout!==signature){group.dataset.layout=signature;group.querySelectorAll(':scope > rect,:scope > text').forEach(n=>n.remove());if(e.text)group.append(svgElement('rect',{...layout.captionBounds,rx:3,fill:'#ffffff','data-connector-label':'true'}),...layout.caption.map(row=>text(row,'middle')));}}
    for(const group of this.scene.querySelectorAll('[data-id]'))if(!board.elements.some(e=>e.id===Number(group.getAttribute('data-id'))))(group as SVGElement).style.display='none';
    this.onPreview?.();
  }
  private linkPoints(e:Element){const p=this.connectorPreview;if(p?.id===e.id){const link=p.board.elements.find(n=>n.id===e.id)!;return connectorPreviewPoints(p.board,link,p.end,p.point,p.target);}return this.board?connectorPoints(this.board,e,n=>this.project(n)):[];}
  private previewLinks(){if(!this.board)return;for(const e of this.board.elements.filter(e=>e.kind==='connector')){const d=this.linkPoints(e).map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');this.scene.querySelectorAll(`[data-id="${e.id}"] path`).forEach(path=>path.setAttribute('d',d));}}
  previewConnector(board:Board,id:number,end:ConnectorEnd,point:Point,target:ConnectorTarget|null){
    this.connectorPreview={board,id,end,point,target};this.world.querySelector('[data-connector-target]')?.remove();
    const e=board.elements.find(n=>n.id===target?.id);if(e){const group=svgElement('g',{'data-connector-target':e.id,'pointer-events':'none'}),points=this.linkPoints(board.elements.find(n=>n.id===id)!),port=end==='from'?points[0]:points.at(-1)!;group.append(svgElement('rect',{x:e.x,y:e.y,width:e.width,height:e.height,rx:5,fill:'#7e4bb211',stroke:'#7e4bb2','stroke-width':2/this.camera.zoom}),svgElement('circle',{cx:port.x,cy:port.y,r:5/this.camera.zoom,fill:'#7e4bb2'}));this.world.append(group);}
    this.syncGeometry();this.setSelection(this.selected);this.onPreview?.();
  }
  previewMove(ids: number[], dx: number, dy: number) { this.preview = { ids, dx, dy };this.syncGeometry();this.setSelection(this.selected);this.onPreview?.(); }
  previewResize(id:number,width:number,height:number,x=this.board!.elements.find(e=>e.id===id)!.x,y=this.board!.elements.find(e=>e.id===id)!.y){this.resizePreview={id,width,height,x,y};this.syncGeometry();this.setSelection(this.selected);this.onPreview?.();}
  highlightDrop(frameId:number|null){this.world.querySelector('[data-drop-target]')?.remove();const e=this.board?.elements.find(e=>e.id===frameId);if(e)this.world.append(svgElement('rect',{x:e.x,y:e.y,width:e.width,height:e.height,rx:4,fill:'#7e4bb211',stroke:'#7e4bb2','stroke-width':2/this.camera.zoom,'stroke-dasharray':`${6/this.camera.zoom} ${4/this.camera.zoom}`,'pointer-events':'none','data-drop-target':e.id}));}
  previewCreate(bounds:{x:number;y:number;width:number;height:number},kind:Element['kind']){
    this.world.querySelector('[data-creation-preview]')?.remove();
    const group=svgElement('g',{'data-creation-preview':kind,'pointer-events':'none'});
    group.append(svgElement('rect',{...bounds,rx:kind==='frame'?12:5,fill:kind==='text'?'none':kind==='frame'?'#e0f0e844':'#eee5f866',stroke:'#7e4bb2','stroke-width':1.5/this.camera.zoom,'stroke-dasharray':`${5/this.camera.zoom} ${3/this.camera.zoom}`}));
    const label=svgElement('text',{x:bounds.x,y:bounds.y-10/this.camera.zoom,fill:'#51316f','font-family':'Golos Text','font-size':12/this.camera.zoom});label.textContent=`${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;group.append(label);this.world.append(group);
  }
  clearPreview() { this.preview = null;this.resizePreview=null;this.connectorPreview=null;this.world.querySelector('[data-creation-preview]')?.remove();this.world.querySelector('[data-connector-target]')?.remove();this.scene.querySelectorAll('[data-connector-preview]').forEach(e=>e.removeAttribute('data-connector-preview'));this.overlay.removeAttribute('transform');this.syncGeometry(); this.onPreview?.(); }
  reveal(point:Point){const rect=this.svg.getBoundingClientRect();this.camera.x=rect.width/2-point.x*this.camera.zoom;this.camera.y=rect.height/2-point.y*this.camera.zoom;this.updateCamera();}
  marquee(x: number, y: number, width: number, height: number) { this.overlay.replaceChildren(svgElement('rect', { x, y, width, height, fill: '#7e4bb220', stroke: '#7e4bb2', 'stroke-width': 1 / this.camera.zoom, 'pointer-events': 'none' })); }
  elementAt(target: EventTarget | null): Element | undefined { const id = (target as globalThis.Element | null)?.closest?.('[data-id]')?.getAttribute('data-id'); return this.board?.elements.find(e => e.id === Number(id)); }
}
