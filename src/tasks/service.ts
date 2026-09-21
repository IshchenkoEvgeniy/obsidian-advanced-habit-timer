import { moment, requestUrl, TFile, normalizePath } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { putTask, taskLog, validTask, validTaskTimeRange, readTaskChecks, type DailyTask } from './model';
import { upsertSessionLog } from '../services/session-log';
import { formatDuration, parseDuration } from '../utils';
import { rebaseTask } from './merge';
import { completeTask, occurrenceDates,taskIsOverdue } from './planning';
import { generateHabitTasks } from './habit-tasks';
import { getHabitGoals } from '../habits/goals';
import { getHabitValueFromFrontmatter } from '../services/habit-service';

interface Operation { task: DailyTask; previous?: DailyTask; requestId: string; date: string }
interface TaskState { tasks: DailyTask[]; pending: Operation[]; storageVersion?:number; conflicts?:Record<string,DailyTask>; active?: {task:DailyTask;started:number;id:string}; }
export class TasksService {
    private chain: Promise<unknown> = Promise.resolve();
    constructor(private plugin: HabitTimerPlugin) {}
    private get path() { return `${this.plugin.manifest.dir}/daily-tasks.json`; }
    private async read(): Promise<TaskState> {
        if (!await this.plugin.app.vault.adapter.exists(this.path)) return { tasks: [], pending: [] };
        return JSON.parse(await this.plugin.app.vault.adapter.read(this.path));
    }
    private async write(state: TaskState) { await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(state, null, 2)); }
    private lock<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next;
    }
    get registryPath(){return normalizePath(`${this.plugin.settings.dailyNotesFolder||''}/Задания.md`.replace(/^\//,''));}
    private async registry(){
        const existing=this.plugin.app.vault.getAbstractFileByPath(this.registryPath);
        if(existing instanceof TFile)return existing;
        if(existing)throw new Error('Путь реестра заданий занят папкой');
        return this.plugin.app.vault.create(this.registryPath,'# Все задания\n');
    }
    private async updateFile(file:TFile,change:(content:string)=>string){
        const content=await this.plugin.app.vault.read(file);
        if(change(content)!==content)await this.plugin.app.vault.process(file,change);
    }
    private async materialize(state:TaskState){
        await this.generateHabits(state);
        if(!state.tasks.length)return;
        const today=moment().format('YYYY-MM-DD');
        for(const task of state.tasks)await this.notes({task,requestId:'projection',date:today},false);
        if(state.storageVersion!==2){
            const folder=(this.plugin.settings.dailyNotesFolder||'').replace(/\/$/,'');
            for(const file of this.plugin.app.vault.getMarkdownFiles()){
                if(!/^\d{4}-\d{2}-\d{2}$/.test(file.basename)||file.parent?.path!==(folder||'/'))continue;
                await this.updateFile(file,content=>state.tasks.reduce((text,task)=>{
                    const relevant=file.basename<=today&&(task.date===file.basename||occurrenceDates(task,file.basename,file.basename).length>0||task.history?.some(h=>h.date===file.basename||h.plannedDate===file.basename));
                    return relevant?text:putTask(text,task,true);
                },content));
            }
            state.storageVersion=2;await this.write(state);
        }
    }
    private async generateHabits(state:TaskState){
        const settings=this.plugin.settings;
        // In cloud mode the companion owns generation, even while Obsidian is closed.
        if(settings.telegramMode==='cloudflare'&&settings.cloudflareWorkerUrl&&settings.cloudflareApiToken)return;
        const enabled=(settings.properties||[]).filter(h=>h.autoDailyTask);
        if(!enabled.length)return;
        const date=moment().format('YYYY-MM-DD'),file=this.plugin.dailyNotes.getNote(date);
        const fm=file?this.plugin.app.metadataCache.getFileCache(file)?.frontmatter||{}:{};
        const habits=enabled.map(h=>({...h,desired:getHabitGoals(h,date).desired,value:getHabitValueFromFrontmatter(fm,h)}));
        for(const task of await generateHabitTasks(habits,state.tasks,date)){
            const previous=state.tasks.find(t=>t.id===task.id);
            const op={task,previous,requestId:crypto.randomUUID(),date};
            state.tasks=[...state.tasks.filter(t=>t.id!==task.id),task];state.pending.push(op);
            await this.write(state);await this.notes(op);
        }
    }
    async list() { return this.lock(async()=>{const state=await this.read();await this.importChecks(state);await this.materialize(state);return state.tasks.filter(t=>!t.deleted);}); }
    private async importChecks(state:TaskState) {
        let changed=false;
        const imported:Operation[]=[];
        for(let i=0;i<state.tasks.length;i++){
            const task=state.tasks[i]!;if(task.deleted)continue;
            const registry=this.plugin.app.vault.getAbstractFileByPath(this.registryPath);
            const today=moment().format('YYYY-MM-DD');
            const alreadyCompleted=state.storageVersion===2&&task.repeat&&task.history?.some(h=>h.date===today||h.plannedDate===today);
            const files=[registry instanceof TFile?registry:null,alreadyCompleted?null:this.plugin.dailyNotes.getNote(state.storageVersion===2?today:task.date||task.noteDate||'')];
            let checked=task;
            for(const file of files){if(!file)continue;const candidate=readTaskChecks(await this.plugin.app.vault.read(file),task);if(JSON.stringify(candidate)!==JSON.stringify(task)){checked=candidate;break;}}
            const updated=checked.done!==task.done?completeTask(checked,task,moment().format('YYYY-MM-DD'),crypto.randomUUID()):checked;
            if(validTask(updated)&&JSON.stringify(updated)!==JSON.stringify(task)){
                const op={task:updated,previous:task,requestId:crypto.randomUUID(),date:moment().format('YYYY-MM-DD')};
                state.tasks[i]=updated;state.pending.push(op);imported.push(op);changed=true;
            }
        }
        if(changed)await this.write(state);
        for(const op of imported)await this.log(op);
    }
    async timer() { await this.chain; return (await this.read()).active; }
    async syncStates(){await this.chain;const s=await this.read();return {pending:s.pending.map(p=>p.task.id),conflicts:s.conflicts||{}};}
    async resolve(id:string,choice:'local'|'remote',merged?:DailyTask){await this.lock(async()=>{
        const state=await this.read(),remote=state.conflicts?.[id],local=state.tasks.find(t=>t.id===id);if(!remote||!local)return;
        const task=choice==='remote'?remote:{...(merged||local),revision:remote.revision};
        if(!validTask(task))throw new Error('Некорректное задание');
        state.pending=state.pending.filter(p=>p.task.id!==id);
        if(choice==='local')state.pending.push({task,previous:remote,requestId:crypto.randomUUID(),date:moment().format('YYYY-MM-DD')});
        state.tasks=state.tasks.map(t=>t.id===id?task:t);delete state.conflicts![id];await this.write(state);
        await this.notes({task,previous:local,requestId:crypto.randomUUID(),date:moment().format('YYYY-MM-DD')});
    });}
    async start(task:DailyTask) { await this.lock(async()=>{const state=await this.read();if(state.active)throw new Error('Сначала завершите таймер задания');state.active={task,started:Date.now(),id:crypto.randomUUID()};await this.write(state);}); }
    async finish(note:string) { await this.lock(async()=>{
        const state=await this.read(),active=state.active;if(!active)return;
        await this.session(active.task,Math.floor((Date.now()-active.started)/1000),moment(active.started).format('HH:mm'),moment().format('HH:mm'),note,active.id,moment().format('YYYY-MM-DD'));
        delete state.active;await this.write(state);
    }); }
    async session(task:DailyTask,seconds:number,startTime:string,endTime:string,note:string,id:string,date:string) {
        const file=await this.plugin.dailyNotes.ensureNote(date);if(!file)throw new Error('Дневная заметка недоступна');
        const marker=`<!-- task-session:${id} -->`,cell=(s:string)=>s.replace(/[\r\n|]/g,' ');
        await this.plugin.app.vault.process(file,c=>c.includes(marker)?c:taskLog(upsertSessionLog(c,`| ${cell(startTime)} - ${cell(endTime)} | Timer | ${cell(task.habitName||'Задания')} | ${formatDuration(seconds)} | - | ${cell(task.name)}: ${cell(note)} ${marker} |`),id,`Сессия: ${task.name}, ${formatDuration(seconds)}${note?' · '+note:''}`));
        if(task.habitName)await this.plugin.app.fileManager.processFrontMatter(file,fm=>{
            const ids=Array.isArray(fm['Task-Session-IDs'])?fm['Task-Session-IDs']:[];
            if(ids.includes(id))return;
            fm[task.habitName]=formatDuration(parseDuration(fm[task.habitName])+seconds);
            fm['Task-Session-IDs']=[...ids,id];
        });
    }
    async save(task: DailyTask) {
        if(!validTaskTimeRange(task))throw new Error('Укажите время начала и окончание позже начала (в пределах одного дня).');
        if (!validTask(task)) throw new Error('Проверьте название и даты задания');
        return this.lock(async () => {
            const state = await this.read(), previous = state.tasks.find(t => t.id === task.id);
            if(task.deleted&&state.active?.task.id===task.id)throw new Error('Сначала завершите таймер задания');
            task=completeTask({...task,revision:previous?.revision??task.revision},previous,moment().format('YYYY-MM-DD'),crypto.randomUUID());
            const op: Operation = {task, previous, requestId: crypto.randomUUID(), date: moment().format('YYYY-MM-DD')};
            state.tasks = [...state.tasks.filter(t => t.id !== task.id), task];
            state.pending.push(op);
            await this.write(state);
            await this.notes(op);
        });
    }
    private async notes(op: Operation, logChange = true) {
        const {task} = op;
        await this.updateFile(await this.registry(),c=>putTask(c,task));
        const today=moment().format('YYYY-MM-DD');
        const due=task.date===today||occurrenceDates(task,today,today).length>0||taskIsOverdue(task,today);
        const file=due?await this.plugin.dailyNotes.ensureNote(today):this.plugin.dailyNotes.getNote(today);
        if(file){
            const completed=task.history?.find(h=>h.date===today||h.plannedDate===today);
            await this.updateFile(file,c=>completed?putTask(c,{...task,name:completed.name,date:today,done:true,subtasks:completed.subtasks}):due?putTask(c,{...task,date:today}):putTask(c,task,true));
        }
        if(logChange)await this.log(op);
    }
    private async log(op:Operation) {
        const {task,previous}=op;
        const log = await this.plugin.dailyNotes.ensureNote(op.date);
        if (!log) throw new Error('Не удалось создать журнал заданий');
        const action = task.deleted ? 'Удалено' : !previous ? 'Создано' : previous.date !== task.date ? `Перенесено с ${previous.date} на ${task.date}` : task.done !== previous.done ? task.done ? 'Выполнено' : 'Возобновлено' : 'Изменено';
        await this.plugin.app.vault.process(log, c => taskLog(c, op.requestId, `${action}: ${task.name}`));
        for(const entry of task.history||[]){
            const file=await this.plugin.dailyNotes.ensureNote(entry.date);if(!file)throw new Error('Не удалось сохранить историю выполнения');
            await this.plugin.app.vault.process(file,c=>taskLog(c,`completion-${entry.id}`,`Выполнено: ${entry.name}; план: ${entry.plannedDate||'без даты'}${entry.startTime?' '+entry.startTime+(entry.endTime?'–'+entry.endTime:''):''}; подзадачи: ${entry.subtasks.map(s=>`${s.checked?'[x]':'[ ]'} ${s.text}`).join('; ')}`));
        }
    }
    async apply(task: DailyTask, previous: DailyTask | undefined, id: string, date: string) {
        await this.lock(async () => {
            const state = await this.read();
            // Do not advance the event cursor while a local edit still needs conflict resolution.
            if (state.pending.some(p => p.task.id === task.id)) throw new Error('Конфликт задания: сначала синхронизируйте локальные изменения');
            const current=state.tasks.find(t=>t.id===task.id);
            if(!current||current.revision<=task.revision){
                await this.notes({task,previous,requestId:id,date});
                state.tasks = [...state.tasks.filter(t => t.id !== task.id), task];
            }else await this.log({task,previous,requestId:id,date});
            await this.write(state);
        });
    }
    async sync() {
        await this.lock(async () => {
            const state = await this.read();
            await this.importChecks(state);
            await this.materialize(state);
            for (const op of state.pending) await this.notes(op);
            const settings = this.plugin.settings;
            if (!settings.cloudflareWorkerUrl || !settings.cloudflareApiToken) return;
            const workerUrl=settings.cloudflareWorkerUrl;
            const request = async (body?: unknown) => {
                const result = await requestUrl({url:workerUrl.replace(/\/$/,'')+'/api/tasks',method:body?'POST':'GET',headers:{Authorization:`Bearer ${settings.cloudflareApiToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,throw:false});
                if (result.status !== 200) throw new Error(result.json?.error === 'task_conflict' ? 'task_conflict' : `Синхронизация заданий: HTTP ${result.status}`);
                return result.json;
            };
            while (state.pending.length) {
                const op = state.pending[0]!;
                let result;
                for(let attempt=0;attempt<3;attempt++){
                    try { result=await request({task:op.task,requestId:op.requestId,confirm:op.task.deleted});break; }
                    catch(error){
                        if(!(error instanceof Error)||error.message!=='task_conflict')throw error;
                        if(attempt===2)throw new Error('Задание продолжает изменяться в облаке. Повторите синхронизацию.');
                        const remote=((await request()).tasks as DailyTask[]).find(t=>t.id===op.task.id);
                        if(!remote)throw new Error('Облачная версия задания не найдена. Локальная очередь сохранена.');
                        try { op.task=rebaseTask(op.task,op.previous,remote); }
                        catch(error){state.conflicts={...state.conflicts,[op.task.id]:remote};await this.write(state);throw error;}
                        op.previous=remote;
                        await this.write(state);
                    }
                }
                // Old server versions acknowledge retries without returning the accepted task.
                const accepted:DailyTask=result.task || ((await request()).tasks as DailyTask[]).find(t=>t.id===op.task.id);
                if(!accepted)throw new Error('Сервер не подтвердил версию задания');
                state.pending.shift();
                if(state.conflicts)delete state.conflicts[op.task.id];
                const next = state.pending.find(p=>p.task.id===op.task.id);
                if(next){
                    try { next.task=rebaseTask(next.task,next.previous,accepted);next.previous=accepted; }
                    catch(error){state.conflicts={...state.conflicts,[next.task.id]:accepted};await this.write(state);throw error;}
                }else{
                    const previous=state.tasks.find(t=>t.id===op.task.id);
                    await this.notes({task:accepted,previous,requestId:op.requestId,date:op.date},false);
                    state.tasks=state.tasks.map(t=>t.id===accepted.id?accepted:t);
                }
                await this.write(state);
            }
            const remote = (await request()).tasks as DailyTask[];
            for (const task of remote) {
                const previous=state.tasks.find(t=>t.id===task.id);
                if (!previous || previous.revision !== task.revision) await this.notes({task,previous,requestId:`snapshot-${task.id}-${task.revision}`,date:moment().format('YYYY-MM-DD')},false);
            }
            state.tasks=remote;
            await this.write(state);
        });
    }
}
