import {CanvasView,members} from './canvas';
import {wheelIntent} from './navigation';
import {isDiscreteZoom} from './camera';
import {HANDLE_REACH,PLUS_OFFSET,PLUS_RADIUS,sidePoint} from './overlay';
import type {Side} from './placement';
import {connectorPreviewPoints,connectorTarget,type ConnectorEnd,type ConnectorTarget} from './anchors';
import {SNAP_PX,snapMove,snapResize,snapTargets,unionBounds,type Guide} from './snap';
import type {Anchor,Board,EditState,Element,Kind,Operation} from './types';
export type Tool='select'|'hand'|'comment'|Kind;
export type ResizeHandle='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
export interface Bounds{x:number;y:number;width:number;height:number}
interface Point{x:number;y:number}
interface Nudge{ids:number[];base:EditState;dx:number;dy:number;held:Set<string>}
interface Callbacks{current():Board|null;editState():EditState;busy():boolean;apply(operations:Operation[],revision?:number,base?:EditState):Promise<boolean>;create(element:Partial<Element>&{kind:Kind},base:EditState):void;select(ids:number[]):void;edit(id:number):void;comment(anchor:Anchor,clientPoint:Point):void;tool(tool:Tool):void;changed():void;addBeside(id:number,side:Side):void;addAt(id:number,side:Side,point:Point):void;connect(id:number,side:Side,target:ConnectorTarget):void;report(error:unknown):void}
type Gesture=({type:'pan';x:number;y:number;cameraX:number;cameraY:number}|{type:'move';start:Point;ids:number[];preview:number[];board:Board;dx:number;dy:number;targets:Map<number,number|null>;base:EditState;box:Bounds|null;snap:Bounds[];client:Point}|{type:'marquee';start:Point;end:Point;selected:number[]}|{type:'resize';start:Point;element:Element;handle:ResizeHandle;bounds:Bounds;base:EditState;snap:Bounds[];client:Point;shift:boolean}|{type:'create';kind:Kind;start:Point;screen:Point;bounds:Bounds;dragged:boolean;base:EditState}|{type:'connector-end';id:number;end:ConnectorEnd;screen:Point;dragged:boolean;point:Point;target:ConnectorTarget|null;base:EditState;board:Board}|{type:'connect';source:Element;side:Side;add:boolean;screen:Point;client:Point;dragged:boolean;point:Point;target:ConnectorTarget|null;base:EditState})&{pointer:number};
type MoveGesture=Extract<Gesture,{type:'move'}>;type ResizeGesture=Extract<Gesture,{type:'resize'}>;
// The editor's click tolerance in screen pixels: a press that has not moved further never snaps.
const CLICK_PX=2;
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
// A connector that exists only while dragging: from the source's side towards the pointer.
const wireLink=(source:Element,side:Side):Element=>({...source,id:-1,kind:'connector',from:source.id,to:source.id,fromPort:side,toPort:'auto'});
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
  private nudge:Nudge|null=null;private swallowAlt=false;
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
    // Alt frees a move or resize from snapping and repaints at once; the browser never sees an Alt used in a gesture (Firefox would open the window menu on release).
    for(const type of ['keydown','keyup'] as const)window.addEventListener(type,e=>this.alt(e));
  }
  private wheel(e:WheelEvent){
    if(document.querySelector('#app')?.hasAttribute('inert')||document.querySelector('dialog[open]'))return;
    e.preventDefault();if(this.gesture&&this.gesture.type!=='connect')return;
    const view=this.view,rect=view.svg.getBoundingClientRect(),intent=wheelIntent(e,rect);if(!intent)return;
    this.finishNudge();if(intent.type==='zoom'){if(isDiscreteZoom(e))view.animateZoom(intent.factor,e.clientX,e.clientY);else view.zoom(intent.factor,e.clientX,e.clientY);}else view.pan(intent.dx,intent.dy);
    const g=this.gesture;if(g?.type==='connect'&&g.dragged){g.point=view.worldPoint(g.client.x,g.client.y);this.previewConnect(g);}
  }
  private previewConnect(g:Extract<Gesture,{type:'connect'}>){
    const board=g.base.board,link=wireLink(g.source,g.side);g.target=connectorTarget(board,link,'to',g.point,this.view.camera.zoom);
    const points=connectorPreviewPoints(board,link,'to',g.point,g.target),target=g.target?board.elements.find(e=>e.id===g.target!.id):undefined;
    this.view.previewWire(points,target&&points.length?{element:this.view.project(target),port:points.at(-1)!}:null);
  }
  cancelConnecting(){const type=this.gesture?.type;if(type==='connector-end'||type==='connect')this.cancel();}
  // Handles show only under the select tool, so a tool change repaints the overlay.
  setTool(tool:Tool){this.cancelConnecting();this.tool=tool;this.connectorFrom=null;this.view.svg.dataset.tool=tool;this.view.frames.invalidate('overlay');this.callbacks.tool(tool);}
  private hover(event:PointerEvent){
    if(this.tool!=='select'||this.space){this.view.setHover(null);return;}
    const target=this.view.elementAt(event.target);if(target&&target.kind!=='connector'&&target.kind!=='frame'){this.view.setHover(target.id);return;}
    // The handles sit outside the block: keep its hover while the pointer travels to them across empty space or a parent frame.
    const current=this.view.hovered(),point=this.view.worldPoint(event.clientX,event.clientY),reach=HANDLE_REACH/this.view.camera.zoom;
    if(current&&point.x>=current.x-reach&&point.x<=current.x+current.width+reach&&point.y>=current.y-reach&&point.y<=current.y+current.height+reach)return;
    this.view.setHover(null);
  }
  private begin(g:Gesture){this.gesture=g;this.view.svg.setPointerCapture(g.pointer);}
  // Snap targets are taken once: the wheel does not move the camera during a move or resize.
  private targetsInView(board:Board,exclude:number[]){return snapTargets(board,exclude,this.view.visibleWorld());}
  private dragMove(g:MoveGesture,free:boolean){
    const point=this.view.worldPoint(g.client.x,g.client.y),z=this.view.camera.zoom;let dx=point.x-g.start.x,dy=point.y-g.start.y,guides:Guide[]=[];
    if(!free&&g.box&&Math.hypot(dx,dy)*z>CLICK_PX){const s=snapMove({...g.box,x:g.box.x+dx,y:g.box.y+dy},g.snap,SNAP_PX/z);dx+=s.dx;dy+=s.dy;guides=s.guides;}
    g.dx=dx;g.dy=dy;this.view.previewMove(g.preview,g.dx,g.dy);this.view.previewGuides(guides);
    g.targets.clear();const roots=g.ids.filter(id=>{const e=g.board.elements.find(e=>e.id===id);return e&&e.kind!=='connector'&&!g.ids.some(other=>other!==id&&members(g.board,[other]).includes(id));});for(const id of roots){const e=g.board.elements.find(e=>e.id===id)!;g.targets.set(id,dropTarget(g.board,id,{x:e.x+e.width/2+g.dx,y:e.y+e.height/2+g.dy},g.preview));}this.view.highlightDrop([...g.targets.values()].find(id=>id!==null)??null);
  }
  // Shift keeps the aspect ratio, so it resizes without snapping.
  private dragResize(g:ResizeGesture,free:boolean){
    const point=this.view.worldPoint(g.client.x,g.client.y),z=this.view.camera.zoom,dx=point.x-g.start.x,dy=point.y-g.start.y;let bounds=resizeBounds(g.element,g.handle,dx,dy,g.shift),guides:Guide[]=[];
    if(!free&&!g.shift&&Math.hypot(dx,dy)*z>CLICK_PX){const s=snapResize(bounds,g.handle,g.snap,SNAP_PX/z);bounds=s.bounds;guides=s.guides;}
    g.bounds=bounds;this.view.previewResize(g.element.id,bounds.width,bounds.height,bounds.x,bounds.y);this.view.previewGuides(guides);
  }
  private alt(e:KeyboardEvent){
    if(e.key!=='Alt')return;const g=this.gesture;
    if(g?.type==='move'||g?.type==='resize'){this.swallowAlt=e.type==='keydown';e.preventDefault();if(g.type==='move')this.dragMove(g,e.altKey);else this.dragResize(g,e.altKey);return;}
    if(e.type==='keyup'&&this.swallowAlt){this.swallowAlt=false;e.preventDefault();}
  }
  private down(event:PointerEvent){
    // A pressed handle keeps its block hovered: clearing the hover would hide the handles or hand them to the selected block.
    const grip=(event.target as globalThis.Element).closest('[data-connect],[data-add]');this.finishNudge();if(!grip)this.view.setHover(null);
    const board=this.callbacks.current();if(!board||this.gesture)return;const point=this.view.worldPoint(event.clientX,event.clientY);let target=this.view.elementAt(event.target);this.downTarget=target?.id??null;this.doubleTap=this.downTarget!==null&&this.downTarget===this.previousTap?this.downTarget:null;this.view.svg.focus();
    if(this.tool==='hand'||this.space||event.button===1){this.view.stopZoom();this.begin({type:'pan',pointer:event.pointerId,x:event.clientX,y:event.clientY,cameraX:this.view.camera.x,cameraY:this.view.camera.y});event.preventDefault();return;}
    if(this.callbacks.busy()||event.button!==0)return;
    if(grip&&this.tool==='select'){
      const base=this.callbacks.editState(),id=Number(grip.getAttribute('data-connect')??grip.getAttribute('data-add')),source=base.board.elements.find(e=>e.id===id);
      if(source){this.begin({type:'connect',pointer:event.pointerId,source:structuredClone(source),side:grip.getAttribute('data-side') as Side,add:grip.hasAttribute('data-add'),screen:{x:event.clientX,y:event.clientY},client:{x:event.clientX,y:event.clientY},dragged:false,point,target:null,base});event.preventDefault();}
      return;
    }
    const endpoint=(event.target as globalThis.Element).closest('[data-connector-end]');
    if(endpoint&&this.tool==='select'){
      const base=this.callbacks.editState(),id=Number(endpoint.getAttribute('data-connector-end')),end=endpoint.getAttribute('data-end') as ConnectorEnd,link=base.board.elements.find(e=>e.id===id);
      if(link?.kind==='connector'){
        const board=structuredClone(base.board),order=[...this.view.scene.querySelectorAll('[data-id]')].map(e=>Number(e.getAttribute('data-id')));board.elements.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
        this.begin({type:'connector-end',pointer:event.pointerId,id,end,screen:{x:event.clientX,y:event.clientY},point,target:null,dragged:false,base,board});event.preventDefault();
      }return;
    }
    if(this.tool==='comment'){event.preventDefault();this.callbacks.comment(target?target.kind==='connector'?{type:'connector',elementId:target.id,t:.5}:{type:'element',elementId:target.id,u:clamp((point.x-target.x)/target.width,0,1),v:clamp((point.y-target.y)/target.height,0,1)}:{type:'point',...point},{x:event.clientX,y:event.clientY});this.setTool('select');return;}
    const handle=(event.target as globalThis.Element).closest('[data-handle]');if(handle&&this.tool==='select'){const element=board.elements.find(e=>e.id===Number(handle.getAttribute('data-resize')));if(element)this.begin({type:'resize',pointer:event.pointerId,start:point,element:structuredClone(element),handle:handle.getAttribute('data-handle') as ResizeHandle,bounds:{...element},base:this.callbacks.editState(),snap:this.targetsInView(board,[element.id]),client:{x:event.clientX,y:event.clientY},shift:event.shiftKey});return;}
    if(this.tool==='connector'){if(!target||target.kind==='frame'||target.kind==='connector')return;if(this.connectorFrom===null){this.connectorFrom=target.id;this.callbacks.select([target.id]);return;}if(this.connectorFrom!==target.id){void this.callbacks.apply([{op:'create',element:{kind:'connector',from:this.connectorFrom,to:target.id}}]);this.setTool('select');}return;}
    if(['rectangle','text','frame'].includes(this.tool)){const kind=this.tool as Kind;this.begin({type:'create',pointer:event.pointerId,kind,start:point,screen:{x:event.clientX,y:event.clientY},bounds:defaultBounds(kind,point),dragged:false,base:this.callbacks.editState()});return;}
    // Empty frame interiors accept marquee; titles and borders move the frame.
    if(target?.kind==='frame'){const edge=8/this.view.camera.zoom;if(point.x>target.x+edge&&point.x<target.x+target.width-edge&&point.y>target.y+edge&&point.y<target.y+target.height-edge)target=undefined;}
    if(target){const selected=event.shiftKey?this.view.selected.includes(target.id)?this.view.selected.filter(id=>id!==target!.id):[...this.view.selected,target.id]:this.view.selected.includes(target.id)?this.view.selected:[target.id];this.callbacks.select(selected);if(target.kind!=='connector'&&selected.includes(target.id)){const preview=members(board,selected);this.begin({type:'move',pointer:event.pointerId,start:point,ids:[...selected],preview,board:structuredClone(board),dx:0,dy:0,targets:new Map(),base:this.callbacks.editState(),box:unionBounds(board.elements.filter(e=>selected.includes(e.id)&&e.kind!=='connector')),snap:this.targetsInView(board,preview),client:{x:event.clientX,y:event.clientY}});}}
    else{const selected=event.shiftKey?[...this.view.selected]:[];if(!event.shiftKey)this.callbacks.select([]);this.begin({type:'marquee',pointer:event.pointerId,start:point,end:point,selected});}
  }
  private move(event:PointerEvent){const g=this.gesture;if(!g){this.hover(event);return;}if(g.pointer!==event.pointerId)return;if(g.type==='pan'){this.view.camera.x=g.cameraX+event.clientX-g.x;this.view.camera.y=g.cameraY+event.clientY-g.y;this.view.updateCamera();return;}const point=this.view.worldPoint(event.clientX,event.clientY);
    if(g.type==='move'){g.client={x:event.clientX,y:event.clientY};this.dragMove(g,event.altKey);}
    else if(g.type==='marquee'){g.end=point;this.view.marquee(Math.min(g.start.x,point.x),Math.min(g.start.y,point.y),Math.abs(point.x-g.start.x),Math.abs(point.y-g.start.y));}
    else if(g.type==='connector-end'){
      g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>3;g.point=point;
      if(g.dragged){g.target=connectorTarget(g.board,g.board.elements.find(e=>e.id===g.id)!,g.end,point,this.view.camera.zoom);this.view.previewConnector(g.board,g.id,g.end,point,g.target);}
    }
    else if(g.type==='connect'){g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>4;g.point=point;g.client={x:event.clientX,y:event.clientY};if(g.dragged)this.previewConnect(g);}
    else if(g.type==='create'){
      g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>3;
      if(g.dragged){const dx=point.x-g.start.x,dy=point.y-g.start.y,side=Math.max(Math.abs(dx),Math.abs(dy)),width=clamp(event.shiftKey?side:Math.abs(dx),20,10000),height=clamp(event.shiftKey?side:Math.abs(dy),20,10000);g.bounds={x:dx<0?g.start.x-width:g.start.x,y:dy<0?g.start.y-height:g.start.y,width,height};this.view.previewCreate(g.bounds,g.kind);}
    }
    else{g.client={x:event.clientX,y:event.clientY};g.shift=event.shiftKey;this.dragResize(g,event.altKey);}
  }
  private up(event:PointerEvent){const g=this.gesture;if(!g){this.previousTap=this.downTarget;return;}if(g.pointer!==event.pointerId)return;this.move(event);this.previousTap=g.type==='move'&&Math.hypot(g.dx,g.dy)<=2/this.view.camera.zoom?this.downTarget:null;if(this.previousTap===null)this.doubleTap=null;this.gesture=null;this.view.clearPreview();this.view.highlightDrop(null);if(this.view.svg.hasPointerCapture(event.pointerId))this.view.svg.releasePointerCapture(event.pointerId);
    let ops:Operation[]=[];
    if(g.type==='connector-end'&&g.dragged&&g.target){const link=g.base.board.elements.find(e=>e.id===g.id)!;if(link[g.end]!==g.target.id||link[`${g.end}Port`]!==g.target.port)ops=[{op:'update',id:g.id,patch:{[g.end]:g.target.id,[`${g.end}Port`]:g.target.port}}];}
    if(g.type==='connect'){
      const s=g.source,z=this.view.camera.zoom,halo=12/z,onSource=g.point.x>=s.x-halo&&g.point.x<=s.x+s.width+halo&&g.point.y>=s.y-halo&&g.point.y<=s.y+s.height+halo;
      // A press on "+" that slips but is released over the same "+" is still a click, not a drop next to the source.
      const plus=g.add?sidePoint(s,g.side,PLUS_OFFSET,z):null,slipped=!!plus&&Math.hypot(g.point.x-plus.x,g.point.y-plus.y)*z<=PLUS_RADIUS;
      if(!g.dragged||slipped){if(g.add)this.callbacks.addBeside(s.id,g.side);}else if(g.target)this.callbacks.connect(s.id,g.side,g.target);else if(!onSource)this.callbacks.addAt(s.id,g.side,g.point);
    }
    if(g.type==='create'){const kind=g.kind;this.callbacks.create({id:g.base.board.nextId,kind,...g.bounds,text:kind==='frame'?'Новый фрейм':'',title:'',fill:kind==='frame'?'#ffffff':'#eee5f8',stroke:'#ae91c5',fontSize:16},g.base);this.setTool('select');}
    if(g.type==='move'&&Math.hypot(g.dx,g.dy)>2/this.view.camera.zoom)ops=moveOperations(g.board,g.ids,g.dx,g.dy);
    else if(g.type==='resize'){const e=g.element,b=g.bounds;if(b.x!==e.x||b.y!==e.y||b.width!==e.width||b.height!==e.height)ops=[{op:'update',id:e.id,patch:{x:b.x,y:b.y}},{op:'resize',id:e.id,width:b.width,height:b.height}];}
    else if(g.type==='marquee'){const x=Math.min(g.start.x,g.end.x),y=Math.min(g.start.y,g.end.y),right=Math.max(g.start.x,g.end.x),bottom=Math.max(g.start.y,g.end.y);const selected=this.callbacks.current()!.elements.filter(e=>e.kind!=='connector'&&e.kind!=='frame'&&e.x>=x&&e.y>=y&&e.x+e.width<=right&&e.y+e.height<=bottom).map(e=>e.id);this.callbacks.select([...new Set([...g.selected,...selected])]);}
    if(ops.length&&(g.type==='move'||g.type==='resize'||g.type==='connector-end'))void this.callbacks.apply(ops,undefined,g.base);this.view.setSelection(this.view.selected);this.callbacks.changed();
  }
  cancel(){this.finishNudge(true);const g=this.gesture;this.gesture=null;this.connectorFrom=null;this.view.clearPreview();this.view.highlightDrop(null);if(g&&this.view.svg.hasPointerCapture(g.pointer))this.view.svg.releasePointerCapture(g.pointer);this.view.setSelection(this.view.selected);this.callbacks.changed();}
}
