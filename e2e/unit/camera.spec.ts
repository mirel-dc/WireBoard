import {test,expect} from '@playwright/test';
import {ZOOM_MS,ZoomAnimation,isDiscreteZoom,zoomAround} from '../../frontend/src/camera';
test('zoomAround keeps the anchor point still',()=>{
  const camera={x:80,y:70,zoom:1},anchor={x:300,y:200},world={x:(anchor.x-camera.x)/camera.zoom,y:(anchor.y-camera.y)/camera.zoom};
  const next=zoomAround(camera,2,anchor);
  expect(next.zoom).toBe(2);expect((anchor.x-next.x)/next.zoom).toBeCloseTo(world.x,9);expect((anchor.y-next.y)/next.zoom).toBeCloseTo(world.y,9);
});
test('zoomAround clamps the zoom range',()=>{
  expect(zoomAround({x:0,y:0,zoom:1},10,{x:0,y:0}).zoom).toBe(4);expect(zoomAround({x:0,y:0,zoom:1},.01,{x:0,y:0}).zoom).toBe(.1);
});
test('mouse wheel steps animate while trackpad pinch applies directly',()=>{
  expect(isDiscreteZoom({deltaMode:1,deltaY:-3})).toBe(true);expect(isDiscreteZoom({deltaMode:0,deltaY:-100})).toBe(true);expect(isDiscreteZoom({deltaMode:0,deltaY:-4.5})).toBe(false);
});
test('zoom animation eases toward the target and then stops',()=>{
  const animation=new ZoomAnimation(),anchor={x:100,y:100};animation.retarget(1,2,anchor,0);expect(animation.target).toBe(2);
  const middle=animation.step({x:0,y:0,zoom:1},ZOOM_MS/2);expect(middle.zoom).toBeGreaterThan(1.5);expect(middle.zoom).toBeLessThan(2);expect(animation.active).toBe(true);
  const end=animation.step(middle,ZOOM_MS);expect(end.zoom).toBe(2);expect(animation.active).toBe(false);expect(animation.target).toBeNull();
});
test('stop cancels a running animation',()=>{const animation=new ZoomAnimation();animation.retarget(1,3,{x:0,y:0},0);animation.stop();expect(animation.active).toBe(false);expect(animation.target).toBeNull();});
