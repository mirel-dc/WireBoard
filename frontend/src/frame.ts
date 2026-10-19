export type Layer='camera'|'scene'|'overlay'|'pins'|'chrome';
export const LAYERS:readonly Layer[]=['camera','scene','overlay','pins','chrome'];
export type Dirty=ReadonlySet<number>|'all';
export type Painter=(layer:Layer,dirty:Dirty)=>void;
export type RequestFrame=(callback:()=>void)=>void;
const nextFrame:RequestFrame=callback=>{requestAnimationFrame(()=>callback());};
export class FrameScheduler {
  private layers=new Set<Layer>();private ids=new Set<number>();private all=false;private scheduled=false;private flushing=false;
  constructor(private painter:Painter,private requestFrame:RequestFrame=nextFrame,private onFrame?:(ms:number)=>void){}
  get pending():boolean{return this.layers.size>0;}
  invalidate(layer:Layer,ids?:Iterable<number>):void{
    this.layers.add(layer);
    if(layer==='scene'){if(ids===undefined)this.all=true;else for(const id of ids)this.ids.add(id);}
    this.schedule();
  }
  flush():void{
    this.flushing=true;const started=performance.now();
    try{
      for(const layer of LAYERS){
        if(!this.layers.delete(layer))continue;
        let dirty:Dirty='all';if(layer==='scene'){dirty=this.all?'all':this.ids;this.ids=new Set();this.all=false;}
        this.painter(layer,dirty);
      }
    }finally{this.flushing=false;this.onFrame?.(performance.now()-started);this.schedule();}
  }
  private schedule(){if(this.scheduled||this.flushing||!this.layers.size)return;this.scheduled=true;this.requestFrame(()=>{this.scheduled=false;this.flush();});}
}
