import type { Board,Bounds,Element,FontMetrics,Kind } from './types';
import {connectorPoints,connectorPreviewPoints,type ConnectorEnd,type ConnectorTarget,type Point} from './anchors';
import {FrameScheduler,type Dirty,type Layer} from './frame';
import {SceneRenderer} from './scene';
import {OverlayRenderer} from './overlay';
import {ZoomAnimation,reducedMotion,zoomAround,type Camera} from './camera';
import {changedIds} from './diff';
import {layoutConnector} from './preview';
export function members(board: Board, ids: number[]) {
  const set = new Set(ids);
  const frontier=board.elements.filter(e=>ids.includes(e.id)&&e.kind==='frame').map(e=>e.id);
  while(frontier.length){const parent=frontier.pop()!;for(const e of board.elements)if(e.parentFrameId===parent&&!set.has(e.id)){set.add(e.id);frontier.push(e.id);}}
  return [...set];
}
export function orderedFrames(board: Board) { return board.elements.filter(e => e.kind === 'frame').sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id); }
const FRAME_SAMPLES=600;
const clampCoordinate=(value:number)=>Math.max(-1e7,Math.min(1e7,value));
// Debug buffer read by e2e/perf.spec.ts.
const recordFrame=(ms:number)=>{const stats=((globalThis as {wireboardFrameStats?:number[]}).wireboardFrameStats??=[]);stats.push(ms);if(stats.length>FRAME_SAMPLES)stats.shift();};
export class CanvasView {
  svg = document.querySelector<SVGSVGElement>('#canvas')!;
  world = document.querySelector<SVGGElement>('#world')!;
  scene = document.querySelector<SVGGElement>('#scene')!;
  board: Board | null = null; selected: number[] = []; camera: Camera = { x: 80, y: 70, zoom: 1 };
  metrics:FontMetrics|null=null;editing:number|null=null;private editingHeight:number|null=null;
  preview: { ids: number[]; dx: number; dy: number } | null = null;
  resizePreview: {id:number;width:number;height:number;x:number;y:number} | null = null;
  onCamera: (() => void) | null = null; onPins: (() => void) | null = null; onChrome: (() => void) | null = null;
  readonly frames=new FrameScheduler((layer,dirty)=>this.paint(layer,dirty),undefined,recordFrame);
  private renderer=new SceneRenderer(this.scene,document.querySelector<SVGDefsElement>('#scene-defs')!,()=>this.metrics);
  private overlay=new OverlayRenderer(document.querySelector<SVGGElement>('#selection')!);
  private zoomAnimation=new ZoomAnimation();
  private connectorPreview:{board:Board;id:number;end:ConnectorEnd;point:Point;target:ConnectorTarget|null}|null=null;
  private hover:number|null=null;private marqueeBounds:Bounds|null=null;private drop:number|null=null;private creation:{bounds:Bounds;kind:Kind}|null=null;private paintedZoom=0;
  constructor() { new ResizeObserver(() => this.updateCamera()).observe(this.svg); }
  setBoard(board: Board) { if(this.board?.id!==board.id){this.renderer.clear();this.board=null;this.hover=null;} this.svg.dataset.board = board.id; this.project(board); }
  clear() { this.board=null;this.selected=[];this.hover=null;this.editing=null;this.editingHeight=null;this.renderer.editing=null;this.clearPreview();this.renderer.clear();delete this.svg.dataset.board;this.frames.invalidate('overlay');this.frames.invalidate('pins'); }
  updateCamera() { for(const layer of ['camera','overlay','pins','chrome'] as const)this.frames.invalidate(layer); }
  worldPoint(clientX: number, clientY: number) { const rect = this.svg.getBoundingClientRect(); return { x: (clientX - rect.x - this.camera.x) / this.camera.zoom, y: (clientY - rect.y - this.camera.y) / this.camera.zoom }; }
  pan(dx:number,dy:number){this.camera={...this.camera,x:clampCoordinate(this.camera.x-dx),y:clampCoordinate(this.camera.y-dy)};this.updateCamera();}
  zoom(factor: number, clientX?: number, clientY?: number) { this.zoomAnimation.stop();this.camera=zoomAround(this.camera,this.camera.zoom*factor,this.anchor(clientX,clientY));this.updateCamera(); }
  stopZoom(){this.zoomAnimation.stop();}
  animateZoom(factor:number,clientX?:number,clientY?:number){
    if(reducedMotion()){this.zoom(factor,clientX,clientY);return;}
    // Repeated steps extend the running target instead of restarting from the current frame.
    this.zoomAnimation.retarget(this.camera.zoom,(this.zoomAnimation.target??this.camera.zoom)*factor,this.anchor(clientX,clientY),performance.now());this.updateCamera();
  }
  private anchor(clientX?:number,clientY?:number):Point{const rect=this.svg.getBoundingClientRect();return{x:(clientX??rect.x+rect.width/2)-rect.x,y:(clientY??rect.y+rect.height/2)-rect.y};}
  fit(frameId?: number) {
    if (!this.board) return; this.zoomAnimation.stop(); const elements = frameId === undefined ? this.board.elements.filter(e => e.kind !== 'connector') : this.board.elements.filter(e => e.id === frameId); if (!elements.length) { this.camera = { x: 80, y: 70, zoom: 1 }; this.updateCamera(); return; }
    const x = Math.min(...elements.map(e => e.x)), y = Math.min(...elements.map(e => e.y)) - 25, right = Math.max(...elements.map(e => e.x + e.width)), bottom = Math.max(...elements.map(e => e.y + e.height));
    const rect = this.svg.getBoundingClientRect(); const zoom = Math.min(1.25, Math.max(.1, Math.min((rect.width - 100) / (right - x), (rect.height - 160) / (bottom - y)))); this.camera = { x: (rect.width - (right - x) * zoom) / 2 - x * zoom, y: (rect.height - (bottom - y) * zoom) / 2 - y * zoom, zoom }; this.updateCamera();
  }
  reveal(point:Point){this.zoomAnimation.stop();const rect=this.svg.getBoundingClientRect();this.camera={...this.camera,x:rect.width/2-point.x*this.camera.zoom,y:rect.height/2-point.y*this.camera.zoom};this.updateCamera();}
  // Shifts the camera by the least amount that brings b fully into view with a 40px margin.
  revealBounds(b:Bounds){
    const rect=this.svg.getBoundingClientRect(),z=this.camera.zoom,m=40,left=this.camera.x+b.x*z,top=this.camera.y+b.y*z,right=left+b.width*z,bottom=top+b.height*z;
    let dx=0,dy=0;if(right>rect.width-m)dx=right-(rect.width-m);if(left-dx<m)dx=left-m;if(bottom>rect.height-m)dy=bottom-(rect.height-m);if(top-dy<m)dy=top-m;
    if(dx||dy){this.zoomAnimation.stop();this.pan(dx,dy);}
  }
  setSelection(ids: number[]) { this.selected = ids.filter(id => this.board?.elements.some(e => e.id === id)); this.frames.invalidate('overlay'); }
  setHover(id:number|null){if(this.hover===id)return;this.hover=id;this.frames.invalidate('overlay');}
  hovered():Element|null{const e=this.hover===null?null:this.board?.elements.find(e=>e.id===this.hover);return e?this.project(e):null;}
  // The hovered block wins over a single selected one; any gesture, preview or open text editor hides the handles.
  private connectSource():Element|null{
    const board=this.board;if(!board||this.editing!==null||this.selected.length>1||this.preview||this.resizePreview||this.marqueeBounds||this.creation||this.connectorPreview)return null;
    const usable=(e:Element|undefined)=>!!e&&['rectangle','text','image'].includes(e.kind);
    const hover=this.hover===null?undefined:board.elements.find(e=>e.id===this.hover);if(usable(hover))return this.project(hover!);
    const selected=this.selected.length===1?board.elements.find(e=>e.id===this.selected[0]):undefined;return usable(selected)?this.project(selected!):null;
  }
  // The edited object hides its SVG text and selection; previewTextHeight survives clearPreview so a window blur keeps the grown block.
  setEditing(id:number|null){if(this.editing===id)return;const ids=[this.editing,id].filter((v):v is number=>v!==null);this.editing=id;this.editingHeight=null;this.renderer.editing=id;this.previewChanged(ids);}
  previewTextHeight(height:number|null){if(this.editing===null||this.editingHeight===height)return;this.editingHeight=height;this.previewChanged([this.editing]);this.frames.invalidate('chrome');}
  textBox(id:number):Bounds|null{
    const raw=this.board?.elements.find(e=>e.id===id);if(!raw||!this.board)return null;const e=this.project(raw);
    if(e.kind==='frame')return{x:e.x,y:e.y-30,width:Math.max(160,e.width),height:24};
    if(e.kind!=='connector')return{x:e.x,y:e.y,width:e.width,height:e.height};
    if(!this.metrics)return null;
    const board={...this.board,elements:this.board.elements.map(n=>this.project(n))},b=layoutConnector(board,e,this.metrics,this.linkPoints(e)).captionBounds,width=Math.max(276,b.width);
    return{x:b.x+b.width/2-width/2,y:b.y,width,height:Math.max(b.height,e.fontSize*1.4+12)};
  }
  project(e:Element):Element;
  project(board:Board):void;
  project(input:Element|Board):Element|void {
    if('kind' in input){const resize=this.resizePreview?.id===input.id?this.resizePreview:null;const move=this.preview?.ids.includes(input.id)?this.preview:null;return {...input,x:resize?.x??input.x+(move?.dx??0),y:resize?.y??input.y+(move?.dy??0),width:resize?.width??input.width,height:resize?.height??(input.id===this.editing?this.editingHeight:null)??input.height};}
    const dirty=changedIds(this.board,input);this.board=input;this.selected=this.selected.filter(id=>input.elements.some(e=>e.id===id));
    document.querySelector('#canvas-hint')!.toggleAttribute('hidden',input.elements.length>0);
    this.frames.invalidate('scene',dirty==='all'?undefined:dirty);this.frames.invalidate('overlay');this.frames.invalidate('pins');
  }
  previewConnector(board:Board,id:number,end:ConnectorEnd,point:Point,target:ConnectorTarget|null){this.connectorPreview={board,id,end,point,target};this.previewChanged([]);}
  previewMove(ids: number[], dx: number, dy: number) { const previous=this.preview?.ids??[];this.preview = { ids, dx, dy };this.previewChanged([...previous,...ids]); }
  previewResize(id:number,width:number,height:number,x=this.board!.elements.find(e=>e.id===id)!.x,y=this.board!.elements.find(e=>e.id===id)!.y){const previous=this.resizePreview?[this.resizePreview.id]:[];this.resizePreview={id,width,height,x,y};this.previewChanged([...previous,id]);}
  highlightDrop(frameId:number|null){if(this.drop===frameId)return;this.drop=frameId;this.frames.invalidate('overlay');}
  previewCreate(bounds:Bounds,kind:Kind){this.creation={bounds,kind};this.frames.invalidate('overlay');}
  marquee(x: number, y: number, width: number, height: number) { this.marqueeBounds={x,y,width,height};this.frames.invalidate('overlay'); }
  clearPreview() { const ids=[...(this.preview?.ids??[]),...(this.resizePreview?[this.resizePreview.id]:[])];this.preview = null;this.resizePreview=null;this.connectorPreview=null;this.creation=null;this.marqueeBounds=null;this.previewChanged(ids); }
  elementAt(target: EventTarget | null): Element | undefined { const id = (target as globalThis.Element | null)?.closest?.('[data-id]')?.getAttribute('data-id'); return this.board?.elements.find(e => e.id === Number(id)); }
  private previewChanged(ids:number[]){this.frames.invalidate('scene',ids);this.frames.invalidate('overlay');this.frames.invalidate('pins');}
  private linkPoints(e:Element){const p=this.connectorPreview;if(p?.id===e.id){const link=p.board.elements.find(n=>n.id===e.id)!;return connectorPreviewPoints(p.board,link,p.end,p.point,p.target);}return this.board?connectorPoints(this.board,e,n=>this.project(n)):[];}
  private paint(layer:Layer,dirty:Dirty){
    if(layer==='camera'){
      if(this.zoomAnimation.active){
        this.camera=this.zoomAnimation.step(this.camera,performance.now());
        // The layers below paint later in this flush; the last step must reach them too.
        for(const layer of ['overlay','pins','chrome'] as const)this.frames.invalidate(layer);
        if(this.zoomAnimation.active)this.frames.invalidate('camera');
      }
      const transform=`translate(${this.camera.x} ${this.camera.y}) scale(${this.camera.zoom})`;this.world.setAttribute('transform',transform);document.querySelector('#dots')!.setAttribute('patternTransform',transform);
      if(this.paintedZoom!==this.camera.zoom){this.paintedZoom=this.camera.zoom;this.renderer.setZoom(this.camera.zoom);}
      this.onCamera?.();return;
    }
    if(layer==='scene'){if(this.board)this.renderer.paint(this.board,dirty,e=>this.project(e),e=>this.linkPoints(e),this.connectorPreview?.id??null);return;}
    if(layer==='overlay'){this.paintOverlay();return;}
    if(layer==='pins'){this.onPins?.();return;}
    this.onChrome?.();
  }
  private paintOverlay(){
    const board=this.board,find=(id:number|null)=>id===null?null:board?.elements.find(e=>e.id===id)??null;
    const selected=(board?.elements.filter(e=>this.selected.includes(e.id)&&e.id!==this.editing)??[]).map(e=>this.project(e)),single=selected.length===1?selected[0]:null;
    let connectorEnds=null;if(single?.kind==='connector'){const points=this.linkPoints(single);connectorEnds={id:single.id,from:points[0]??null,to:points.at(-1)??null};}
    let connectorTarget=null;const p=this.connectorPreview,target=p?.target?p.board.elements.find(n=>n.id===p.target!.id):undefined;
    if(p&&target){const points=this.linkPoints(p.board.elements.find(n=>n.id===p.id)!),port=p.end==='from'?points[0]:points.at(-1);if(port)connectorTarget={element:target,port};}
    const hover=find(this.hover),showHover=hover&&hover.id!==this.editing&&!this.selected.includes(hover.id)&&!this.preview&&!this.resizePreview;
    this.overlay.render({selected,connectorEnds,hover:showHover?this.project(hover):null,marquee:this.marqueeBounds,drop:find(this.drop),create:this.creation,connectorTarget,connect:this.connectSource(),zoom:this.camera.zoom});
    // style.css matches [data-selected='true'].
    for(const group of this.scene.querySelectorAll(':scope > [data-kind="connector"]')){if(this.selected.includes(Number(group.getAttribute('data-id'))))group.setAttribute('data-selected','true');else group.removeAttribute('data-selected');}
  }
}
