/* global loadDailyTasks */

import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const bundle=await build({entryPoints:['src/webapp.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {webAppHtml}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
try { for(const width of [360,1100]) {
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(8000);
 let tasks=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/app')return route.fulfill({contentType:'text/html',body:webAppHtml()});
  if(url.pathname==='/app/api/state')return route.fulfill({json:{date:'2026-09-07',habits:[],goals:[],tasks:[],current:[],library:[],collections:[],timer:null}});
  if(url.pathname==='/app/api/tasks'){
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();tasks=[...tasks.filter(t=>t.id!==body.task.id),{...body.task,revision:body.task.revision+1}];return route.fulfill({json:{ok:true}});}
   return route.fulfill({json:{tasks}});
  }
  return route.abort();
 });
 await page.goto('https://test.local/app');await page.locator('.nav [data-tab=tasks]').click();
 await page.getByRole('button',{name:'Добавить задание',exact:true}).click();
 await page.getByLabel('Название',{exact:true}).fill('Подготовить документы');
 await page.getByLabel('Плановая дата',{exact:true}).fill('2026-09-07');
 await page.getByLabel('Время начала',{exact:true}).fill('13:00');
 await page.getByLabel('Время окончания',{exact:true}).fill('14:15');
 await page.getByLabel('Переносить, если не выполнено',{exact:true}).uncheck();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('button',{name:'Подготовить документы',exact:true}).waitFor();
 await page.getByText('2026-09-07 · 13:00–14:15',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Подготовить документы',exact:true}).click();
 if(await page.getByLabel('Переносить, если не выполнено',{exact:true}).isChecked())throw new Error('Carry-over toggle was not saved');
 if(errors.length)throw new Error(errors.join('\n'));
 await page.getByLabel('Повторение',{exact:true}).selectOption('monthly');
 await page.getByLabel('Число месяца',{exact:true}).fill('31');
 await page.screenshot({path:`artifacts/task-editor-${width}.png`});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByLabel('Представление',{exact:true}).selectOption('kanban');
 await page.screenshot({path:`artifacts/task-kanban-${width}.png`});
 await page.getByLabel('Представление',{exact:true}).selectOption('calendar');
 await page.getByLabel('Месяц',{exact:true}).fill('2026-09');
 await page.screenshot({path:`artifacts/task-calendar-${width}.png`});
 await page.getByLabel('Представление',{exact:true}).selectOption('list');
 await page.screenshot({path:`artifacts/daily-tasks-${width}.png`});
 await page.getByRole('checkbox',{name:'Выполнено',exact:true}).check();
 await page.getByLabel('Период').selectOption('done');
 await page.getByRole('button',{name:'Подготовить документы',exact:true}).click();
 await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.locator('#daily-delete').click();
 await page.getByText('Нет заданий',{exact:true}).waitFor();
 tasks=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Пятничное занятие',date:'',noteDate:'2026-09-08',deadline:'',done:false,deleted:false,subtasks:[],revision:1,repeat:{kind:'weekdays',weekdays:[5]},startTime:'10:30',endTime:'11:50'}];
 await page.evaluate(()=>loadDailyTasks());
 await page.getByLabel('Представление',{exact:true}).selectOption('calendar');
 await page.getByLabel('Месяц',{exact:true}).fill('2026-09');
 if(await page.locator('.task-month-day[data-count="1"]').count()!==3)throw new Error('Missing future Fridays');
 await page.locator('.task-month-day[data-date="2026-09-11"]').click();
 await page.getByRole('button',{name:'Пятничное занятие',exact:true}).click();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const grid=await page.locator('.task-month-grid').boundingBox();
 if(grid.height>370||grid.width>width)throw new Error('Calendar is not compact');
 if(await page.locator('.task-month-day').count()!==30)throw new Error('Missing September dates');
 await page.screenshot({path:`artifacts/task-fridays-${width}.png`});
 await page.getByLabel('Месяц',{exact:true}).fill('2026-10');
 if(await page.locator('.task-month-day[data-count="1"]').count()!==5)throw new Error('Missing October Fridays');
 await page.locator('.task-month-day[data-date="2026-10-02"]').click();
 await page.getByRole('button',{name:'Пятничное занятие',exact:true}).waitFor();
 await page.locator('.task-month-day[data-date="2026-10-03"]').click();
 await page.getByText('Нет заданий на этот день',{exact:true}).waitFor();
 tasks.push({id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',name:'Завершенное занятие',date:'2026-10-01',done:true,deleted:false,subtasks:[],history:[{id:'done-one',date:'2026-10-02',plannedDate:'2026-10-01',name:'Завершенное занятие'}]});
 tasks[0].history=[{id:'done-repeat',date:'2026-10-02',plannedDate:'2026-10-02',name:'Пятничное занятие'}];
 await page.evaluate(()=>loadDailyTasks());
 const doneDay=page.locator('.task-month-day[data-date="2026-10-02"]');
 if(await doneDay.getAttribute('data-done')!=='2')throw new Error('Missing completed counts');
 if(await doneDay.getAttribute('data-count')!=='0')throw new Error('Completed recurrence counted as pending');
 await doneDay.click();
 if(await page.locator('.task-completed-row').count()!==2)throw new Error('Missing completed agenda');
 await page.screenshot({path:`artifacts/task-completed-${width}.png`});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Overflow');
 if(errors.length)throw new Error(errors.join('\n'));await page.close();
 } console.log('Tasks create/complete/delete passed at 360px and 1100px');
}finally{await browser.close();}
