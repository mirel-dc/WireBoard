import type { Element } from './types';
import type { CanvasView } from './canvas';
export class InlineTextEditor {
  private panel = document.getElementById('text-dialog')!;
  show(element: Element, view: CanvasView) {
    this.panel.hidden = false;
    const title = document.getElementById('title-draft') as HTMLInputElement;
    title.value = element.title; title.parentElement!.hidden = element.kind !== 'rectangle';
    this.position(element, view);
    (document.getElementById(element.kind === 'rectangle' ? 'title-draft' : 'text-draft') as HTMLElement).focus();
  }
  position(element: Element, view: CanvasView) {
    const area = view.svg.getBoundingClientRect(); const width = Math.min(360, area.width - 24);
    this.panel.style.width = `${width}px`;
    this.panel.style.left = `${Math.max(12, Math.min(area.width - width - 12, view.camera.x + element.x * view.camera.zoom))}px`;
    this.panel.style.top = `${Math.max(76, Math.min(area.height - Math.min(430, area.height - 100), view.camera.y + element.y * view.camera.zoom))}px`;
  }
  close() { this.panel.hidden = true; document.getElementById('canvas')?.focus(); }
}
