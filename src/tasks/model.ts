import type { TaskRepeat, TaskCompletion, TaskStatus } from './planning';
export interface DailyTask {
    carryOver?: boolean;
    autoHabitId?: string;
    id: string;
    name: string;
    date: string;
    deadline: string;
    priority: string;
    done: boolean;
    deleted: boolean;
    habitName: string;
    subtasks: Array<{ text: string; checked: boolean; date?:string }>;
    revision: number;
    noteDate?:string;
    description?:string;
    links?:string[];
    list?:string;
    tags?:string[];
    order?:number;
    status?:TaskStatus;
    mediaPath?:string;
    projectId?:string;
    repeat?:TaskRepeat|null;
    reminderTime?:string;
    startTime?:string;
    endTime?:string;
    history?:TaskCompletion[];
}
export function validTask(task: DailyTask): boolean {
    const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
    return /^[a-f0-9-]{36}$/i.test(task.id) && typeof task.name === 'string' && !!task.name.trim() && task.name.length <= 250
        && (task.carryOver===undefined||typeof task.carryOver==='boolean')
        && !/[\r\n]|<!--|-->/.test(task.name) && typeof task.date==='string' && (!task.date || date(task.date)) && (!task.noteDate||date(task.noteDate)) && (!task.deadline || date(task.deadline))
        && ['low', 'medium', 'high', ''].includes(task.priority) && typeof task.done === 'boolean' && typeof task.deleted === 'boolean'
        && typeof task.habitName === 'string' && Array.isArray(task.subtasks) && task.subtasks.length <= 100
        && task.subtasks.every(s => typeof s.text === 'string' && !!s.text.trim() && s.text.length <= 250 && !/[\r\n]/.test(s.text) && typeof s.checked === 'boolean' && (!s.date||date(s.date)))
        && (!task.description || typeof task.description==='string'&&task.description.length<=10000)
        && (!task.status||['planned','active','waiting','completed','cancelled'].includes(task.status))
        && (!task.tags||Array.isArray(task.tags)&&task.tags.length<=50&&task.tags.every(t=>typeof t==='string'&&t.length<=100))
        && (!task.links||Array.isArray(task.links)&&task.links.length<=50&&task.links.every(t=>typeof t==='string'&&t.length<=2000))
        && (!task.reminderTime||/^([01]\d|2[0-3]):[0-5]\d$/.test(task.reminderTime))
        && validTaskTimeRange(task)
        && (!task.list||typeof task.list==='string'&&task.list.length<=150)
        && (task.order===undefined||Number.isFinite(task.order))
        && (!task.history||Array.isArray(task.history)&&task.history.every(h=>typeof h.id==='string'&&/^[a-z0-9-]+$/i.test(h.id)&&date(h.date)&&(!h.plannedDate||date(h.plannedDate))&&typeof h.name==='string'&&Array.isArray(h.subtasks)&&h.subtasks.every(s=>typeof s.text==='string'&&typeof s.checked==='boolean')))
        && (!task.repeat||['daily','weekdays','monthly','after'].includes(task.repeat.kind)
            && (task.repeat.kind!=='weekdays'||Array.isArray(task.repeat.weekdays)&&task.repeat.weekdays.length>0&&task.repeat.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6))
            && (task.repeat.kind!=='after'||Number.isInteger(task.repeat.interval)&&task.repeat.interval!>0&&task.repeat.interval!<=365)
            && (task.repeat.kind!=='monthly'||!task.repeat.day||Number.isInteger(task.repeat.day)&&task.repeat.day>=1&&task.repeat.day<=31));
}
export function validTaskTimeRange(task:Pick<DailyTask,'startTime'|'endTime'>):boolean {
    const time=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    return (!task.startTime||time(task.startTime))&&(!task.endTime||time(task.endTime)&&!!task.startTime&&task.endTime>task.startTime);
}
export function putTask(content: string, task: DailyTask, remove = false): string {
    const start = `<!-- daily-task:${task.id} -->`, end = `<!-- /daily-task:${task.id} -->`;
    const a = content.indexOf(start), b = content.indexOf(end, a);
    const clean=(value:string)=>value.replace(/[\r\n]/g,' ').replace(/<!--/g,'&lt;!--').replace(/-->/g,'--&gt;');
    const details=[task.carryOver!==undefined?`Перенос: ${task.carryOver?'да':'нет'}`:'',task.startTime?`Время: ${task.startTime}${task.endTime?`–${task.endTime}`:''}`:'',task.description?`Описание: ${clean(task.description)}`:'',task.list?`Список: ${clean(task.list)}`:'',task.tags?.length?`Теги: ${task.tags.map(clean).join(', ')}`:'',task.status?`Статус: ${task.status}`:'',task.links?.length?`Связи: ${task.links.map(clean).join(', ')}`:'',task.mediaPath?`Произведение: [[${clean(task.mediaPath)}]]`:'',task.projectId?`Проект: ${clean(task.projectId)}`:'',task.repeat?`Повторение: ${JSON.stringify(task.repeat)}`:'',task.reminderTime?`Напоминание: ${task.reminderTime}`:''].filter(Boolean).map(s=>`  ${s}\n`).join('');
    const block = remove || task.deleted ? '' : `${start}\n- [${task.done ? 'x' : ' '}] ${task.name}\n  План: ${task.date||'Без даты'}${task.deadline ? ` | Срок: ${task.deadline}` : ''}${task.priority ? ` | Приоритет: ${task.priority}` : ''}\n${details}${task.subtasks.map(s => `  - [${s.checked ? 'x' : ' '}] ${s.text}${s.date?` [date:: ${s.date}]`:''}\n`).join('')}${end}`;
    if (a >= 0 && b >= a) return content.slice(0, a) + block + content.slice(b + end.length);
    if (!block) return content;
    const heading = '## Задания';
    const lines = content.split('\n'), index = lines.findIndex(l => l.trim() === heading);
    if (index >= 0) { lines.splice(index + 1, 0, '', block); return lines.join('\n'); }
    return `${content.trimEnd()}\n\n${heading}\n\n${block}\n`;
}
export function taskLog(content: string, id: string, text: string): string {
    const marker = `<!-- task-event:${id} -->`;
    if (content.includes(marker)) return content;
    const heading = '## Журнал заданий';
    const line = `- ${text.replace(/[\r\n]/g, ' ')} ${marker}`;
    const lines = content.split('\n'), index = lines.findIndex(l => l.trim() === heading);
    if (index >= 0) { lines.splice(index + 1, 0, line); return lines.join('\n'); }
    return `${content.trimEnd()}\n\n${heading}\n${line}\n`;
}
export function readTaskChecks(content:string, task:DailyTask):DailyTask {
    const start=content.indexOf(`<!-- daily-task:${task.id} -->`),end=content.indexOf(`<!-- /daily-task:${task.id} -->`,start);
    if(start<0||end<start)return task;
    const lines=content.slice(start,end).split(/\r?\n/);
    const main=lines.find(l=>/^- \[[ xX]\] /.test(l));
    if(!main)return task;
    const subtasks=lines.filter(l=>/^ {2}- \[[ xX]\] /.test(l)).map((l,i)=>{const date=l.match(/ \[date:: (\d{4}-\d{2}-\d{2})\]$/);return {...task.subtasks[i],text:date?l.slice(8,-date[0].length):l.slice(8),...(date?{date:date[1]}:{}),checked:l[5]?.toLowerCase()==='x'};});
    return {...task,name:main.slice(6),done:main[3]?.toLowerCase()==='x',subtasks};
}
