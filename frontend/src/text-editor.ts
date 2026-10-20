import type {Bounds,Element} from './types';
import type {Camera} from './camera';
import {joinTitle,pasteIntoTitle,splitTitle,type Edit,type TextDraft} from './text-model';
export interface TextEditorCallbacks{input(draft:TextDraft):void;commit():void}
const field=(id:string)=>document.getElementById(id) as HTMLTextAreaElement;
// Two textareas over the block; for a card they behave as one field whose first line is the title.
export class InlineTextEditor {
  readonly root=document.getElementById('text-editor')!;
  private title=field('title-draft');private body=field('text-draft');private kind:Element['kind']|null=null;
  constructor(private callbacks:TextEditorCallbacks){
    for(const f of [this.title,this.body])f.addEventListener('input',()=>this.changed());
    this.title.addEventListener('keydown',event=>this.titleKey(event));this.body.addEventListener('keydown',event=>this.bodyKey(event));
    this.title.addEventListener('paste',event=>this.titlePaste(event));
  }
  get open(){return !this.root.hidden;}
  contains(target:EventTarget|null){return target instanceof Node&&this.root.contains(target);}
  show(e:Element,draft:TextDraft,selectAll=false){
    this.kind=e.kind;this.root.dataset.kind=e.kind;this.root.hidden=false;
    this.root.style.setProperty('--text-size',`${e.kind==='frame'?15:e.fontSize}px`);this.root.style.setProperty('--title-size',`${Math.min(96,e.fontSize+4)}px`);this.root.style.setProperty('--text-weight',String(e.fontWeight));
    this.title.hidden=e.kind!=='rectangle';this.title.value=draft.title;this.body.value=draft.text;this.fit();
    const target=e.kind==='rectangle'&&!draft.text?this.title:this.body;target.focus({preventScroll:true});
    if(selectAll)target.select();else target.setSelectionRange(target.value.length,target.value.length);
  }
  focus(){(this.root.contains(document.activeElement)?document.activeElement as HTMLElement:this.body).focus({preventScroll:true});}
  read():TextDraft{return{title:this.title.hidden?'':this.title.value,text:this.body.value};}
  position(box:Bounds,camera:Camera){Object.assign(this.root.style,{width:`${box.width}px`,height:`${box.height}px`,transform:`translate(${camera.x+box.x*camera.zoom}px,${camera.y+box.y*camera.zoom}px) scale(${camera.zoom})`});}
  close(){const focused=this.root.contains(document.activeElement);this.root.hidden=true;this.kind=null;if(focused)document.querySelector<SVGSVGElement>('#canvas')?.focus();}
  private changed(){this.fit();this.callbacks.input(this.read());}
  private fit(){for(const f of [this.title,this.body]){f.style.blockSize='auto';f.style.blockSize=`${f.scrollHeight}px`;}}
  private apply(edit:Edit){this.title.value=edit.draft.title;this.body.value=edit.draft.text;const f=edit.caret.field==='title'?this.title:this.body;f.focus({preventScroll:true});f.setSelectionRange(edit.caret.offset,edit.caret.offset);this.changed();}
  private commitKey(event:KeyboardEvent){
    const commit=event.key==='Escape'||event.key==='Enter'&&(event.ctrlKey||event.metaKey||this.kind==='frame');
    if(!commit)return false;event.preventDefault();event.stopPropagation();this.callbacks.commit();return true;
  }
  private titleKey(event:KeyboardEvent){
    if(event.isComposing||this.commitKey(event))return;
    const t=this.title,atEnd=t.selectionStart===t.value.length&&t.selectionEnd===t.value.length;
    if(event.key==='Enter'){event.preventDefault();this.apply(splitTitle(this.read(),t.selectionStart,t.selectionEnd));}
    else if(event.key==='ArrowDown'&&atEnd){event.preventDefault();this.apply({draft:this.read(),caret:{field:'text',offset:0}});}
  }
  private bodyKey(event:KeyboardEvent){
    if(event.isComposing||this.commitKey(event)||this.title.hidden)return;
    const b=this.body;if(b.selectionStart!==0||b.selectionEnd!==0)return;
    if(event.key==='Backspace'){event.preventDefault();const edit=joinTitle(this.read());if(edit)this.apply(edit);}
    else if(event.key==='ArrowUp'){event.preventDefault();this.apply({draft:this.read(),caret:{field:'title',offset:this.title.value.length}});}
  }
  private titlePaste(event:ClipboardEvent){const text=event.clipboardData?.getData('text/plain');if(!text)return;const t=this.title,edit=pasteIntoTitle(this.read(),t.selectionStart,t.selectionEnd,text);if(!edit)return;event.preventDefault();this.apply(edit);}
}
