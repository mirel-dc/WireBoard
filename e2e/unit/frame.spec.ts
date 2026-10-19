import {test,expect} from '@playwright/test';
import {FrameScheduler,type Dirty,type Layer} from '../../frontend/src/frame';
function harness(onPaint:(layer:Layer,frames:FrameScheduler)=>void=()=>{}){
  const calls:[Layer,Dirty][]=[],queue:(()=>void)[]=[];
  const frames:FrameScheduler=new FrameScheduler((layer,dirty)=>{calls.push([layer,dirty]);onPaint(layer,frames);},callback=>{queue.push(callback);});
  return {calls,queue,frames,run(){queue.shift()?.();}};
}
test('coalesces invalidations into one ordered frame',()=>{
  const h=harness();h.frames.invalidate('overlay');h.frames.invalidate('overlay');h.frames.invalidate('camera');
  expect(h.queue).toHaveLength(1);h.run();
  expect(h.calls.map(([layer])=>layer)).toEqual(['camera','overlay']);expect(h.frames.pending).toBe(false);
});
test('scene ids merge until a full repaint is requested',()=>{
  const h=harness();h.frames.invalidate('scene',[1,2]);h.frames.invalidate('scene',[2,3]);h.run();
  expect([...(h.calls[0][1] as ReadonlySet<number>)]).toEqual([1,2,3]);
  h.frames.invalidate('scene',[4]);h.frames.invalidate('scene');h.run();expect(h.calls[1][1]).toBe('all');
});
test('a painter can invalidate a later layer within the same frame',()=>{
  const h=harness((layer,frames)=>{if(layer==='camera')frames.invalidate('pins');});
  h.frames.invalidate('camera');h.run();
  expect(h.calls.map(([layer])=>layer)).toEqual(['camera','pins']);expect(h.queue).toHaveLength(0);
});
test('an earlier layer invalidated while painting waits for the next frame',()=>{
  let once=true;const h=harness((layer,frames)=>{if(layer==='overlay'&&once){once=false;frames.invalidate('camera');}});
  h.frames.invalidate('overlay');h.run();expect(h.calls.map(([layer])=>layer)).toEqual(['overlay']);
  expect(h.queue).toHaveLength(1);h.run();expect(h.calls.map(([layer])=>layer)).toEqual(['overlay','camera']);
});
test('reports the duration of every frame',()=>{
  const times:number[]=[],queue:(()=>void)[]=[];
  const frames=new FrameScheduler(()=>{},callback=>{queue.push(callback);},ms=>times.push(ms));
  frames.invalidate('chrome');queue.shift()!();expect(times).toHaveLength(1);expect(times[0]).toBeGreaterThanOrEqual(0);
});
