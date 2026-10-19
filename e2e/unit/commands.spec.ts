import {test,expect} from '@playwright/test';
import {CommandQueue,makeGuards} from '../../frontend/src/commands';
import type {EditState,Operation} from '../../frontend/src/types';
import {board,element} from './fixtures';
const actor={id:'test',source:'user' as const};
const stampOf=(state:EditState,field:string)=>state.stamps.find(s=>s.key.entity.type==='element'&&s.key.field===field)?.stamp;
function confirmed():EditState{return {board:board([element({id:1}),element({id:2,x:300})]),stamps:[{key:{entity:{type:'element',id:1},field:'x'},stamp:'old'}],history:{undo:null,redo:null},receipt:null};}
function queue(state:EditState,apply:(request:{command?:{id:string}})=>Promise<EditState>=()=>new Promise(()=>{})){
  return new CommandQueue(actor,state,{apply:(_id,request)=>apply(request),history:()=>new Promise(()=>{}),editState:()=>new Promise(()=>{})},()=>{});
}
const enqueue=(q:CommandQueue,operations:Operation[])=>q.enqueue({label:'Test',operations,guards:makeGuards(q.projectedState(),operations)});
test('reuses one projection until the queue changes',()=>{
  const q=queue(confirmed()),idle=q.projectedState();
  expect(q.projectedState()).toBe(idle);expect(q.summary).toBe(idle.history);
  void enqueue(q,[{op:'update',id:1,patch:{x:40}}]);
  const projected=q.projectedState();
  expect(projected).not.toBe(idle);expect(q.projected()).toBe(projected.board);
  expect(projected.board.elements.find(e=>e.id===1)!.x).toBe(40);
});
test('projecting an edit leaves the confirmed state untouched',()=>{
  const state=confirmed(),q=queue(state);
  void enqueue(q,[{op:'update',id:1,patch:{x:40}}]);
  const projected=q.projectedState();
  expect(stampOf(projected,'x')).not.toBe('old');
  expect(stampOf(q.confirmed,'x')).toBe('old');expect(state.board.elements.find(e=>e.id===1)!.x).toBe(0);
});
test('projecting an undo leaves the confirmed board untouched',async()=>{
  const state=confirmed();let commandId='';
  const q=queue(state,async request=>{commandId=request.command!.id;const next=structuredClone(state);next.board.revision=2;next.board.elements[0].x=40;next.stamps[0].stamp=commandId;next.history={undo:{commandId,label:'Test'},redo:null};next.receipt={id:commandId,fingerprint:'',committedRevision:2};return next;});
  await enqueue(q,[{op:'update',id:1,patch:{x:40}}]);
  expect(q.summary.undo?.commandId).toBe(commandId);
  q.history('undo');
  expect(q.projected().elements.find(e=>e.id===1)!.x).toBe(0);expect(stampOf(q.projectedState(),'x')).toBe('old');
  expect(q.confirmed.board.elements.find(e=>e.id===1)!.x).toBe(40);expect(stampOf(q.confirmed,'x')).toBe(commandId);
  expect(q.summary.redo?.commandId).toBe(commandId);
});
test('a confirmed receipt refreshes the projection',async()=>{
  const state=confirmed();let release:(state:EditState)=>void=()=>{};
  const q=queue(state,request=>new Promise(resolve=>{release=resolve;void request;}));
  const saved=enqueue(q,[{op:'update',id:1,patch:{x:40}}]),pending=q.projectedState();
  const next=structuredClone(pending);next.board.revision=2;next.board.elements[1].x=500;next.receipt={id:next.history.undo!.commandId,fingerprint:'',committedRevision:2};
  release(next);await saved;
  expect(q.projectedState()).not.toBe(pending);expect(q.projected().elements.find(e=>e.id===2)!.x).toBe(500);expect(q.hasPending).toBe(false);
});
