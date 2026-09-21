import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
await mkdir('artifacts',{recursive:true});const browser=await chromium.launch({headless:true});
try{for(const width of [360,1100]){
 const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
 const session={id:'session-one',started_at:Date.parse('2026-09-06T09:00:00Z'),ended_at:Date.parse('2026-09-06T09:35:00Z'),duration_sec:1800,habit_name:'Habit-Read',status:'completed',legacy:0,session_date:'2026-09-06',data:{media:{id:1,title:'Четыре тысячи недель',unit:'pages',total:273},note:'Разобрал следующую главу'},result:null};
 await page.route('**/app/api/sessions?**',r=>r.fulfill({json:{items:[session],totals:{count:1,seconds:1800},timezone:'Europe/Kyiv',nextOffset:null}}));
 await page.route('**/app/api/progress',async r=>{const body=r.request().postDataJSON();if(body.sessionId!==session.id)throw new Error('Session ID missing');session.result={delta:body.value,progress:62,total:273,unit:'pages',note:body.note};await r.fulfill({json:{ok:true}})});
 await page.goto('http://127.0.0.1:8793/app');await page.locator('.nav [data-tab=timer]').click();await page.getByRole('button',{name:'История',exact:true}).click();
 await page.locator('.session-row').click();await page.getByRole('button',{name:'Указать результат',exact:true}).click();await page.getByLabel('Количество: страниц',{exact:true}).fill('10');await page.getByLabel('Комментарий',{exact:true}).fill('Главные идеи выписаны');await page.getByRole('button',{name:'Сохранить результат',exact:true}).click();
 await page.getByRole('dialog').getByText('+10 страниц · 62/273',{exact:true}).waitFor();await page.screenshot({path:`artifacts/session-detail-${width}.png`});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.screenshot({path:`artifacts/session-history-${width}.png`});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Overflow');if(errors.length)throw new Error(errors.join('\n'));await page.close();
}console.log('Session history, details and linked results passed at 360px and 1100px.');}finally{await browser.close()}
