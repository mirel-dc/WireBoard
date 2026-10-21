import type {Bounds,Element,Kind} from './types';
import type {Point} from './anchors';
import {reducedMotion} from './camera';
import {setAttrs,svgElement} from './svg';
import {SIDES,type Side} from './placement';
import type {Guide} from './snap';
const ACCENT='#7e4bb2';
const GUIDE='#e8467c';
// Screen pixels from the block edge to the farthest handle edge (40 + radius 11 + 1): hover stays alive within this reach.
export const HANDLE_REACH=52;
export const DOT_OFFSET=14,PLUS_OFFSET=40,PLUS_RADIUS=11;
const OUT={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]} as const;
// The point `offset` screen pixels outward from the middle of a block side.
export function sidePoint(b:Bounds,side:Side,offset:number,zoom:number):Point{const [ox,oy]=OUT[side];return{x:b.x+b.width*(ox?(ox>0?1:0):.5)+ox*offset/zoom,y:b.y+b.height*(oy?(oy>0?1:0):.5)+oy*offset/zoom};}
const HANDLES=[['nw',0,0,'nwse'],['n',.5,0,'ns'],['ne',1,0,'nesw'],['e',1,.5,'ew'],['se',1,1,'nwse'],['s',.5,1,'ns'],['sw',0,1,'nesw'],['w',0,.5,'ew']] as const;
export interface OverlayState{selected:Element[];connectorEnds:{id:number;from:Point|null;to:Point|null}|null;hover:Element|null;marquee:Bounds|null;drop:Element|null;create:{bounds:Bounds;kind:Kind}|null;connectorTarget:{element:Element;port:Point}|null;connect:Element|null;wire:Point[]|null;guides:Guide[];zoom:number}
const show=(node:globalThis.Element,visible:boolean)=>setAttrs(node,{display:visible?'inline':'none'});
// Nodes are created once and only updated, so a frame never rebuilds the overlay.
export class OverlayRenderer {
  private hover=svgElement('rect',{'data-hover':'',rx:6,fill:'none',stroke:ACCENT,'stroke-opacity':.55,'pointer-events':'none',display:'none'});
  private drop=svgElement('rect',{rx:4,fill:'#7e4bb211',stroke:ACCENT,'pointer-events':'none',display:'none'});
  private create=svgElement('g',{'pointer-events':'none',display:'none'});private createRect=svgElement('rect');private createLabel=svgElement('text',{fill:'#51316f','font-family':'Golos Text'});
  private wire=svgElement('path',{'data-wire-preview':'',fill:'none',stroke:ACCENT,'stroke-linecap':'round','pointer-events':'none',display:'none'});
  private target=svgElement('g',{'pointer-events':'none',display:'none'});private targetRect=svgElement('rect',{rx:5,fill:'#7e4bb211',stroke:ACCENT});private targetDot=svgElement('circle',{fill:ACCENT});
  private frames=svgElement('g',{'pointer-events':'none'});private controls=svgElement('g');
  private handles=HANDLES.map(([handle,,,cursor])=>{const g=svgElement('g',{'data-handle':handle,cursor:`${cursor}-resize`,display:'none'});g.append(svgElement('rect',{fill:'transparent'}),svgElement('rect',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private ends=(['from','to'] as const).map(end=>{const g=svgElement('g',{'data-end':end,cursor:'crosshair','aria-label':end==='from'?'Начало связи':'Конец связи',display:'none'});g.append(svgElement('circle',{fill:'transparent'}),svgElement('circle',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private marquee=svgElement('rect',{fill:'#7e4bb220',stroke:ACCENT,'pointer-events':'none',display:'none'});
  private guides=svgElement('g',{'data-guides':'','pointer-events':'none'});
  private connect=svgElement('g');private connectKey='';
  private dots=SIDES.map(side=>{const g=svgElement('g',{'data-side':side,cursor:'crosshair',display:'none','aria-label':'Протянуть связь'});g.append(svgElement('circle',{fill:'transparent'}),svgElement('circle',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private adds=SIDES.map(side=>{const g=svgElement('g',{'data-side':side,cursor:'pointer',display:'none','aria-label':'Добавить блок со связью'});g.append(svgElement('circle',{fill:ACCENT}),svgElement('path',{fill:'none',stroke:'#ffffff','stroke-linecap':'round','pointer-events':'none'}));return g;});
  private selectionKey='';
  constructor(root:SVGGElement){this.create.append(this.createRect,this.createLabel);this.target.append(this.targetRect,this.targetDot);this.controls.append(...this.handles,...this.ends);this.connect.append(...this.dots,...this.adds);root.replaceChildren(this.hover,this.drop,this.create,this.wire,this.target,this.frames,this.guides,this.connect,this.controls,this.marquee);}
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
    show(this.wire,!!s.wire?.length);if(s.wire?.length)setAttrs(this.wire,{d:s.wire.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),'stroke-width':2/z});
    const boxes=s.selected.filter(e=>e.kind!=='connector');
    while(this.frames.childElementCount<boxes.length)this.frames.append(svgElement('rect',{rx:6,fill:'none',stroke:ACCENT}));
    [...this.frames.children].forEach((rect,i)=>{const e=boxes[i];show(rect,!!e);if(e)setAttrs(rect,{x:e.x-4,y:e.y-4,width:e.width+8,height:e.height+8,'stroke-width':1.5/z});});
    const single=s.selected.length===1&&s.selected[0].kind!=='connector'?s.selected[0]:null;
    this.handles.forEach((g,i)=>{show(g,!!single);if(!single){g.removeAttribute('data-resize');return;}const [,u,v]=HANDLES[i],x=single.x+single.width*u,y=single.y+single.height*v,size=24/z,mark=8/z;setAttrs(g,{'data-resize':single.id});setAttrs(g.children[0],{x:x-size/2,y:y-size/2,width:size,height:size});setAttrs(g.children[1],{x:x-mark/2,y:y-mark/2,width:mark,height:mark,rx:1.5/z,'stroke-width':1/z});});
    this.ends.forEach((g,i)=>{const ends=s.connectorEnds,p=ends?(i===0?ends.from:ends.to):null;show(g,!!p);if(!p||!ends){g.removeAttribute('data-connector-end');return;}setAttrs(g,{'data-connector-end':ends.id});setAttrs(g.children[0],{cx:p.x,cy:p.y,r:12/z});setAttrs(g.children[1],{cx:p.x,cy:p.y,r:4/z,'stroke-width':1.5/z});});
    show(this.marquee,!!s.marquee);if(s.marquee)setAttrs(this.marquee,{...s.marquee,'stroke-width':1/z});
    this.paintGuides(s.guides,z);
    const c=s.connect,visible=!!c&&c.width*z>=40&&c.height*z>=40;
    SIDES.forEach((side,i)=>{
      const dot=this.dots[i],add=this.adds[i];show(dot,visible);show(add,visible);
      if(!visible||!c){dot.removeAttribute('data-connect');add.removeAttribute('data-add');return;}
      const {x:dx,y:dy}=sidePoint(c,side,DOT_OFFSET,z),{x:ax,y:ay}=sidePoint(c,side,PLUS_OFFSET,z),p=5/z;
      setAttrs(dot,{'data-connect':c.id});setAttrs(dot.children[0],{cx:dx,cy:dy,r:12/z});setAttrs(dot.children[1],{cx:dx,cy:dy,r:5/z,'stroke-width':1.5/z});
      setAttrs(add,{'data-add':c.id});setAttrs(add.children[0],{cx:ax,cy:ay,r:PLUS_RADIUS/z});setAttrs(add.children[1],{d:`M ${ax-p} ${ay} H ${ax+p} M ${ax} ${ay-p} V ${ay+p}`,'stroke-width':2/z});
    });
    const connectKey=visible&&c?String(c.id):'';
    if(connectKey!==this.connectKey){this.connectKey=connectKey;if(connectKey&&!reducedMotion())this.connect.animate([{opacity:0},{opacity:1}],{duration:80,easing:'ease-out'});}
    const key=s.selected.map(e=>e.id).join(',');
    if(key!==this.selectionKey){this.selectionKey=key;if(key&&!reducedMotion())for(const layer of [this.frames,this.controls])layer.animate([{opacity:0},{opacity:1}],{duration:80,easing:'ease-out'});}
  }
  // Pooled guide groups: a path with its ticks, and for a gap its length on a white plate.
  private paintGuides(guides:Guide[],z:number){
    while(this.guides.childElementCount<guides.length){const g=svgElement('g',{display:'none'});g.append(svgElement('path',{fill:'none',stroke:GUIDE}),svgElement('rect',{fill:'#ffffff'}),svgElement('text',{fill:GUIDE,'font-family':'Golos Text','text-anchor':'middle','dominant-baseline':'central'}));this.guides.append(g);}
    [...this.guides.children].forEach((node,i)=>{
      const guide=guides[i];show(node,!!guide);if(!guide){node.removeAttribute('data-guide');node.removeAttribute('data-axis');return;}
      const path=node.children[0],plate=node.children[1],label=node.children[2],t=4/z;let d='',text='',lx=0,ly=0;
      if(guide.type==='align')d=guide.axis==='x'?`M ${guide.at} ${guide.from} V ${guide.to}`:`M ${guide.from} ${guide.at} H ${guide.to}`;
      else{
        const b=guide.type==='size'?guide.bounds:null,[s,e,at]=b?guide.axis==='x'?[b.x,b.x+b.width,b.y-8/z]:[b.y,b.y+b.height,b.x+b.width+8/z]:guide.type==='gap'?[guide.start,guide.end,guide.at]:[0,0,0];
        d=guide.axis==='x'?`M ${s} ${at} H ${e} M ${s} ${at-t} V ${at+t} M ${e} ${at-t} V ${at+t}`:`M ${at} ${s} V ${e} M ${at-t} ${s} H ${at+t} M ${at-t} ${e} H ${at+t}`;
        if(guide.type==='gap'){text=String(Math.round(e-s));[lx,ly]=guide.axis==='x'?[(s+e)/2,at]:[at,(s+e)/2];}
      }
      setAttrs(node,{'data-guide':guide.type,'data-axis':guide.axis});setAttrs(path,{d,'stroke-width':1/z});
      show(plate,!!text);show(label,!!text);label.textContent=text;
      if(text){const w=(text.length*7+8)/z,h=16/z;setAttrs(plate,{x:lx-w/2,y:ly-h/2,width:w,height:h,rx:3/z});setAttrs(label,{x:lx,y:ly,'font-size':11/z});}
    });
  }
}
