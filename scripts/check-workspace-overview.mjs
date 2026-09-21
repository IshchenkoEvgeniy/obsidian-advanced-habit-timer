import {build} from 'esbuild';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const icons=require('../cloudflare-companion/node_modules/lucide-static');
const iconMap=Object.fromEntries(['layers','refresh-cw','settings-2','house','timer','list-checks','columns-3','library','chart-no-axes-combined','layout-dashboard','play','circle-play','repeat-2','arrow-up-right','book-open'].map(n=>[n,icons[n.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('')]]));
const mocks={obsidian:`export class Notice {} export class ItemView{constructor(leaf){this.leaf=leaf;this.app=leaf.app;this.containerEl=leaf.root;this.contentEl=leaf.root.children[1]}registerEvent(){}async onClose(){}} export const moment=()=>({format:f=>f==='YYYY-MM-DD'?'2026-09-07':'7 сентября 2026'}); export function setIcon(el,n){el.innerHTML=(${JSON.stringify(iconMap)})[n]||'';}`,
 'svelte/store':'export const get=x=>x;', './utils':`export const formatDuration=v=>Math.floor(v/3600).toString().padStart(2,'0')+':'+Math.floor(v%3600/60).toString().padStart(2,'0')+':00';`, './services/habit-service':'export const getHabitValueFromFrontmatter=(fm,h)=>fm[h.name]||0;export const getHabitWeeklyValue=()=>0;export const getHabitDeferredBonus=()=>0;', './habits/goals':'export const getHabitGoals=h=>({desired:h.goal});','./utils/status':'export const isDone=s=>s===\'Done\';'};
const bundle=await build({stdin:{contents:"export * from './src/workspace-overview';export * from './src/workspace-navigation';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'UI',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
const css=await readFile('styles.css','utf8');await mkdir('artifacts',{recursive:true});const browser=await chromium.launch({headless:true});
try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<style>*{box-sizing:border-box}:root{--background-primary:#202221;--background-secondary:#191b1a;--background-modifier-border:#353936;--text-normal:#eef0ee;--text-muted:#a1aaa5;--text-accent:#77c9ac;--interactive-accent:#46ad96;--background-modifier-hover:#303632}body{margin:0;color:var(--text-normal);background:var(--background-primary);font:14px Arial}button{color:inherit;border:0;border-radius:5px;padding:10px;cursor:pointer;background:#35423b}.mod-cta{background:#357b65}#root{height:100vh}${css}</style><div id="root"><div class="view-header"></div><div class="view-content"></div></div>`);
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(async()=>{
  HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.addClass=function(c){this.classList.add(c)};HTMLElement.prototype.removeClass=function(c){this.classList.remove(c)};
  HTMLElement.prototype.createEl=function(tag,o={}){const e=document.createElement(tag);if(o.cls)e.className=o.cls;if(o.text)e.textContent=o.text;if(o.type)e.type=o.type;for(const[k,v]of Object.entries(o.attr||{}))e.setAttribute(k,v);this.append(e);return e};HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o)};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o)};
  window.actions=[];const root=document.getElementById('root'),app={metadataCache:{on(){},getFileCache:()=>({frontmatter:{Чтение:600,Английский:1200}})}};
  const leaf={root,app,setViewState:async({type})=>window.actions.push(type)};
  const plugin={app,settings:{language:'ru',properties:[{name:'Чтение',type:'timer',goal:900},{name:'Английский',type:'timer',goal:3600},{name:'Программирование',type:'timer',goal:7200}],projectScopes:[],mediaCollections:[{id:'Books',readingStatusName:'Чтение'}]},tasks:{list:async()=>[{id:'1',name:'Подготовить материалы для проекта',date:'2026-09-07',done:false}],save:async()=>window.actions.push('saved')},getDailyNote:()=>({}),projectEngine:{},stateManager:{mediaItems:[{title:'Четыре тысячи недель',collectionId:'Books',status:'Чтение',authors:['Оливер Беркман'],cover:'',file:{path:'Book.md'}}]},startTimerForHabit:async()=>{window.actions.push('habit');return true},startTimerForMedia:async()=>{window.actions.push('media');return true},companion:{sync:async()=>true}};
  const view=UI.withWorkspaceNavigation(new UI.WorkspaceOverview(leaf,plugin),plugin);await view.onOpen();
 });
 await page.screenshot({path:`artifacts/focus-overview-${width}.png`});
 await page.getByRole('button',{name:'Продолжить: Четыре тысячи недель',exact:true}).click();
 if(!await page.evaluate(()=>window.actions.includes('media')&&window.actions.includes('habit-timer-view')))throw new Error('Media timer action failed');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Overflow');
 if(errors.length)throw new Error(errors.join('\n'));await page.close();
}console.log('Overview rendering and media timer actions passed at 390/1280px');}finally{await browser.close()}
