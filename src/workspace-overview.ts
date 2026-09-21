import { ItemView, Notice, moment, setIcon, type WorkspaceLeaf } from 'obsidian';
import { get } from 'svelte/store';
import type HabitTimerPlugin from './main';
import { formatDuration } from './utils';
import { getHabitValueFromFrontmatter, getHabitWeeklyValue, getHabitDeferredBonus } from './services/habit-service';
import { getHabitGoals } from './habits/goals';
import { isDone } from './utils/status';

export const VIEW_TYPE_OVERVIEW='habit-workspace-overview';
export class WorkspaceOverview extends ItemView {
    private version=0;
    constructor(leaf:WorkspaceLeaf,private plugin:HabitTimerPlugin){super(leaf);}
    getViewType(){return VIEW_TYPE_OVERVIEW;}
    getDisplayText(){return 'Focus Library';}
    getIcon(){return 'layers';}
    async onOpen(){await this.render();this.registerEvent(this.app.metadataCache.on('changed',()=>{void this.render().catch(e=>new Notice(String(e)));}));}
    async onClose(){this.version++;}
    private async navigate(type:string){await this.leaf.setViewState({type,active:true});}
    private button(parent:HTMLElement,icon:string,label:string,action:()=>unknown){
        const b=parent.createEl('button',{cls:'fl-action',attr:{title:label,'aria-label':label}});setIcon(b,icon);
        b.onclick=()=>{b.disabled=true;Promise.resolve().then(action).catch(e=>new Notice(String(e))).finally(()=>b.disabled=false);};return b;
    }
    async render(){
        const version=++this.version,date=moment().format('YYYY-MM-DD');
        const tasks=await this.plugin.tasks.list();
        const projectTasks=[];
        for(const scope of this.plugin.settings.projectScopes){
            try{for(const task of await this.plugin.projectEngine.loadTasks(scope))if(!isDone(task.status||''))projectTasks.push({task,scope});}
            catch(e){console.warn('Overview project load failed',scope.id,e);}
        }
        if(version!==this.version)return;
        const root=this.contentEl;root.empty();root.addClass('fl-overview');
        const header=root.createDiv({cls:'fl-overview-header'});
        header.createDiv().createEl('h1',{text:'Моё пространство'});
        header.createEl('span',{text:moment().format('D MMMM YYYY'),cls:'fl-muted'});
        const active=this.plugin.settings.activeTimer;
        const focus=root.createDiv({cls:'fl-focus'});
        const mark=focus.createDiv({cls:'fl-focus-mark'});setIcon(mark,active?'timer':'circle-play');
        const focusBody=focus.createDiv({cls:'fl-focus-body'});
        focusBody.createEl('span',{text:active?'ТЕКУЩАЯ СЕССИЯ':'ФОКУС',cls:'fl-eyebrow'});
        focusBody.createEl('h2',{text:active?active.habitName:'Время для важного'});
        if(active){
            const seconds=(active.elapsedSeconds||0)+(active.timerState==='running'&&active.lastStartedAt?Math.max(0,Math.floor((Date.now()-active.lastStartedAt)/1000)):0);
            focusBody.createEl('span',{text:`${formatDuration(seconds)} · ${active.timerState==='running'?'Идёт сессия':'На паузе'}`,cls:'fl-muted'});
        }
        const start=focus.createEl('button',{text:active?'Открыть таймер':'Начать сессию',cls:'mod-cta'});start.onclick=()=>void this.navigate('habit-timer-view');
        const columns=root.createDiv({cls:'fl-overview-columns'});
        const habitSection=columns.createEl('section');this.heading(habitSection,'Привычки','repeat-2','habit-timer-view');
        const note=this.plugin.getDailyNote(date),fm=note?this.app.metadataCache.getFileCache(note)?.frontmatter||{}:{};
        for(const habit of this.plugin.settings.properties){
            const row=habitSection.createDiv({cls:'fl-line'}),body=row.createDiv({cls:'fl-line-body'});
            body.createEl('strong',{text:habit.name});
            const goal=getHabitGoals(habit,date,getHabitDeferredBonus(this.app,this.plugin.settings.dailyNotesFolder,habit,date));
            const value=goal.mode==='weekly'?getHabitWeeklyValue(this.app,this.plugin.settings.dailyNotesFolder,habit,date):getHabitValueFromFrontmatter(fm,habit);
            body.createEl('span',{text:habit.type==='timer'?`${formatDuration(value)} / ${formatDuration(goal.desired)}`:`${value} / ${goal.desired}`,cls:'fl-muted'});
            const meter=body.createEl('progress',{attr:{max:String(Math.max(1,goal.desired)),value:String(value),'aria-label':habit.name}});meter.addClass('fl-progress');
            this.button(row,habit.type==='timer'?'play':'arrow-up-right','Открыть привычку',async()=>{
                if(habit.type==='timer'){if(!await this.plugin.startTimerForHabit(habit.name,{openView:false}))return;}
                await this.navigate('habit-timer-view');
            });
        }
        if(!this.plugin.settings.properties.length)habitSection.createEl('p',{text:'Привычек пока нет',cls:'fl-muted'});
        const taskSection=columns.createEl('section');this.heading(taskSection,'Ближайшие задания','list-checks','habit-standalone-tasks');
        const pending=tasks.filter(t=>!t.done).sort((a,b)=>(a.deadline||a.date).localeCompare(b.deadline||b.date)).slice(0,5);
        for(const task of pending){
            const row=taskSection.createDiv({cls:'fl-line'}),check=row.createEl('input',{type:'checkbox',attr:{'aria-label':`Выполнить: ${task.name}`}});
            check.onchange=()=>{check.disabled=true;void this.plugin.tasks.save({...task,done:check.checked}).then(()=>this.render()).catch(e=>{check.disabled=false;check.checked=false;new Notice(String(e));});};
            const body=row.createDiv({cls:'fl-line-body'});body.createEl('strong',{text:task.name});body.createEl('span',{text:task.deadline?`Срок: ${task.deadline}`:task.date,cls:'fl-muted'});
            this.button(row,'arrow-up-right','Открыть задания',()=>this.navigate('habit-standalone-tasks'));
        }
        if(!pending.length)taskSection.createEl('p',{text:'Нет запланированных заданий',cls:'fl-muted'});
        const projects=taskSection.createDiv({cls:'fl-project-summary'});projects.createEl('strong',{text:`${projectTasks.length} активных задач в проектах`});this.button(projects,'columns-3','Открыть проекты',()=>this.navigate('habit-projects-view'));
        const library=root.createEl('section');this.heading(library,'Продолжить','library','habit-library-view');
        const media=get(this.plugin.stateManager.mediaItems).filter(item=>this.plugin.settings.mediaCollections.some(c=>c.id.toLowerCase()===item.collectionId.toLowerCase()&&!!c.readingStatusName&&c.readingStatusName.trim().toLowerCase()===item.status.trim().toLowerCase()));
        const shelf=library.createDiv({cls:'fl-shelf'});
        for(const item of media.slice(0,6)){
            const card=shelf.createEl('article',{cls:'fl-media'});
            if(item.cover)card.createEl('img',{attr:{src:item.cover,alt:'',loading:'lazy'}});else setIcon(card.createDiv({cls:'fl-cover-fallback'}),'book-open');
            const body=card.createDiv({cls:'fl-line-body'});body.createEl('span',{text:item.collectionId,cls:'fl-eyebrow'});body.createEl('strong',{text:item.title});body.createEl('span',{text:item.authors.join(', '),cls:'fl-muted'});
            this.button(card,'play','Продолжить: '+item.title,async()=>{if(await this.plugin.startTimerForMedia(item,{openView:false}))await this.navigate('habit-timer-view');});
        }
        if(!media.length)library.createEl('p',{text:'Нет произведений в процессе',cls:'fl-muted'});
    }
    private heading(parent:HTMLElement,title:string,icon:string,type:string){const h=parent.createDiv({cls:'fl-section-title'});h.createEl('h2',{text:title});this.button(h,icon,'Открыть: '+title,()=>this.navigate(type));}
}
