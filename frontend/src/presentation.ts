import { api } from './api';
import { orderedFrames } from './canvas';
import type { Board } from './types';
export class Presentation {
  active = false; index = 0; private frames: number[] = []; private board: Board | null = null; private generation = 0;
  private root = document.querySelector<HTMLElement>('#presentation')!; private previousFocus: HTMLElement | null = null;
  constructor(private report: (error: unknown) => void) {
    document.querySelector('#slide-prev')!.addEventListener('click', () => { void this.navigate(-1); }); document.querySelector('#slide-next')!.addEventListener('click', () => { void this.navigate(1); }); document.querySelector('#presentation-exit')!.addEventListener('click', () => this.exit());
  }
  async enter(board: Board, selected?: number) { this.board = board; this.frames = orderedFrames(board).map(f => f.id); if (!this.frames.length) { this.report(new Error('Создайте слайд инструментом F.')); return; } this.index = Math.max(0, this.frames.indexOf(selected ?? -1)); this.previousFocus = document.activeElement as HTMLElement; this.active = true; this.root.hidden = false; document.querySelector<HTMLElement>('#app')!.inert = true; document.querySelector<HTMLButtonElement>('#presentation-exit')!.focus(); await this.draw(); }
  async navigate(direction: number) { this.index = Math.min(this.frames.length - 1, Math.max(0, this.index + direction)); await this.draw(); }
  async draw() { if (!this.board) return; const generation = ++this.generation; try { const source = await api.svg(this.board.id, this.frames[this.index]); if (!this.active || generation !== this.generation) return; const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement; svg.querySelectorAll('style').forEach(el => el.remove()); document.querySelector('#presentation-image')!.replaceChildren(document.importNode(svg, true)); document.querySelector('#presentation-position')!.textContent = `${this.index + 1} / ${this.frames.length}`; } catch (error) { this.report(error); } }
  exit() { this.generation++; this.active = false; this.root.hidden = true; document.querySelector<HTMLElement>('#app')!.inert = false; this.previousFocus?.focus(); }
  key(event: KeyboardEvent) { if (!this.active) return false; if (event.key === 'Escape') this.exit(); else if (event.key === 'ArrowRight') void this.navigate(1); else if (event.key === 'ArrowLeft') void this.navigate(-1); else if (event.key === 'Tab') { const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus(); } event.preventDefault(); return true; }
}
