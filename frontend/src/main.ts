import './style.css';
import { Editor } from './editor';
const command = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
document.querySelector<HTMLButtonElement>('#undo')!.title = `Отменить · ${command}+Z`;
document.querySelector<HTMLButtonElement>('#redo')!.title = `Повторить · ${command}+Shift+Z`;
const editor = new Editor();
void editor.start();
