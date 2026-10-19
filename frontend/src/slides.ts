import type {Board} from './types';
import {api} from './api';
import {members,orderedFrames} from './canvas';
export const THUMBNAIL_DELAY=1500;
export function frameSignature(board:Board,frameId:number):string{
  const ids=new Set(members(board,[frameId]));
  for(const e of board.elements)if(e.kind==='connector'&&(ids.has(e.from??-1)||ids.has(e.to??-1)))ids.add(e.id);
  return JSON.stringify(board.elements.filter(e=>ids.has(e.id)).map(e=>[e.id,e.kind,e.x,e.y,e.width,e.height,e.text,e.title,e.fill,e.stroke,e.fontSize,e.fontWeight,e.from,e.to,e.fromPort,e.toPort,e.image?.length??0]));
}
interface Slide{button:HTMLButtonElement;image:HTMLImageElement;number:HTMLSpanElement;label:HTMLSpanElement;signature:string;loaded:string}
export class SlideList {
  private slides=new Map<number,Slide>();private boardId='';private timer=0;private loading=false;private again=false;
  private empty=Object.assign(document.createElement('p'),{className:'empty-slides',textContent:'Создайте первый слайд инструментом F. Он станет рамкой для вашей истории.'});
  constructor(private list:HTMLElement,private count:HTMLElement,private fit:(id:number)=>void){}
  clear():void{window.clearTimeout(this.timer);this.slides.clear();this.boardId='';this.list.replaceChildren();this.count.textContent='0';}
  // Signatures follow the confirmed board: a render only ever shows saved state, so a pending edit must not mark its thumbnail loaded.
  update(board:Board,selected:number[],confirmed:Board=board):void{
    if(board.id!==this.boardId){this.clear();this.boardId=board.id;}
    const frames=orderedFrames(board),live=new Set(frames.map(f=>f.id));this.count.textContent=String(frames.length);
    for(const [id,slide]of this.slides)if(!live.has(id)){slide.button.remove();this.slides.delete(id);}
    let fresh=false,stale=false;
    frames.forEach((frame,index)=>{
      let slide=this.slides.get(frame.id);
      if(!slide){const button=document.createElement('button'),image=document.createElement('img'),number=document.createElement('span'),label=document.createElement('span');image.alt='';number.className='slide-number';button.append(image,number,label);button.onclick=()=>this.fit(frame.id);slide={button,image,number,label,signature:'',loaded:''};this.slides.set(frame.id,slide);}
      slide.button.className=`slide-row${selected.includes(frame.id)?' active':''}`;slide.number.textContent=String(index+1).padStart(2,'0');slide.label.textContent=frame.text||`Слайд ${index+1}`;
      slide.signature=confirmed.elements.some(e=>e.id===frame.id)?frameSignature(confirmed,frame.id):slide.loaded;if(slide.signature!==slide.loaded){stale=true;if(!slide.loaded)fresh=true;}
      if(this.list.children[index]!==slide.button)this.list.insertBefore(slide.button,this.list.children[index]??null);
    });
    if(frames.length)this.empty.remove();else this.list.append(this.empty);
    if(stale){window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>{void this.load();},fresh?0:THUMBNAIL_DELAY);}
  }
  // One render at a time keeps the server render semaphore free for exports.
  private async load(){
    if(this.loading){this.again=true;return;}
    this.loading=true;const boardId=this.boardId;
    try{
      for(const [id,slide]of this.slides){
        if(slide.signature===slide.loaded)continue;const signature=slide.signature;
        try{
          const source=await api.svg(boardId,id);if(this.boardId!==boardId||this.slides.get(id)!==slide)return;
          const url=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,probe=new Image();
          probe.onload=()=>{if(this.slides.get(id)===slide)slide.image.src=url;};probe.src=url;slide.loaded=signature;delete slide.button.dataset.thumbnail;
        }catch{slide.button.dataset.thumbnail='error';}
      }
    }finally{this.loading=false;if(this.again){this.again=false;void this.load();}}
  }
}
