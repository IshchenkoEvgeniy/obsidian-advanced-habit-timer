import { Setting } from 'obsidian';
import type { DailyTask } from './model';
import { taskStatuses,taskCarriesOver } from './planning';

export function taskEditorFields(root:HTMLElement,task:DailyTask){
 let carryControl:{setValue(value:boolean):unknown}|undefined;
 new Setting(root).setName('Переносить, если не выполнено').setDesc('Показывать в следующих днях до выполнения. Без переноса задание остаётся на своей дате.').addToggle(c=>{carryControl=c;c.setValue(taskCarriesOver(task)).onChange(v=>task.carryOver=v);});
 for(const [key,label] of [['startTime','Время начала'],['endTime','Время окончания']] as const)new Setting(root).setName(label).addText(c=>{c.inputEl.type='time';c.inputEl.step='60';c.setValue(task[key]||'').onChange(v=>task[key]=v);});
 new Setting(root).setName('Описание').addTextArea(c=>c.setValue(task.description||'').onChange(v=>task.description=v));
 new Setting(root).setName('Статус').addDropdown(c=>c.addOptions(taskStatuses).setValue(task.done?'completed':task.status||'planned').onChange(v=>{task.status=v as DailyTask['status'];task.done=v==='completed';}));
 new Setting(root).setName('Список').addText(c=>c.setValue(task.list||'').onChange(v=>task.list=v.trim()));
 new Setting(root).setName('Теги').addText(c=>c.setValue((task.tags||[]).join(', ')).onChange(v=>task.tags=[...new Set(v.split(',').map(s=>s.trim()).filter(Boolean))]));
 new Setting(root).setName('Ссылки и заметки').addTextArea(c=>c.setValue((task.links||[]).join('\n')).onChange(v=>task.links=v.split('\n').map(s=>s.trim()).filter(Boolean)));
 const repeat=root.createDiv();
 const draw=()=>{
  if(task.carryOver===undefined)carryControl?.setValue(taskCarriesOver(task));
  repeat.empty();new Setting(repeat).setName('Повторение').addDropdown(c=>c.addOptions({'':'Не повторять',daily:'Ежедневно',weekdays:'По дням недели',monthly:'Ежемесячно',after:'После выполнения'}).setValue(task.repeat?.kind||'').onChange(v=>{task.repeat=v?{kind:v as NonNullable<DailyTask['repeat']>['kind'],interval:1,weekdays:[1,2,3,4,5],day:1}:null;draw();}));
  if(task.repeat?.kind==='after')new Setting(repeat).setName('Через сколько дней').addText(c=>{c.inputEl.type='number';c.inputEl.min='1';c.inputEl.max='365';c.setValue(String(task.repeat!.interval||1)).onChange(v=>task.repeat!.interval=Number(v));});
  if(task.repeat?.kind==='monthly')new Setting(repeat).setName('Число месяца').addText(c=>{c.inputEl.type='number';c.inputEl.min='1';c.inputEl.max='31';c.setValue(String(task.repeat!.day||1)).onChange(v=>task.repeat!.day=Number(v));});
  if(task.repeat?.kind==='weekdays')for(const [n,label] of ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].entries())new Setting(repeat).setName(label).addToggle(c=>c.setValue(task.repeat!.weekdays?.includes(n)||false).onChange(v=>task.repeat!.weekdays=v?[...task.repeat!.weekdays||[],n]:(task.repeat!.weekdays||[]).filter(d=>d!==n)));
 };draw();
 new Setting(root).setName('Напомнить в Telegram').addText(c=>{c.inputEl.type='time';c.setValue(task.reminderTime||'').onChange(v=>task.reminderTime=v);});
 if(task.history?.length){root.createEl('h3',{text:'История выполнения'});for(const h of [...task.history].reverse())root.createEl('p',{text:`${h.date}${h.startTime?' '+h.startTime+(h.endTime?'–'+h.endTime:''):''} · ${h.name} (${h.subtasks.filter(s=>s.checked).length}/${h.subtasks.length})`});}
}
