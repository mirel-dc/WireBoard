import type {Board,Element,FontMetrics,TextRow} from './types';
import type {Point} from './anchors';
import type {Dirty} from './frame';
import {layoutConnector,layoutElement,textWidth} from './preview';
import {setAttrs,svgElement} from './svg';
const SHAPES=['rectangle','text','image'];
function textNode(row:TextRow,anchor:string){const t=svgElement('text',{x:row.x,y:row.y,'font-family':'Golos Text','font-size':row.size,'font-weight':row.weight,'font-kerning':'none','font-variant-ligatures':'none','text-anchor':anchor,fill:'#302b3b','pointer-events':'none'});const span=svgElement('tspan',{x:row.x,y:row.y});span.textContent=row.text;t.append(span);return t;}
export class SceneRenderer {
  private groups=new Map<number,SVGGElement>();private signatures=new Map<number,string>();private images=new Map<number,string|null>();private zoom=1;editing:number|null=null;
  constructor(private root:SVGGElement,private defs:SVGDefsElement,private metrics:()=>FontMetrics|null){}
  clear():void{this.root.replaceChildren();this.defs.replaceChildren();this.groups.clear();this.signatures.clear();this.images.clear();}
  setZoom(zoom:number):void{this.zoom=zoom;for(const group of this.groups.values())if(group.dataset.kind==='frame')this.frameHeader(group,Number(group.dataset.titleWidth??0));}
  paint(board:Board,dirty:Dirty,project:(e:Element)=>Element,points:(e:Element)=>Point[],previewId:number|null):void{
    const metrics=this.metrics();if(!metrics)return;
    const live=new Set(board.elements.map(e=>e.id));
    for(const [id,group]of this.groups)if(!live.has(id)){group.remove();this.groups.delete(id);this.signatures.delete(id);this.images.delete(id);}
    for(const e of board.elements)if(e.kind!=='connector'&&(dirty==='all'||dirty.has(e.id)))this.paintElement(project(e),metrics);
    // Captions avoid the projected obstacles, so connectors use the projected board.
    const projected={...board,elements:board.elements.map(project)};
    for(const e of projected.elements)if(e.kind==='connector')this.paintConnector(projected,e,metrics,points(e),previewId===e.id);
    this.syncMarkers(board);
  }
  private groupFor(e:Element):SVGGElement{
    let group=this.groups.get(e.id);if(group)return group;
    group=svgElement('g',{'data-id':e.id,'data-kind':e.kind});
    const first=(kinds:string[])=>[...this.root.children].find(n=>kinds.includes(n.getAttribute('data-kind')??''))??null;
    this.root.insertBefore(group,e.kind==='frame'?first(['connector',...SHAPES]):e.kind==='connector'?first(SHAPES):null);
    this.groups.set(e.id,group);return group;
  }
  private paintElement(e:Element,metrics:FontMetrics){
    const group=this.groupFor(e);setAttrs(group,{transform:`translate(${e.x} ${e.y})`});
    const tag=e.kind==='image'?'image':'rect';let shape=group.querySelector<SVGGraphicsElement>(':scope > rect:not([data-frame-header-hit]),:scope > image');
    if(!shape||shape.tagName!==tag){shape?.remove();shape=svgElement(tag);group.prepend(shape);}
    setAttrs(shape,{x:0,y:0,width:e.width,height:e.height,rx:e.kind==='frame'?12:5,fill:e.kind==='text'?'transparent':e.fill,stroke:e.kind==='text'?'none':e.kind==='frame'?'#b0bdb4':e.stroke,'stroke-width':e.kind==='frame'?1.5:2});
    if(e.kind==='image'&&this.images.get(e.id)!==e.image){this.images.set(e.id,e.image);setAttrs(shape,{href:e.image??'',preserveAspectRatio:'xMidYMid meet'});}
    if(e.kind==='frame'){this.paintFrame(group,e,metrics);return;}
    // Layout runs in element-local space: moving a block keeps its text nodes.
    const editing=this.editing===e.id,layout=layoutElement({...e,x:0,y:0},metrics),signature=editing?'editing':JSON.stringify(layout);
    if(this.signatures.get(e.id)===signature)return;this.signatures.set(e.id,signature);
    group.querySelectorAll(':scope > g,:scope > clipPath').forEach(n=>n.remove());
    // The inline editor draws this text while it is open.
    if(editing)return;
    const clip=svgElement('clipPath',{id:`text-${e.id}`});clip.append(svgElement('rect',{...layout.bounds}));
    const rows=svgElement('g',{'clip-path':`url(#text-${e.id})`,'data-fit-height':layout.fitHeight,'data-text-overflow':String(layout.overflow),'pointer-events':'none'});
    rows.append(...[...layout.title,...layout.body].map(row=>textNode(row,e.kind==='rectangle'?'middle':'start')));group.append(clip,rows);
  }
  private paintFrame(group:SVGGElement,e:Element,metrics:FontMetrics){
    const width=textWidth(e.text,15,e.fontWeight,metrics);group.dataset.titleWidth=String(width);this.frameHeader(group,width);
    let title=group.querySelector<SVGTextElement>(':scope > text');if(!title){title=svgElement('text',{'font-family':'Golos Text','font-size':15,fill:'#66786c','pointer-events':'none'});group.append(title);}
    setAttrs(title,{x:0,y:-12,'font-weight':e.fontWeight});if(title.textContent!==e.text)title.textContent=e.text;
  }
  private frameHeader(group:SVGGElement,titleWidth:number){
    let hit=group.querySelector<SVGRectElement>('[data-frame-header-hit]');if(!hit){hit=svgElement('rect',{'data-frame-header-hit':'',fill:'transparent','pointer-events':'all'});group.append(hit);}
    const z=this.zoom,height=Math.max(24/z,20);setAttrs(hit,{x:-4/z,y:-18-height/2,width:Math.max(24/z,titleWidth+8/z),height});
  }
  private paintConnector(board:Board,e:Element,metrics:FontMetrics,points:Point[],preview:boolean){
    const group=this.groupFor(e),layout=layoutConnector(board,e,metrics,points);
    if(preview)group.setAttribute('data-connector-preview',String(e.id));else group.removeAttribute('data-connector-preview');
    const d=points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
    let paths=group.querySelectorAll(':scope > path');if(!paths.length){group.prepend(svgElement('path'),svgElement('path'));paths=group.querySelectorAll(':scope > path');}
    setAttrs(paths[0],{d,fill:'none',stroke:e.stroke,'stroke-width':2,'marker-end':`url(#arrow-${e.id})`});setAttrs(paths[1],{d,fill:'none',stroke:'transparent','stroke-width':16});
    const signature=JSON.stringify([layout.captionBounds,layout.caption]);if(this.signatures.get(e.id)===signature)return;this.signatures.set(e.id,signature);
    group.querySelectorAll(':scope > rect,:scope > text').forEach(n=>n.remove());
    if(e.text)group.append(svgElement('rect',{...layout.captionBounds,rx:3,fill:'#ffffff','data-connector-label':'true'}),...layout.caption.map(row=>textNode(row,'middle')));
  }
  private syncMarkers(board:Board){
    const wanted=new Map(board.elements.filter(e=>e.kind==='connector').map(e=>[`arrow-${e.id}`,e.stroke]));
    for(const marker of [...this.defs.querySelectorAll('marker')]){const fill=wanted.get(marker.id);if(fill===undefined){marker.remove();continue;}setAttrs(marker.firstElementChild!,{fill});wanted.delete(marker.id);}
    for(const [id,fill]of wanted){const marker=svgElement('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill}));this.defs.append(marker);}
  }
}
