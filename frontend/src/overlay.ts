import type {Bounds,Element,Kind} from './types';
import type {Point} from './anchors';
import {reducedMotion} from './camera';
import {setAttrs,svgElement} from './svg';
const ACCENT='#7e4bb2';
const HANDLES=[['nw',0,0,'nwse'],['n',.5,0,'ns'],['ne',1,0,'nesw'],['e',1,.5,'ew'],['se',1,1,'nwse'],['s',.5,1,'ns'],['sw',0,1,'nesw'],['w',0,.5,'ew']] as const;
export interface OverlayState{selected:Element[];connectorEnds:{id:number;from:Point|null;to:Point|null}|null;hover:Element|null;marquee:Bounds|null;drop:Element|null;create:{bounds:Bounds;kind:Kind}|null;connectorTarget:{element:Element;port:Point}|null;zoom:number}
const show=(node:globalThis.Element,visible:boolean)=>setAttrs(node,{display:visible?'inline':'none'});
// Nodes are created once and only updated, so a frame never rebuilds the overlay.
export class OverlayRenderer {
  private hover=svgElement('rect',{'data-hover':'',rx:6,fill:'none',stroke:ACCENT,'stroke-opacity':.55,'pointer-events':'none',display:'none'});
  private drop=svgElement('rect',{rx:4,fill:'#7e4bb211',stroke:ACCENT,'pointer-events':'none',display:'none'});
  private create=svgElement('g',{'pointer-events':'none',display:'none'});private createRect=svgElement('rect');private createLabel=svgElement('text',{fill:'#51316f','font-family':'Golos Text'});
  private target=svgElement('g',{'pointer-events':'none',display:'none'});private targetRect=svgElement('rect',{rx:5,fill:'#7e4bb211',stroke:ACCENT});private targetDot=svgElement('circle',{fill:ACCENT});
  private frames=svgElement('g',{'pointer-events':'none'});private controls=svgElement('g');
  private handles=HANDLES.map(([handle,,,cursor])=>{const g=svgElement('g',{'data-handle':handle,cursor:`${cursor}-resize`,display:'none'});g.append(svgElement('rect',{fill:'transparent'}),svgElement('rect',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private ends=(['from','to'] as const).map(end=>{const g=svgElement('g',{'data-end':end,cursor:'crosshair','aria-label':end==='from'?'Начало связи':'Конец связи',display:'none'});g.append(svgElement('circle',{fill:'transparent'}),svgElement('circle',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private marquee=svgElement('rect',{fill:'#7e4bb220',stroke:ACCENT,'pointer-events':'none',display:'none'});
  private selectionKey='';
  constructor(root:SVGGElement){this.create.append(this.createRect,this.createLabel);this.target.append(this.targetRect,this.targetDot);this.controls.append(...this.handles,...this.ends);root.replaceChildren(this.hover,this.drop,this.create,this.target,this.frames,this.controls,this.marquee);}
  render(s:OverlayState):void{
    const z=s.zoom;
    show(this.hover,!!s.hover);if(s.hover)setAttrs(this.hover,{x:s.hover.x-2,y:s.hover.y-2,width:s.hover.width+4,height:s.hover.height+4,'stroke-width':1/z});
    show(this.drop,!!s.drop);if(s.drop)setAttrs(this.drop,{'data-drop-target':s.drop.id,x:s.drop.x,y:s.drop.y,width:s.drop.width,height:s.drop.height,'stroke-width':2/z,'stroke-dasharray':`${6/z} ${4/z}`});else this.drop.removeAttribute('data-drop-target');
    show(this.create,!!s.create);
    if(s.create){const b=s.create.bounds,k=s.create.kind;setAttrs(this.create,{'data-creation-preview':k});setAttrs(this.createRect,{...b,rx:k==='frame'?12:5,fill:k==='text'?'none':k==='frame'?'#e0f0e844':'#eee5f866',stroke:ACCENT,'stroke-width':1.5/z,'stroke-dasharray':`${5/z} ${3/z}`});setAttrs(this.createLabel,{x:b.x,y:b.y-10/z,'font-size':12/z});this.createLabel.textContent=`${Math.round(b.width)} × ${Math.round(b.height)}`;}
    else this.create.removeAttribute('data-creation-preview');
    show(this.target,!!s.connectorTarget);
    if(s.connectorTarget){const {element:e,port}=s.connectorTarget;setAttrs(this.target,{'data-connector-target':e.id});setAttrs(this.targetRect,{x:e.x,y:e.y,width:e.width,height:e.height,'stroke-width':2/z});setAttrs(this.targetDot,{cx:port.x,cy:port.y,r:5/z});}
    else this.target.removeAttribute('data-connector-target');
    const boxes=s.selected.filter(e=>e.kind!=='connector');
    while(this.frames.childElementCount<boxes.length)this.frames.append(svgElement('rect',{rx:6,fill:'none',stroke:ACCENT}));
    [...this.frames.children].forEach((rect,i)=>{const e=boxes[i];show(rect,!!e);if(e)setAttrs(rect,{x:e.x-4,y:e.y-4,width:e.width+8,height:e.height+8,'stroke-width':1.5/z});});
    const single=s.selected.length===1&&s.selected[0].kind!=='connector'?s.selected[0]:null;
    this.handles.forEach((g,i)=>{show(g,!!single);if(!single){g.removeAttribute('data-resize');return;}const [,u,v]=HANDLES[i],x=single.x+single.width*u,y=single.y+single.height*v,size=24/z,mark=8/z;setAttrs(g,{'data-resize':single.id});setAttrs(g.children[0],{x:x-size/2,y:y-size/2,width:size,height:size});setAttrs(g.children[1],{x:x-mark/2,y:y-mark/2,width:mark,height:mark,rx:1.5/z,'stroke-width':1/z});});
    this.ends.forEach((g,i)=>{const ends=s.connectorEnds,p=ends?(i===0?ends.from:ends.to):null;show(g,!!p);if(!p||!ends){g.removeAttribute('data-connector-end');return;}setAttrs(g,{'data-connector-end':ends.id});setAttrs(g.children[0],{cx:p.x,cy:p.y,r:12/z});setAttrs(g.children[1],{cx:p.x,cy:p.y,r:4/z,'stroke-width':1.5/z});});
    show(this.marquee,!!s.marquee);if(s.marquee)setAttrs(this.marquee,{...s.marquee,'stroke-width':1/z});
    const key=s.selected.map(e=>e.id).join(',');
    if(key!==this.selectionKey){this.selectionKey=key;if(key&&!reducedMotion())for(const layer of [this.frames,this.controls])layer.animate([{opacity:0},{opacity:1}],{duration:80,easing:'ease-out'});}
  }
}
