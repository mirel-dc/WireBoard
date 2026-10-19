import {test,expect} from '@playwright/test';
import {frameSignature} from '../../frontend/src/slides';
import {board,element} from './fixtures';
test('frame signature changes only with the frame content',()=>{
  const frame=element({id:1,kind:'frame',width:600,height:400}),inner=element({id:2,parentFrameId:1}),outer=element({id:3,x:900});
  const before=frameSignature(board([frame,inner,outer]),1);
  expect(frameSignature(board([frame,inner,{...outer,x:1200}]),1)).toBe(before);
  expect(frameSignature(board([frame,{...inner,x:40},outer]),1)).not.toBe(before);
  expect(frameSignature(board([frame,inner,outer,element({id:4,kind:'connector',from:2,to:3})]),1)).not.toBe(before);
});
