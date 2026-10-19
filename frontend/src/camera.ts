import type {Point} from './anchors';
export interface Camera{x:number;y:number;zoom:number}
export const MIN_ZOOM=.1,MAX_ZOOM=4,ZOOM_MS=140;
const clampZoom=(zoom:number)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom));
const clampCoordinate=(value:number)=>Math.max(-1e7,Math.min(1e7,value));
export function zoomAround(camera:Camera,zoom:number,anchor:Point):Camera{
  const next=clampZoom(zoom),x=(anchor.x-camera.x)/camera.zoom,y=(anchor.y-camera.y)/camera.zoom;
  return {x:clampCoordinate(anchor.x-x*next),y:clampCoordinate(anchor.y-y*next),zoom:next};
}
export const easeOut=(t:number)=>1-(1-Math.min(1,Math.max(0,t)))**3;
// Mouse wheels report lines or large pixel steps; trackpad pinch reports small fractional deltas.
export const isDiscreteZoom=(e:{deltaMode:number;deltaY:number})=>e.deltaMode===1||Math.abs(e.deltaY)>=50;
export const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
export class ZoomAnimation {
  active=false;private from=1;private to=1;private started=0;private anchor:Point={x:0,y:0};
  get target():number|null{return this.active?this.to:null;}
  retarget(current:number,target:number,anchor:Point,now:number):void{this.from=current;this.to=clampZoom(target);this.anchor=anchor;this.started=now;this.active=true;}
  step(camera:Camera,now:number):Camera{const t=(now-this.started)/ZOOM_MS;if(t>=1)this.active=false;return zoomAround(camera,t>=1?this.to:this.from+(this.to-this.from)*easeOut(t),this.anchor);}
  stop():void{this.active=false;}
}
