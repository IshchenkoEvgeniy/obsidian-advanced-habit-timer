import { ItemView, Modal, Notice, Setting, moment, setIcon, type WorkspaceLeaf } from 'obsidian';
import type HabitTimerPlugin from '../main';
import type { DailyTask } from './model';
import {taskEditorFields} from './editor-fields';
import {taskMatches,taskStatuses,occurrenceDates,taskIsMissed,taskCarriesOver} from './planning';
import { get } from 'svelte/store';
export const VIEW_TYPE_TASKS = 'habit-standalone-tasks';
export class TasksView extends ItemView {
    private filter = 'today';
    private query='';
    private list='';
    private layout='list';
    private month=moment().format('YYYY-MM');
    constructor(leaf: WorkspaceLeaf, private plugin: HabitTimerPlugin) { super(leaf); }
    getViewType() { return VIEW_TYPE_TASKS; }
    getDisplayText() { return 'Задания'; }
    getIcon() { return 'list-checks'; }
    async onOpen() { await this.render(); }
    private async run(fn: () => Promise<unknown>) { try { await fn(); await this.render(); } catch(e) { new Notice(String(e)); } }
    async render() {
        const tasks = await this.plugin.tasks.list(), today = moment().format('YYYY-MM-DD');
        const syncState=await this.plugin.tasks.syncStates();
        const root = this.contentEl; root.empty(); root.addClass('standalone-tasks');
        root.createEl('h2', {text:'Задания'});
        const timer=await this.plugin.tasks.timer();
        if(timer){const active=root.createDiv({cls:'standalone-toolbar'});active.createEl('strong',{text:`${timer.task.name} · ${Math.floor((Date.now()-timer.started)/60000)} мин`});const finish=active.createEl('button',{text:'Завершить сессию'});finish.onclick=()=>{const modal=new Modal(this.app);modal.titleEl.setText('Результат сессии');let note='';new Setting(modal.contentEl).setName('Комментарий').addTextArea(c=>c.onChange(v=>note=v));new Setting(modal.contentEl).addButton(c=>c.setButtonText('Сохранить').onClick(async()=>{await this.run(()=>this.plugin.tasks.finish(note));modal.close();}));modal.open();};}
        const toolbar=root.createDiv({cls:'standalone-toolbar'});
        const select=toolbar.createEl('select');
        for(const [value,text] of [['inbox','Входящие'],['today','Сегодня'],['upcoming','Предстоящие'],['overdue','Просроченные'],['missed','Не выполнено'],['undated','Без даты'],['done','Выполненные'],['all','Все']]) select.createEl('option',{value,text});
        select.value=this.filter; select.onchange=()=>{this.filter=select.value;void this.render();};
        const search=toolbar.createEl('input',{type:'search',attr:{placeholder:'Поиск по названию, описанию и тегам','aria-label':'Поиск'}});search.value=this.query;search.onchange=()=>{this.query=search.value;void this.render();};
        const lists=toolbar.createEl('select',{attr:{'aria-label':'Список'}});lists.createEl('option',{value:'',text:'Все списки'});for(const name of new Set(tasks.map(t=>t.list).filter(Boolean)))lists.createEl('option',{value:name!,text:name!});lists.value=this.list;lists.onchange=()=>{this.list=lists.value;void this.render();};
        const layout=toolbar.createEl('select',{attr:{'aria-label':'Представление'}});for(const [value,text] of [['list','Список'],['kanban','Канбан'],['calendar','Календарь']])layout.createEl('option',{value,text});layout.value=this.layout;layout.onchange=()=>{this.layout=layout.value;void this.render();};
        if(this.layout==='calendar'){const month=toolbar.createEl('input',{type:'month',attr:{'aria-label':'Месяц'}});month.value=this.month;month.onchange=()=>{this.month=month.value;void this.render();};}
        const add=toolbar.createEl('button',{attr:{'aria-label':'Добавить задание',title:'Добавить задание'}});setIcon(add,'plus');add.onclick=()=>this.edit();
        const sync=toolbar.createEl('button',{attr:{'aria-label':'Синхронизировать',title:'Синхронизировать'}});setIcon(sync,'refresh-cw');sync.onclick=()=>void this.run(()=>this.plugin.tasks.sync());
        const registry=toolbar.createEl('button',{attr:{'aria-label':'Все задания: заметка',title:'Все задания: заметка'}});setIcon(registry,'notebook');registry.onclick=()=>void this.app.workspace.openLinkText(this.plugin.tasks.registryPath,'',true);
        const monthEnd=`${this.month}-${String(new Date(Number(this.month.slice(0,4)),Number(this.month.slice(5)),0).getDate()).padStart(2,'0')}`;
        const visible=tasks.filter(t=>taskMatches(t,this.layout==='calendar'?'all':this.filter,today,this.query,this.list)&&(this.layout!=='calendar'||occurrenceDates(t,this.month+'-01',monthEnd).length>0)).sort((a,b)=>(a.order||0)-(b.order||0)||a.date.localeCompare(b.date));
        const groups=new Map<string,HTMLElement>();
        if(this.layout!=='list'){
            const grid=root.createDiv({cls:'task-planning-grid '+this.layout});
            if(this.layout==='calendar'){
                for(const label of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])grid.createEl('strong',{text:label});
                const offset=(new Date(this.month+'-01T12:00:00Z').getUTCDay()+6)%7;
                for(let n=0;n<offset;n++)grid.createDiv();
            }
            const keys=this.layout==='kanban'?Object.keys(taskStatuses):Array.from({length:new Date(Number(this.month.slice(0,4)),Number(this.month.slice(5)),0).getDate()},(_,i)=>`${this.month}-${String(i+1).padStart(2,'0')}`);
            for(const key of keys){const column=grid.createEl('section');column.createEl('h3',{text:this.layout==='kanban'?taskStatuses[key as keyof typeof taskStatuses]:key.slice(8)});groups.set(key,column);}
        }
        if(!visible.length)root.createEl('p',{text:'Нет заданий',cls:'setting-item-description'});
        for(const {task,occurrenceDate} of visible.flatMap(task=>(this.layout==='calendar'?occurrenceDates(task,this.month+'-01',monthEnd):[task.date]).map(occurrenceDate=>({task,occurrenceDate})))){
            const row=(groups.get(this.layout==='kanban'?(task.done?'completed':task.status||'planned'):occurrenceDate)||root).createDiv({cls:'standalone-row'});
            const check=row.createEl('input',{type:'checkbox',attr:{'aria-label':'Выполнено'}});check.checked=task.done;check.disabled=!!task.repeat&&this.layout==='calendar'&&occurrenceDate!==today;check.onchange=()=>void this.run(()=>this.plugin.tasks.save({...task,done:check.checked}));
            const body=row.createDiv();if(taskIsMissed(task,today)||this.layout==='calendar'&&!task.done&&!taskCarriesOver(task)&&occurrenceDate<today)body.createEl('div',{text:'Не выполнено',cls:'setting-item-description'}); const title=body.createEl('button',{text:task.name,cls:'standalone-title'});title.onclick=()=>this.edit(task);
            const status=body.createEl('button',{text:syncState.conflicts[task.id]?'Конфликт':syncState.pending.includes(task.id)?'Ожидает отправки':'Сохранено',cls:'standalone-title'});
            status.onclick=()=>{const remote=syncState.conflicts[task.id];if(!remote)return;const m=new Modal(this.app);m.titleEl.setText('Сравнить версии');const merged={...task};
                for(const key of ['name','date','deadline','priority','done','deleted','habitName','description','links','list','tags','status','subtasks','repeat','reminderTime','startTime','endTime','history','carryOver'] as const){if(JSON.stringify(task[key])===JSON.stringify(remote[key]))continue;new Setting(m.contentEl).setName(key).setDesc(`Obsidian: ${JSON.stringify(task[key])??'—'}\nTelegram: ${JSON.stringify(remote[key])??'—'}`).addDropdown(c=>c.addOptions({local:'Obsidian',remote:'Telegram'}).onChange(v=>Object.assign(merged,{[key]:v==='remote'?remote[key]:task[key]})));}
                new Setting(m.contentEl).addButton(c=>c.setButtonText('Объединить выбранное').onClick(async()=>{await this.run(()=>this.plugin.tasks.resolve(task.id,'local',merged));m.close();})).addButton(c=>c.setButtonText('Версия Telegram').onClick(async()=>{await this.run(()=>this.plugin.tasks.resolve(task.id,'remote'));m.close();}));m.open();};
            body.createEl('div',{text:`${occurrenceDate}${task.startTime?' · '+task.startTime+(task.endTime?'–'+task.endTime:''):''}${task.deadline?' · Срок: '+task.deadline:''}${task.subtasks.length?' · '+task.subtasks.filter(s=>s.checked).length+'/'+task.subtasks.length:''}`,cls:'setting-item-description'});
            const open=row.createEl('button',{attr:{title:'Дневная заметка','aria-label':'Дневная заметка'}});setIcon(open,'file-text');open.onclick=()=>{const file=this.plugin.dailyNotes.getNote(task.date||task.noteDate||today);if(file)void this.app.workspace.getLeaf(false).openFile(file);};
            const up=row.createEl('button',{attr:{title:'Выше','aria-label':'Выше'}});setIcon(up,'arrow-up');up.onclick=()=>void this.run(()=>this.plugin.tasks.save({...task,order:Math.min(...tasks.map(t=>t.order||0))-1}));
            if(!task.done){const play=row.createEl('button',{attr:{title:'Таймер задания','aria-label':'Таймер задания'}});setIcon(play,'play');play.onclick=()=>void this.run(()=>this.plugin.tasks.start(task));}
        }
    }
    private edit(existing?: DailyTask) {
        const task:DailyTask=existing?JSON.parse(JSON.stringify(existing)):{id:crypto.randomUUID(),name:'',date:'',deadline:'',priority:'',done:false,deleted:false,habitName:'',subtasks:[],revision:0};
        const modal=new Modal(this.app);modal.titleEl.setText(existing?'Задание':'Новое задание');
        new Setting(modal.contentEl).setName('Название').addText(c=>c.setValue(task.name).onChange(v=>task.name=v));
        taskEditorFields(modal.contentEl,task);
        new Setting(modal.contentEl).setName('Проект').addDropdown(c=>{c.addOption('','Без проекта');for(const s of this.plugin.settings.projectScopes)c.addOption(s.id,s.name);c.setValue(task.projectId||'').onChange(v=>task.projectId=v);});
        new Setting(modal.contentEl).setName('Произведение').addDropdown(c=>{c.addOption('','Без произведения');for(const item of get(this.plugin.stateManager.mediaItems))c.addOption(item.file.path,item.title);if(task.mediaPath)c.addOption(task.mediaPath,get(this.plugin.stateManager.mediaItems).find(i=>i.file.path===task.mediaPath)?.title||task.mediaPath);c.setValue(task.mediaPath||'').onChange(v=>task.mediaPath=v);});
        for(const [key,label] of [['date','Плановая дата'],['deadline','Дедлайн']] as const)new Setting(modal.contentEl).setName(label).addText(c=>{c.inputEl.type='date';c.setValue(task[key]).onChange(v=>task[key]=v);});
        new Setting(modal.contentEl).setName('Приоритет').addDropdown(c=>c.addOptions({'':'Без приоритета',low:'Низкий',medium:'Средний',high:'Высокий'}).setValue(task.priority).onChange(v=>task.priority=v));
        new Setting(modal.contentEl).setName('Привычка').addDropdown(c=>{c.addOption('','Без привычки');for(const h of this.plugin.settings.properties.filter(h=>h.type==='timer'))c.addOption(h.name,h.name);c.setValue(task.habitName).onChange(v=>task.habitName=v);});
        const subs=modal.contentEl.createDiv();
        const draw=()=>{subs.empty();task.subtasks.forEach((s,i)=>new Setting(subs).addToggle(c=>c.setValue(s.checked).onChange(v=>s.checked=v)).addText(c=>c.setValue(s.text).onChange(v=>s.text=v)).addText(c=>{c.inputEl.type='date';c.inputEl.setAttribute('aria-label','Дата подзадачи');c.setValue(s.date||'').onChange(v=>s.date=v);}).addExtraButton(c=>c.setIcon('trash').setTooltip('Удалить подзадачу').onClick(()=>{task.subtasks.splice(i,1);draw();})));};draw();
        new Setting(modal.contentEl).addButton(c=>c.setButtonText('Добавить подзадачу').onClick(()=>{task.subtasks.push({text:'',checked:false});draw();}));
        new Setting(modal.contentEl).addButton(c=>c.setButtonText('Сохранить').setCta().onClick(async()=>{try{await this.plugin.tasks.save(task);modal.close();await this.render();}catch(e){new Notice(String(e));}}));
        if(existing)new Setting(modal.contentEl).addButton(c=>c.setButtonText('Удалить').setWarning().onClick(()=>{
            const confirm=new Modal(this.app);confirm.titleEl.setText('Удалить задание?');confirm.contentEl.createEl('p',{text:task.name});
            new Setting(confirm.contentEl).addButton(b=>b.setButtonText('Отмена').onClick(()=>confirm.close())).addButton(b=>b.setButtonText('Удалить').setWarning().onClick(async()=>{await this.run(()=>this.plugin.tasks.save({...task,deleted:true}));confirm.close();modal.close();}));confirm.open();
        }));modal.open();
    }
}
