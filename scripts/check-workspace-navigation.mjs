import {build} from 'esbuild';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const icons=require('../cloudflare-companion/node_modules/lucide-static');
const iconMap=Object.fromEntries(['layers','refresh-cw','settings-2','house','timer','list-checks','columns-3','library','chart-no-axes-combined','layout-dashboard'].map(name=>[name,icons[name.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('')]]));
const result=await build({entryPoints:['src/workspace-navigation.ts'],bundle:true,write:false,format:'iife',globalName:'WorkspaceNav',plugins:[{name:'obsidian-fixture',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export class Notice {} export function setIcon(el,name){el.innerHTML=(${JSON.stringify(iconMap)})[name]||'';}`}));}}]});
const css=await readFile('styles.css','utf8');await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
try{for(const width of [360,1200]){
 const page=await browser.newPage({viewport:{width,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<style>:root{--background-primary:#202020;--background-modifier-border:#393939;--text-normal:#eee;--text-muted:#aaa;--interactive-accent:#8b5cf6;--text-accent:#bda1ff;--background-modifier-hover:#303030}body{margin:0;background:#202020;color:#eee;font:14px Arial}button{color:inherit;cursor:pointer}#root{height:100vh}.view-content{padding:24px;overflow:auto}${css}</style><div id="root"><div class="view-header"></div><div class="view-content"></div></div>`);
 await page.addScriptTag({content:result.outputFiles[0].text});
 await page.evaluate(async()=>{
  HTMLElement.prototype.addClass=function(c){this.classList.add(c)};HTMLElement.prototype.removeClass=function(c){this.classList.remove(c)};
  HTMLElement.prototype.createEl=function(tag,o={}){const e=document.createElement(tag);if(o.cls)e.className=o.cls;if(o.text)e.textContent=o.text;for(const[k,v]of Object.entries(o.attr||{}))e.setAttribute(k,v);this.append(e);return e};
  HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o)};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o)};
  const root=document.getElementById('root');window.transitions=[];window.settingsOpened=false;
  const plugin={settings:{language:'ru'},companion:{sync:async()=>true},app:{setting:{open(){window.settingsOpened=true},openTabById(){}}},manifest:{id:'test'}};
  let current;
  const leaf={async setViewState({type}){window.transitions.push(type);if(current)await current.onClose();current=WorkspaceNav.withWorkspaceNavigation({leaf,containerEl:root,getViewType:()=>type,async onOpen(){root.children[1].innerHTML='<h2>'+WorkspaceNav.WORKSPACE_SECTIONS.find(s=>s.type===type).label+'</h2>';if(window.failTimer&&type==='habit-timer-view')throw new Error('Timer initialization test failure')},async onClose(){}},plugin);await current.onOpen()}};
  await leaf.setViewState({type:'habit-workspace-overview'});
 });
 for(const name of ['Таймер и привычки','Задания','Проекты','Библиотека','Статистика','Виджеты','Обзор']){
  await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();
  if(await page.locator('.ht-workspace-navigation').count()!==1)throw new Error('Duplicate navigation');
 }
 await page.getByRole('button',{name:'Настройки плагина',exact:true}).click();
 await page.evaluate(()=>window.failTimer=true);
 await page.getByRole('button',{name:'Таймер и привычки',exact:true}).click();
 await page.getByRole('alert').waitFor();
 await page.getByRole('button',{name:'Обзор',exact:true}).click();
 await page.getByRole('heading',{name:'Обзор',exact:true}).waitFor();
 if(!await page.evaluate(()=>window.settingsOpened))throw new Error('Settings not opened');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow');
 await page.screenshot({path:`artifacts/workspace-navigation-${width}.png`});if(errors.length)throw new Error(errors.join('\n'));await page.close();
}console.log('Navigation: seven sections, settings, cleanup, 360px/1200px passed');}finally{await browser.close()}
