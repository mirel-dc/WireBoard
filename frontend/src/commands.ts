import {ApiError} from './api';
import {members} from './canvas';
import type {Actor,Board,CommandMeta,CommandRequest,EditState,Element,EntityKey,FieldGuard,FieldKey,HistoryCommand,HistorySummary,Operation,OptionalValue} from './types';
export interface EditIntent {label:string;operations:Operation[];guards:FieldGuard[]}
interface Adapter {apply(id:string,request:CommandRequest):Promise<EditState>;history(id:string,request:HistoryCommand):Promise<EditState>;editState(id:string,actorId:string,commandId?:string):Promise<EditState>}
interface Change {key:FieldKey;before:OptionalValue;after:OptionalValue;beforeStamp:string;afterStamp:string}
interface Cached {changes:Change[];previous:HistorySummary;label:string}
interface Pending {
  kind:'edit'|'history';meta:CommandMeta;intent?:EditIntent;direction?:'undo'|'redo';target?:string;
  request?:CommandRequest|HistoryCommand;applied:boolean;resolve(board:Board):void;reject(error:unknown):void;confirmed?:(commandId:string)=>void;
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function fieldId(key:FieldKey){return `${key.entity.type}:${'id' in key.entity?key.entity.id:''}:${key.field}`;}
function wrap(value:unknown,present=true):OptionalValue{return present?{present:true,value}: {present:false};}
export function readField(board:Board,key:FieldKey):OptionalValue {
  const entity=key.entity;
  if(entity.type==='board') {
    if(key.field==='__entity__')return wrap({title:board.title});
    if(key.field==='__frames__')return wrap(board.elements.filter(e=>e.kind==='frame').map(e=>e.id).sort((a,b)=>a-b));
    return wrap((board as unknown as Record<string,unknown>)[key.field],key.field in board);
  }
  if(entity.type==='element'&&['__children__','__dependents__'].includes(key.field)) {
    if(key.field==='__children__')return wrap(board.elements.filter(e=>e.parentFrameId===entity.id).map(e=>e.id).sort((a,b)=>a-b));
    const values=board.elements.filter(e=>e.parentFrameId===entity.id||e.from===entity.id||e.to===entity.id).map(e=>`element:${e.id}`);
    values.push(...board.comments.filter(c=>'elementId' in c.anchor&&c.anchor.elementId===entity.id).map(c=>`comment:${c.id}`));return wrap(values.sort());
  }
  const value=entity.type==='element'?board.elements.find(e=>e.id===entity.id):board.comments.find(c=>c.id===entity.id);
  if(!value)return wrap(null,false);
  const normalized=entity.type==='comment'?{...value,anchorSnapshot:null}:value;
  return key.field==='__entity__'?wrap(normalized):wrap((normalized as unknown as Record<string,unknown>)[key.field],key.field in normalized);
}
function stamp(state:EditState,key:FieldKey){return state.stamps.find(s=>fieldId(s.key)===fieldId(key))?.stamp??'baseline';}
function putStamp(state:EditState,key:FieldKey,value:string){const entry=state.stamps.find(s=>fieldId(s.key)===fieldId(key));if(entry)entry.stamp=value;else state.stamps.push({key,stamp:value});}
export function makeGuards(state:EditState,operations:Operation[]):FieldGuard[] {
  const keys=new Map<string,FieldKey>();const add=(entity:EntityKey,field:string)=>{const key={entity,field};keys.set(fieldId(key),key);};
  const full=(entity:EntityKey)=>{const object=readField(state.board,{entity,field:'__entity__'});if(object.present){for(const field of Object.keys(object.value as object))if(field!=='anchorSnapshot')add(entity,field);}};
  const frames=()=>{add({type:'board'},'__frames__');for(const e of state.board.elements.filter(e=>e.kind==='frame'))for(const field of ['x','y','width','height','parentFrameId'])add({type:'element',id:e.id},field);};
  for(const op of operations) {
    switch(op.op) {
      case 'create':add({type:'board'},'nextId');frames();break;
      case 'rename':add({type:'board'},'title');break;
      case 'update':if(state.board.elements.some(e=>e.id===op.id)){
        for(const field of Object.keys(op.patch))add({type:'element',id:op.id},field);if('parentFrameId' in op.patch)frames();
        if(['from','to','fromPort','toPort'].some(field=>field in op.patch)){
          const link=state.board.elements.find(e=>e.id===op.id)!;for(const field of ['from','to','fromPort','toPort'])add({type:'element',id:op.id},field);
          for(const id of new Set([link.from,link.to,op.patch.from,op.patch.to]))if(id!=null)for(const field of ['kind','x','y','width','height'])add({type:'element',id},field);
        }
      }break;
      case 'resize':for(const field of ['x','y','width','height','parentFrameId'])add({type:'element',id:op.id},field);break;
      case 'move':frames();for(const id of members(state.board,op.ids)){const e=state.board.elements.find(e=>e.id===id);if(!e)continue;for(const field of ['x','y','width','height','parentFrameId'])add({type:'element',id},field);if(e.kind==='frame')add({type:'element',id},'__children__');}break;
      case 'delete':case 'duplicate':{
        if(op.op==='duplicate')add({type:'board'},'nextId');
        const ids=op.op==='duplicate'?members(state.board,op.ids):op.ids;
        for(const id of ids){full({type:'element',id});add({type:'element',id},'__dependents__');}break;
      }
      case 'comment_create':add({type:'board'},'nextCommentId');add({type:'board'},'nextMessageId');if('elementId' in op.anchor)add({type:'element',id:op.anchor.elementId},'__entity__');break;
      case 'comment_reply':case 'comment_status':case 'comment_reanchor':full({type:'comment',id:op.threadId});if(op.op==='comment_reply')add({type:'board'},'nextMessageId');break;
    }
  }
  return [...keys.values()].map(key=>({key,value:readField(state.board,key),stamp:stamp(state,key)}));
}
export function projectOperations(board:Board,operations:Operation[]):Board {
  const next=structuredClone(board);
  for(const op of operations) {
    if(op.op==='create'){
      const id=next.nextId++;
      // Explicit IDs are guarded reservations, so subsequent intents can depend
      // on this creation before its acknowledgement without allocating again.
      if(op.element.id===id){
        const e:Element={id,x:0,y:0,width:220,height:112,text:'',title:'',fontWeight:400,fill:'#ffffff',stroke:'#ddd7e5',fontSize:16,from:null,to:null,fromPort:'auto',toPort:'auto',image:null,parentFrameId:null,...op.element};
        if(e.kind!=='connector'&&e.parentFrameId===null)e.parentFrameId=next.elements.filter(f=>f.kind==='frame'&&e.x>=f.x&&e.y>=f.y&&e.x+e.width<=f.x+f.width&&e.y+e.height<=f.y+f.height).sort((a,b)=>a.width*a.height-b.width*b.height||a.id-b.id)[0]?.id??null;
        next.elements.push(e);
      }
    }
    else if(op.op==='duplicate'){const ids=new Set(members(next,op.ids));for(const e of next.elements)if(e.kind==='connector'&&e.from!==null&&e.to!==null&&ids.has(e.from)&&ids.has(e.to))ids.add(e.id);next.nextId+=ids.size;}
    else if(op.op==='comment_create'){next.nextCommentId++;next.nextMessageId++;}
    else if(op.op==='comment_reply')next.nextMessageId++;
    else if(op.op==='move'){const ids=members(next,op.ids);for(const e of next.elements)if(ids.includes(e.id)&&e.kind!=='connector'){e.x+=op.dx;e.y+=op.dy;}}
    else if(op.op==='update'){const e=next.elements.find(e=>e.id===op.id);if(e)Object.assign(e,op.patch);}
    else if(op.op==='resize'){const e=next.elements.find(e=>e.id===op.id);if(e){e.width=op.width;e.height=op.height;}}
    else if(op.op==='rename')next.title=op.title.trim();
    else if(op.op==='delete'){next.elements=next.elements.filter(e=>!op.ids.includes(e.id)&&!(e.from!==null&&op.ids.includes(e.from))&&!(e.to!==null&&op.ids.includes(e.to)));for(const e of next.elements)if(e.parentFrameId!==null&&op.ids.includes(e.parentFrameId))e.parentFrameId=null;}
  }
  return next;
}
function changes(before:EditState,after:Board,id:string):Change[] {
  const output:Change[]=[];
  const entities:EntityKey[]=[{type:'board'},...[...new Set([...before.board.elements,...after.elements].map(e=>e.id))].map(id=>({type:'element' as const,id}))];
  for(const entity of entities) {
    const a=readField(before.board,{entity,field:'__entity__'}),b=readField(after,{entity,field:'__entity__'});
    if(a.present!==b.present){const key={entity,field:'__entity__'};output.push({key,before:a,after:b,beforeStamp:stamp(before,key),afterStamp:id});const value=a.present?a.value:b.present?b.value:{};for(const field of Object.keys(value as object).filter(f=>f!=='id')){const key={entity,field};output.push({key,before:readField(before.board,key),after:readField(after,key),beforeStamp:stamp(before,key),afterStamp:id});}continue;}
    if(!a.present||!b.present)continue;
    for(const field of Object.keys(a.value as object)) {
      const key={entity,field},av=readField(before.board,key),bv=readField(after,key);
      if(!equal(av,bv))output.push({key,before:av,after:bv,beforeStamp:stamp(before,key),afterStamp:id});
    }
  }
  return output;
}
function applyChanges(state:EditState,entry:Cached,direction:'undo'|'redo') {
  const whole=new Set(entry.changes.filter(c=>c.key.field==='__entity__').map(c=>JSON.stringify(c.key.entity)));
  for(const change of entry.changes) {
    const value=direction==='undo'?change.before:change.after;const restore=direction==='undo'?change.beforeStamp:change.afterStamp;
    if(change.key.entity.type==='element') {
      const id=change.key.entity.id;
      if(change.key.field==='__entity__'){state.board.elements=state.board.elements.filter(e=>e.id!==id);if(value.present)state.board.elements.push(structuredClone(value.value as Element));}
      else if(!whole.has(JSON.stringify(change.key.entity))) {const e=state.board.elements.find(e=>e.id===id);if(e&&value.present)(e as unknown as Record<string,unknown>)[change.key.field]=value.value;}
    }else if(change.key.entity.type==='board'&&change.key.field==='title'&&value.present)state.board.title=String(value.value);
    putStamp(state,change.key,restore);
  }
}
export class CommandQueue {
  private pending:Pending[]=[];private cache=new Map<string,Cached>();private running=false;private recent:string[]=[];
  mode:'idle'|'saving'|'uncertain'|'conflict'='idle';error:unknown=null;private remote=false;
  constructor(public actor:Actor,public confirmed:EditState,private adapter:Adapter,private onChange:()=>void){}
  get hasPending(){return this.pending.length>0;}
  get inFlightId(){return this.pending[0]?.meta.id;}
  isOwn(commandId?:string):boolean{return !!commandId&&(commandId===this.inFlightId||this.recent.includes(commandId));}
  projectedState():EditState {
    const state=structuredClone(this.confirmed);if(this.remote)return state;
    for(const p of this.pending) {
      if(p.applied)continue;
      if(p.kind==='edit'&&p.intent){state.board=projectOperations(state.board,p.intent.operations);const entry=this.cache.get(p.meta.id);if(entry)for(const d of entry.changes)putStamp(state,d.key,d.afterStamp);state.history={undo:{commandId:p.meta.id,label:p.meta.label},redo:null};}
      else if(p.target){const entry=this.cache.get(p.target);if(entry)applyChanges(state,entry,p.direction!);state.history=p.direction==='undo'?{undo:entry?.previous.undo??null,redo:{commandId:p.target,label:entry?this.label(p.target):'Действие'}}:{undo:{commandId:p.target,label:this.label(p.target)},redo:null};}
    }
    return state;
  }
  projected(){return this.projectedState().board;}
  get summary(){return this.projectedState().history;}
  private label(id:string){return this.cache.get(id)?.label??this.pending.find(p=>p.meta.id===id)?.meta.label??this.confirmed.history.undo?.label??this.confirmed.history.redo?.label??'Действие';}
  enqueue(intent:EditIntent,onConfirmed?:(commandId:string)=>void):Promise<Board> {
    const meta:CommandMeta={id:crypto.randomUUID(),actor:this.actor,label:intent.label};
    const before=this.projectedState(),after=projectOperations(before.board,intent.operations);
    this.cache.set(meta.id,{changes:changes(before,after,meta.id),previous:before.history,label:intent.label});
    if(this.cache.size>100){const live=new Set(this.pending.flatMap(p=>[p.meta.id,p.target]));for(const id of this.cache.keys())if(!live.has(id)&&id!==this.confirmed.history.undo?.commandId&&id!==this.confirmed.history.redo?.commandId){this.cache.delete(id);if(this.cache.size<=100)break;}}
    const promise=new Promise<Board>((resolve,reject)=>{this.pending.push({kind:'edit',meta,intent:structuredClone(intent),applied:false,resolve,reject,confirmed:onConfirmed});});
    this.remote=false;this.onChange();void this.pump();return promise;
  }
  history(direction:'undo'|'redo'):void {
    const target=this.summary[direction]?.commandId;
    if(!target&&!this.pending.length)return;
    const meta:CommandMeta={id:crypto.randomUUID(),actor:this.actor,label:direction==='undo'?'Отмена действия':'Повтор действия'};
    this.pending.push({kind:'history',meta,direction,target,applied:false,resolve:()=>{},reject:()=>{}});this.onChange();void this.pump();
  }
  accept(state:EditState):void {
    if(state.board.id!==this.confirmed.board.id||state.board.revision<this.confirmed.board.revision)return;
    this.confirmed=state;
    if(state.receipt){const p=this.pending.find(p=>p.meta.id===state.receipt?.id);if(p)p.applied=true;}
    this.onChange();
  }
  async retry():Promise<void> {
    if(this.running||!this.pending.length)return;
    const p=this.pending[0];
    if(this.mode==='conflict'){this.remote=true;this.accept(await this.adapter.editState(this.confirmed.board.id,this.actor.id));return;}
    try{const state=await this.adapter.editState(this.confirmed.board.id,this.actor.id,p.meta.id);this.accept(state);if(state.receipt){this.finish(p,state);return;}}
    catch(error){this.error=error;this.onChange();return;}
    this.mode='idle';this.error=null;this.onChange();await this.pump();
  }
  discard():void {
    if(this.running||this.mode==='uncertain')return;
    const dropped=this.pending.shift();if(dropped){dropped.reject(new ApiError('cancelled','Несохранённое действие отменено'));this.cache.delete(dropped.meta.id);}
    const state=structuredClone(this.confirmed);
    for(const p of this.pending){
      if(p.kind==='edit'&&p.intent){const after=projectOperations(state.board,p.intent.operations);const entry={changes:changes(state,after,p.meta.id),previous:state.history,label:p.meta.label};this.cache.set(p.meta.id,entry);state.board=after;for(const d of entry.changes)putStamp(state,d.key,d.afterStamp);state.history={undo:{commandId:p.meta.id,label:p.meta.label},redo:null};}
      else if(p.target){const entry=this.cache.get(p.target);if(entry)applyChanges(state,entry,p.direction!);state.history=p.direction==='undo'?{undo:entry?.previous.undo??null,redo:{commandId:p.target,label:this.label(p.target)}}:{undo:{commandId:p.target,label:this.label(p.target)},redo:null};}
    }
    this.mode='idle';this.error=null;this.remote=false;this.onChange();void this.pump();
  }
  private finish(p:Pending,state:EditState) {
    if(this.pending[0]!==p)return;this.recent.push(p.meta.id);if(this.recent.length>32)this.recent.shift();this.accept(state);this.pending.shift();this.mode='idle';this.error=null;this.remote=false;p.confirmed?.(p.meta.id);p.resolve(state.board);this.onChange();void this.pump();
  }
  private async pump():Promise<void> {
    if(this.running||this.mode==='uncertain'||this.mode==='conflict'||!this.pending.length)return;
    const p=this.pending[0];const id=this.confirmed.board.id;
    if(!p.request) {
      const stale=p.kind==='edit'?p.intent!.guards.some(g=>!equal(g.value,readField(this.confirmed.board,g.key))||g.stamp!==stamp(this.confirmed,g.key)):p.target!==undefined&&p.target!==this.confirmed.history[p.direction!]?.commandId;
      if(stale){this.mode='conflict';this.error=new ApiError('conflict',`${p.meta.label}: действие зависит от изменённых или отменённых свойств. Посмотрите свежую схему или отмените это действие.`);p.reject(this.error);this.onChange();return;}
      if(p.kind==='edit')p.request={revision:this.confirmed.board.revision,operations:p.intent!.operations,command:p.meta,guards:p.intent!.guards};
      else {p.target??=this.confirmed.history[p.direction!]?.commandId;if(!p.target){this.pending.shift();this.onChange();void this.pump();return;}p.request={revision:this.confirmed.board.revision,direction:p.direction!,targetCommandId:p.target,command:p.meta};}
    }
    this.running=true;this.mode='saving';this.error=null;this.onChange();
    try {
      const state=p.kind==='edit'?await this.adapter.apply(id,p.request as CommandRequest):await this.adapter.history(id,p.request as HistoryCommand);this.running=false;this.finish(p,state);
    } catch(error) {
      this.running=false;this.error=error;this.mode=error instanceof ApiError&&!['connection','persistence','request'].includes(error.code)?'conflict':'uncertain';p.reject(error);this.onChange();
    }
  }
}
