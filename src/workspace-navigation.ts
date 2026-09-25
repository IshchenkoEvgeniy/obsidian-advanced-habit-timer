import { Notice, setIcon, type ItemView } from 'obsidian';
import type HabitTimerPlugin from './main';

export const WORKSPACE_SECTIONS = [
    {type:'habit-home-view', label:'Сегодня', en:'Today', icon:'house'},
    {type:'habit-timer-view', label:'Таймер и привычки', en:'Timer & habits', icon:'timer'},
    {type:'habit-standalone-tasks', label:'Задания', en:'Tasks', icon:'list-checks'},
    {type:'habit-projects-view', label:'Проекты', en:'Projects', icon:'columns-3'},
    {type:'habit-library-view', label:'Библиотека', en:'Library', icon:'library'},
    {type:'habit-timer-stats-view', label:'Статистика', en:'Statistics', icon:'chart-no-axes-combined'},
] as const;

/** Keep the real ItemView lifecycle and content element intact for each existing section. */
export function withWorkspaceNavigation<T extends ItemView>(view:T, plugin:HabitTimerPlugin):T {
    const lifecycle=view as unknown as {onOpen():Promise<void>;onClose():Promise<void>};
    const open=lifecycle.onOpen.bind(view), close=lifecycle.onClose.bind(view);
    let navigation:HTMLElement|undefined;
    lifecycle.onOpen=async()=>{
        const ru=plugin.settings.language==='ru';
        view.containerEl.addClass('ht-workspace-shell');
        navigation=view.containerEl.createDiv({cls:'ht-workspace-navigation'});
        const top=navigation.createDiv({cls:'ht-workspace-top'});
        const brand=top.createDiv({cls:'ht-workspace-brand'});
        setIcon(brand.createSpan({cls:'ht-workspace-mark'}),'layers');
        brand.createSpan({text:'Focus Library'});
        const actions=top.createDiv({cls:'ht-workspace-actions'});
        const button=(icon:string,label:string,run:()=>void)=>{
            const el=actions.createEl('button',{cls:'ht-workspace-icon',attr:{title:label,'aria-label':label}});
            setIcon(el,icon);el.onclick=run;return el;
        };
        const sync=button('refresh-cw',ru?'Синхронизировать с Telegram':'Sync with Telegram',()=>{
            if(sync.disabled)return;sync.disabled=true;
            void plugin.companion.sync().then(ok=>new Notice(ok?(ru?'Синхронизировано':'Synchronized'):(ru?'Синхронизация недоступна. Проверьте настройки Telegram.':'Sync unavailable. Check Telegram settings.'))).catch(e=>new Notice(String(e))).finally(()=>{sync.disabled=false;});
        });
        button('settings-2',ru?'Настройки плагина':'Plugin settings',()=>{
            const app=plugin.app as typeof plugin.app & {setting?:{open():void;openTabById(id:string):void}};
            app.setting?.open();app.setting?.openTabById(plugin.manifest.id);
        });
        const nav=navigation.createEl('nav',{cls:'ht-workspace-tabs',attr:{'aria-label':ru?'Разделы плагина':'Plugin sections'}});
        for(const section of WORKSPACE_SECTIONS){
            const active=section.type===view.getViewType();
            const tab=nav.createEl('button',{cls:'ht-workspace-tab'+(active?' is-active':''),attr:{'aria-current':active?'page':'false',title:ru?section.label:section.en,'aria-label':ru?section.label:section.en}});
            setIcon(tab.createSpan(),section.icon);tab.createSpan({text:ru?section.label:section.en});
            tab.onclick=()=>{if(!active)void view.leaf.setViewState({type:section.type,active:true}).catch(e=>new Notice(String(e)));};
        }
        // Navigation must remain available even when a section fails to initialize.
        try { await open(); }
        catch(error) {
            console.error('Focus Library section initialization failed',view.getViewType(),error);
            const content=view.containerEl.children[1] as HTMLElement;
            const message=content.createDiv({cls:'fl-section-error',attr:{role:'alert'}});
            message.createEl('p',{text:ru?'Не удалось загрузить раздел. Можно вернуться на главный экран через меню.':'Section could not load. Use the menu to return to the Today screen.'});
            message.createEl('small',{text:error instanceof Error?error.message:String(error)});
        }
    };
    lifecycle.onClose=async()=>{
        try { await close(); }
        finally { navigation?.remove();navigation=undefined;view.containerEl.removeClass('ht-workspace-shell'); }
    };
    return view;
}
