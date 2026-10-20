import {CanvasView,members} from './canvas';
import {wheelIntent} from './navigation';
import {isDiscreteZoom} from './camera';
import {connectorTarget,type ConnectorEnd,type ConnectorTarget} from './anchors';
import type {Anchor,Board,EditState,Element,Kind,Operation} from './types';
export type Tool='select'|'hand'|'comment'|Kind;
export type ResizeHandle='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
export interface Bounds{x:number;y:number;width:number;height:number}
interface Point{x:number;y:number}
interface Nudge{ids:number[];base:EditState;dx:number;dy:number;held:Set<string>}
interface Callbacks{current():Board|null;editState():EditState;busy():boolean;apply(operations:Operation[],revision?:number,base?:EditState):Promise<boolean>;create(element:Partial<Element>&{kind:Kind},base:EditState):void;select(ids:number[]):void;edit(id:number):void;comment(anchor:Anchor,clientPoint:Point):void;tool(tool:Tool):void;changed():void;report(error:unknown):void}
type Gesture=({type:'pan';x:number;y:number;cameraX:number;cameraY:number}|{type:'move';start:Point;ids:number[];preview:number[];board:Board;dx:number;dy:number;targets:Map<number,number|null>;base:EditState}|{type:'marquee';start:Point;end:Point;selected:number[]}|{type:'resize';start:Point;element:Element;handle:ResizeHandle;bounds:Bounds;base:EditState}|{type:'create';kind:Kind;start:Point;screen:Point;bounds:Bounds;dragged:boolean;base:EditState}|{type:'connector-end';id:number;end:ConnectorEnd;screen:Point;dragged:boolean;point:Point;target:ConnectorTarget|null;base:EditState;board:Board})&{pointer:number};
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
function defaultBounds(kind:Kind,center:Point):Bounds{const width=kind==='frame'?600:kind==='text'?320:220,height=kind==='frame'?360:kind==='text'?100:112;return{x:center.x-width/2,y:center.y-height/2,width,height};}
export function resizeBounds(start:Bounds,handle:ResizeHandle,dx:number,dy:number,keepAspect:boolean):Bounds {
  const west=handle.includes('w'),east=handle.includes('e'),north=handle.includes('n'),south=handle.includes('s');
  let width=clamp(start.width+(west?-dx:east?dx:0),20,10000),height=clamp(start.height+(north?-dy:south?dy:0),20,10000);
  if(keepAspect){const ratio=start.width/start.height;const sx=width/start.width,sy=height/start.height;const scale=(west||east)&&(north||south)?Math.abs(sx-1)>=Math.abs(sy-1)?sx:sy:(west||east)?sx:sy;const min=Math.max(20/start.width,20/start.height),max=Math.min(10000/start.width,10000/start.height);width=start.width*clamp(scale,min,max);height=width/ratio;}
  return{x:west?start.x+start.width-width:start.x,y:north?start.y+start.height-height:start.y,width,height};
}
export function dropTarget(board:Board,id:number,center:Point,excluded:number[]=members(board,[id])):number|null {
  const depth=(e:Element)=>{let d=0,parent=e.parentFrameId;while(parent!==null&&d<=board.elements.length){d++;parent=board.elements.find(e=>e.id===parent)?.parentFrameId??null;}return d;};
  return board.elements.filter(e=>e.kind==='frame'&&!excluded.includes(e.id)&&center.x>=e.x&&center.y>=e.y&&center.x<=e.x+e.width&&center.y<=e.y+e.height).sort((a,b)=>depth(b)-depth(a)||a.width*a.height-b.width*b.height||a.id-b.id)[0]?.id??null;
}
export function moveOperations(board:Board,ids:number[],dx:number,dy:number):Operation[]{
  if(dx===0&&dy===0)return [];
  const moving=members(board,ids),roots=ids.filter(id=>{const e=board.elements.find(e=>e.id===id);return e&&e.kind!=='connector'&&!ids.some(other=>other!==id&&members(board,[other]).includes(id));});
  const operations:Operation[]=[{op:'move',ids,dx,dy}];
  for(const id of roots){const e=board.elements.find(e=>e.id===id)!,parentFrameId=dropTarget(board,id,{x:e.x+e.width/2+dx,y:e.y+e.height/2+dy},moving);if(e.parentFrameId!==parentFrameId)operations.push({op:'update',id,patch:{parentFrameId}});}
  return operations;
}
export class Interaction {
  tool:Tool='select';gesture:Gesture|null=null;space=false;private connectorFrom:number|null=null;private downTarget:number|null=null;private previousTap:number|null=null;private doubleTap:number|null=null;
  private nudge:Nudge|null=null;
  get active(){return !!this.gesture||!!this.nudge;}
  nudgeKey(event:KeyboardEvent):boolean{
    const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.code];
    if(!delta||event.ctrlKey||event.metaKey||event.altKey||this.gesture||this.callbacks.busy())return false;
    if(!this.nudge){const base=this.callbacks.editState(),ids=this.view.selected.filter(id=>base.board.elements.some(e=>e.id===id&&e.kind!=='connector'));if(!ids.length)return false;this.nudge={base,ids,dx:0,dy:0,held:new Set()};}
    const g=this.nudge,step=event.shiftKey?10:1;g.held.add(event.code);g.dx+=delta[0]*step;g.dy+=delta[1]*step;
    this.view.previewMove(members(g.base.board,g.ids),g.dx,g.dy);return true;
  }
  releaseNudge(code:string){if(!this.nudge)return;this.nudge.held.delete(code);if(!this.nudge.held.size)this.finishNudge();}
  finishNudge(cancel=false){
    const g=this.nudge;if(!g)return;this.nudge=null;this.view.clearPreview();
    if(!cancel){const ops=moveOperations(g.base.board,g.ids,g.dx,g.dy);if(ops.length)void this.callbacks.apply(ops,undefined,g.base);}
    this.callbacks.changed();
  }
  constructor(private view:CanvasView,private callbacks:Callbacks){
    view.svg.addEventListener('pointerdown',e=>this.down(e));view.svg.addEventListener('pointermove',e=>this.move(e));view.svg.addEventListener('pointerup',e=>this.up(e));view.svg.addEventListener('pointercancel',()=>this.cancel());view.svg.addEventListener('lostpointercapture',()=>{if(this.gesture)this.cancel();});window.addEventListener('blur',()=>{this.space=false;this.finishNudge();this.cancel();});
    view.svg.addEventListener('dblclick',()=>{const target=this.callbacks.current()?.elements.find(e=>e.id===this.doubleTap);if(target&&this.tool==='select')this.callbacks.edit(target.id);});
    // The inline editor and its conflict bar sit above the canvas: the wheel over them still moves the camera.
    for(const target of [view.svg,document.getElementById('text-editor'),document.getElementById('text-conflict')])target?.addEventListener('wheel',e=>this.wheel(e as WheelEvent),{passive:false});
    view.svg.addEventListener('contextmenu',e=>e.preventDefault());view.svg.addEventListener('pointerleave',()=>view.setHover(null));
  }
  private wheel(e:WheelEvent){
    if(document.querySelector('#app')?.hasAttribute('inert')||document.querySelector('dialog[open]'))return;
    e.preventDefault();if(this.gesture)return;
    const view=this.view,rect=view.svg.getBoundingClientRect(),intent=wheelIntent(e,rect);if(!intent)return;
    this.finishNudge();if(intent.type==='zoom'){if(isDiscreteZoom(e))view.animateZoom(intent.factor,e.clientX,e.clientY);else view.zoom(intent.factor,e.clientX,e.clientY);}else view.pan(intent.dx,intent.dy);
  }
  setTool(tool:Tool){if(this.gesture?.type==='connector-end')this.cancel();this.tool=tool;this.connectorFrom=null;this.view.svg.dataset.tool=tool;this.callbacks.tool(tool);}
  private hover(event:PointerEvent){const target=this.tool==='select'&&!this.space?this.view.elementAt(event.target):undefined;this.view.setHover(target&&target.kind!=='connector'&&target.kind!=='frame'?target.id:null);}
  private begin(g:Gesture){this.gesture=g;this.view.svg.setPointerCapture(g.pointer);}
  private down(event:PointerEvent){
    this.finishNudge();this.view.setHover(null);
    const board=this.callbacks.current();if(!board||this.gesture)return;const point=this.view.worldPoint(event.clientX,event.clientY);let target=this.view.elementAt(event.target);this.downTarget=target?.id??null;this.doubleTap=this.downTarget!==null&&this.downTarget===this.previousTap?this.downTarget:null;this.view.svg.focus();
    if(this.tool==='hand'||this.space||event.button===1){this.view.stopZoom();this.begin({type:'pan',pointer:event.pointerId,x:event.clientX,y:event.clientY,cameraX:this.view.camera.x,cameraY:this.view.camera.y});event.preventDefault();return;}
    if(this.callbacks.busy()||event.button!==0)return;
    const endpoint=(event.target as globalThis.Element).closest('[data-connector-end]');
    if(endpoint&&this.tool==='select'){
      const base=this.callbacks.editState(),id=Number(endpoint.getAttribute('data-connector-end')),end=endpoint.getAttribute('data-end') as ConnectorEnd,link=base.board.elements.find(e=>e.id===id);
      if(link?.kind==='connector'){
        const board=structuredClone(base.board),order=[...this.view.scene.querySelectorAll('[data-id]')].map(e=>Number(e.getAttribute('data-id')));board.elements.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
        this.begin({type:'connector-end',pointer:event.pointerId,id,end,screen:{x:event.clientX,y:event.clientY},point,target:null,dragged:false,base,board});event.preventDefault();
      }return;
    }
    if(this.tool==='comment'){event.preventDefault();this.callbacks.comment(target?target.kind==='connector'?{type:'connector',elementId:target.id,t:.5}:{type:'element',elementId:target.id,u:clamp((point.x-target.x)/target.width,0,1),v:clamp((point.y-target.y)/target.height,0,1)}:{type:'point',...point},{x:event.clientX,y:event.clientY});this.setTool('select');return;}
    const handle=(event.target as globalThis.Element).closest('[data-handle]');if(handle&&this.tool==='select'){const element=board.elements.find(e=>e.id===Number(handle.getAttribute('data-resize')));if(element)this.begin({type:'resize',pointer:event.pointerId,start:point,element:structuredClone(element),handle:handle.getAttribute('data-handle') as ResizeHandle,bounds:{...element},base:this.callbacks.editState()});return;}
    if(this.tool==='connector'){if(!target||target.kind==='frame'||target.kind==='connector')return;if(this.connectorFrom===null){this.connectorFrom=target.id;this.callbacks.select([target.id]);return;}if(this.connectorFrom!==target.id){void this.callbacks.apply([{op:'create',element:{kind:'connector',from:this.connectorFrom,to:target.id}}]);this.setTool('select');}return;}
    if(['rectangle','text','frame'].includes(this.tool)){const kind=this.tool as Kind;this.begin({type:'create',pointer:event.pointerId,kind,start:point,screen:{x:event.clientX,y:event.clientY},bounds:defaultBounds(kind,point),dragged:false,base:this.callbacks.editState()});return;}
    // Empty frame interiors accept marquee; titles and borders move the frame.
    if(target?.kind==='frame'){const edge=8/this.view.camera.zoom;if(point.x>target.x+edge&&point.x<target.x+target.width-edge&&point.y>target.y+edge&&point.y<target.y+target.height-edge)target=undefined;}
    if(target){const selected=event.shiftKey?this.view.selected.includes(target.id)?this.view.selected.filter(id=>id!==target!.id):[...this.view.selected,target.id]:this.view.selected.includes(target.id)?this.view.selected:[target.id];this.callbacks.select(selected);if(target.kind!=='connector'&&selected.includes(target.id))this.begin({type:'move',pointer:event.pointerId,start:point,ids:[...selected],preview:members(board,selected),board:structuredClone(board),dx:0,dy:0,targets:new Map(),base:this.callbacks.editState()});}
    else{const selected=event.shiftKey?[...this.view.selected]:[];if(!event.shiftKey)this.callbacks.select([]);this.begin({type:'marquee',pointer:event.pointerId,start:point,end:point,selected});}
  }
  private move(event:PointerEvent){const g=this.gesture;if(!g){this.hover(event);return;}if(g.pointer!==event.pointerId)return;if(g.type==='pan'){this.view.camera.x=g.cameraX+event.clientX-g.x;this.view.camera.y=g.cameraY+event.clientY-g.y;this.view.updateCamera();return;}const point=this.view.worldPoint(event.clientX,event.clientY);
    if(g.type==='move'){g.dx=point.x-g.start.x;g.dy=point.y-g.start.y;this.view.previewMove(g.preview,g.dx,g.dy);g.targets.clear();const roots=g.ids.filter(id=>{const e=g.board.elements.find(e=>e.id===id);return e&&e.kind!=='connector'&&!g.ids.some(other=>other!==id&&members(g.board,[other]).includes(id));});for(const id of roots){const e=g.board.elements.find(e=>e.id===id)!;g.targets.set(id,dropTarget(g.board,id,{x:e.x+e.width/2+g.dx,y:e.y+e.height/2+g.dy},g.preview));}this.view.highlightDrop([...g.targets.values()].find(id=>id!==null)??null);}
    else if(g.type==='marquee'){g.end=point;this.view.marquee(Math.min(g.start.x,point.x),Math.min(g.start.y,point.y),Math.abs(point.x-g.start.x),Math.abs(point.y-g.start.y));}
    else if(g.type==='connector-end'){
      g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>3;g.point=point;
      if(g.dragged){g.target=connectorTarget(g.board,g.board.elements.find(e=>e.id===g.id)!,g.end,point,this.view.camera.zoom);this.view.previewConnector(g.board,g.id,g.end,point,g.target);}
    }
    else if(g.type==='create'){
      g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>3;
      if(g.dragged){const dx=point.x-g.start.x,dy=point.y-g.start.y,side=Math.max(Math.abs(dx),Math.abs(dy)),width=clamp(event.shiftKey?side:Math.abs(dx),20,10000),height=clamp(event.shiftKey?side:Math.abs(dy),20,10000);g.bounds={x:dx<0?g.start.x-width:g.start.x,y:dy<0?g.start.y-height:g.start.y,width,height};this.view.previewCreate(g.bounds,g.kind);}
    }
    else{g.bounds=resizeBounds(g.element,g.handle,point.x-g.start.x,point.y-g.start.y,event.shiftKey);this.view.previewResize(g.element.id,g.bounds.width,g.bounds.height,g.bounds.x,g.bounds.y);}
  }
  private up(event:PointerEvent){const g=this.gesture;if(!g){this.previousTap=this.downTarget;return;}if(g.pointer!==event.pointerId)return;this.move(event);this.previousTap=g.type==='move'&&Math.hypot(g.dx,g.dy)<=2/this.view.camera.zoom?this.downTarget:null;if(this.previousTap===null)this.doubleTap=null;this.gesture=null;this.view.clearPreview();this.view.highlightDrop(null);if(this.view.svg.hasPointerCapture(event.pointerId))this.view.svg.releasePointerCapture(event.pointerId);
    let ops:Operation[]=[];
    if(g.type==='connector-end'&&g.dragged&&g.target){const link=g.base.board.elements.find(e=>e.id===g.id)!;if(link[g.end]!==g.target.id||link[`${g.end}Port`]!==g.target.port)ops=[{op:'update',id:g.id,patch:{[g.end]:g.target.id,[`${g.end}Port`]:g.target.port}}];}
    if(g.type==='create'){const kind=g.kind;this.callbacks.create({id:g.base.board.nextId,kind,...g.bounds,text:kind==='frame'?'Новый фрейм':'',title:'',fill:kind==='frame'?'#ffffff':'#eee5f8',stroke:'#ae91c5',fontSize:16},g.base);this.setTool('select');}
    if(g.type==='move'&&Math.hypot(g.dx,g.dy)>2/this.view.camera.zoom)ops=moveOperations(g.board,g.ids,g.dx,g.dy);
    else if(g.type==='resize'){const e=g.element,b=g.bounds;if(b.x!==e.x||b.y!==e.y||b.width!==e.width||b.height!==e.height)ops=[{op:'update',id:e.id,patch:{x:b.x,y:b.y}},{op:'resize',id:e.id,width:b.width,height:b.height}];}
    else if(g.type==='marquee'){const x=Math.min(g.start.x,g.end.x),y=Math.min(g.start.y,g.end.y),right=Math.max(g.start.x,g.end.x),bottom=Math.max(g.start.y,g.end.y);const selected=this.callbacks.current()!.elements.filter(e=>e.kind!=='connector'&&e.kind!=='frame'&&e.x>=x&&e.y>=y&&e.x+e.width<=right&&e.y+e.height<=bottom).map(e=>e.id);this.callbacks.select([...new Set([...g.selected,...selected])]);}
    if(ops.length&&(g.type==='move'||g.type==='resize'||g.type==='connector-end'))void this.callbacks.apply(ops,undefined,g.base);this.view.setSelection(this.view.selected);this.callbacks.changed();
  }
  cancel(){this.finishNudge(true);const g=this.gesture;this.gesture=null;this.connectorFrom=null;this.view.clearPreview();this.view.highlightDrop(null);if(g&&this.view.svg.hasPointerCapture(g.pointer))this.view.svg.releasePointerCapture(g.pointer);this.view.setSelection(this.view.selected);this.callbacks.changed();}
}
