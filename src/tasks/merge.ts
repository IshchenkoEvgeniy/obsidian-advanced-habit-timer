import type { DailyTask } from './model';

const fields = ['name','date','deadline','priority','done','deleted','habitName','subtasks','noteDate','description','links','list','tags','order','status','mediaPath','projectId','repeat','reminderTime','startTime','endTime','history','carryOver'] as const;
const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Replay only the local edits, preserving unrelated changes from the other device. */
export function rebaseTask(local:DailyTask,base:DailyTask|undefined,remote:DailyTask):DailyTask {
    if(local.id!==remote.id)throw new Error('Несовпадение ID задания');
    const changed=fields.filter(key=>!base||!same(local[key],base[key]));
    if(base && remote.deleted!==base.deleted && remote.deleted && changed.some(key=>key!=='deleted'))throw new Error('Задание удалено в облаке, но изменено локально. Обе версии сохранены.');
    if(base && local.deleted!==remote.deleted && (local.deleted||remote.deleted)
        && fields.some(key=>key!=='deleted'&&!same(remote[key],base[key]))) {
        throw new Error('Конфликт удаления задания: локальная и облачная версии сохранены.');
    }
    const conflict=changed.filter(key=>!same(local[key],remote[key])&&(!base||!same(remote[key],base[key])));
    if(conflict.length)throw new Error(`Задание «${local.name}» изменено с двух сторон (${conflict.join(', ')}). Обе версии сохранены.`);
    const result={...remote};
    for(const key of changed)Object.assign(result,{[key]:local[key]});
    return result;
}
