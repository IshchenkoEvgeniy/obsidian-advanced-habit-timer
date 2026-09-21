export const creationStyle = `
.header-actions{display:flex;gap:8px}.title-row h1{flex:1;min-width:0}.create-toolbar{display:flex;justify-content:flex-end;margin-bottom:18px}
.entry-form{display:grid;gap:16px;margin-top:22px}.entry-form label{display:grid;gap:7px;font-size:13px;min-width:0}
.entry-form input,.entry-form textarea,.entry-form select{width:100%;min-width:0;padding:12px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font:inherit;font-size:16px}
.entry-form textarea{resize:vertical;min-height:140px}.entry-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.entry-form details summary{cursor:pointer;color:var(--accent);padding:8px 0}.entry-form details>div{display:grid;gap:16px;margin-top:12px}
.entry-error{color:var(--coral);font-size:13px;overflow-wrap:anywhere}.entry-error:empty{display:none}
.suggestions{display:flex;gap:6px;flex-wrap:wrap}.suggestions button{background:transparent;border:1px solid var(--line);color:var(--accent);border-radius:5px;padding:6px 9px;max-width:100%;overflow-wrap:anywhere;font-size:12px}
.entry-recent{border-top:1px solid var(--line);padding:13px 0;overflow-wrap:anywhere}.entry-recent small{display:block;color:var(--muted);margin-top:5px}.entry-success{padding:20px 0;color:var(--accent)}
@media(max-width:360px){.entry-pair{grid-template-columns:1fr}}
`;

export const creationScript = String.raw`
let entryOptions=null,entryBusy=false,entryKind='',entryRequest='',entryDrafts={};
const entryLabels={thought:'Мысль',link:'Ссылка',idea:'Идея',task:'Задача',quote:'Цитата'};
async function optionsForCreate(){entryOptions=await api('create-options');return entryOptions}
async function creationMenu(){
  modal('<h3>Добавить</h3><div class="choices"><button class="primary" onclick="openEntry(\'capture\')">'+icons.capture+'Быстрый захват</button><button class="secondary" onclick="openEntry(\'media\')">'+icons.book+'Произведение</button></div><div id="entry-history" class="section"></div>');
  try{const o=await optionsForCreate(),el=document.getElementById('entry-history');if(el)el.innerHTML='<h3>Последние записи</h3>'+(o.recent.length?o.recent.map(r=>'<div class="entry-recent">'+E(r.title)+'<small>'+E(r.type==='capture'?entryLabels[r.category]||'Захват':'Произведение')+' · '+E(r.date)+' · '+(r.synced?'Сохранено в Obsidian':'Ожидает синхронизации')+'</small></div>').join(''):empty('Пока нет записей'))}catch(e){alertError(e)}
}
function entryField(name,label,type='text',extra=''){return '<label>'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>'}
function entrySelect(name,label,values){return '<label>'+label+'<select aria-label="'+E(label)+'" name="'+name+'">'+values.map(v=>'<option value="'+E(v[0])+'">'+E(v[1])+'</option>').join('')+'</select></label>'}
async function openEntry(kind){
  try{await optionsForCreate()}catch(e){alertError(e);return}
  entryKind=kind;entryBusy=false;entryRequest=entryDrafts[kind]?.requestId||crypto.randomUUID();
  let fields='';
  if(kind==='capture') fields=entrySelect('category','Категория',Object.entries(entryLabels))+'<label>Текст<textarea name="text" maxlength="10000" rows="5"></textarea></label>'+entryField('url','Ссылка','url','maxlength="2000"');
  else fields=entrySelect('collectionId','Коллекция',entryOptions.collections.map(c=>[c,labelCollection(c)]))+entryField('title','Название','text','required maxlength="250"')+entryField('authors','Авторы','text','maxlength="1500" autocomplete="off" oninput="entrySuggestions(this,\'authors\')"')+'<div id="suggest-authors" class="suggestions"></div>'+entryField('genres','Жанры','text','maxlength="1500" autocomplete="off" oninput="entrySuggestions(this,\'genres\')"')+'<div id="suggest-genres" class="suggestions"></div><div class="entry-pair">'+entryField('total','Общий объём','number','min="0" step="any"')+entrySelect('unit','Единица', ['pages','lessons','chapters','episodes','minutes','hours','items','units'].map(u=>[u,unit(u)]))+'</div><details><summary>Серия, формат и обложка</summary><div>'+entryField('series','Серия','text','list="entry-series" maxlength="150"')+'<datalist id="entry-series">'+entryOptions.series.map(s=>'<option value="'+E(s)+'">').join('')+'</datalist>'+entryField('seriesIndex','Номер части','number','min="0" step="any" placeholder="Следующий автоматически"')+entryField('format','Формат','text','list="entry-formats" maxlength="100"')+'<datalist id="entry-formats"><option value="Paper"><option value="E-book"><option value="Audiobook"></datalist>'+entryField('status','Статус','text','list="entry-statuses" maxlength="100"')+'<datalist id="entry-statuses"><option value="В планах"><option value="На паузе"><option value="Чтение"><option value="Изучаю"><option value="Смотрю"></datalist>'+entryField('coverUrl','Ссылка на обложку','url','maxlength="2000"')+'</div></details>';
  modal('<h3>'+(kind==='capture'?'Быстрый захват':'Новое произведение')+'</h3><form id="entry-form" class="entry-form" onsubmit="event.preventDefault();submitEntry(this)" oninput="rememberEntry(this)">'+fields+'<div id="entry-error" class="entry-error" role="alert"></div><div id="entry-duplicate"></div><button type="submit" class="primary">'+icons.check+'Сохранить</button></form>');
  const form=document.getElementById('entry-form');
  if(kind==='media'){form.elements.status.value='В планах';form.elements.collectionId.value=filters.collection||'book';updateEntryUnit(form);form.elements.collectionId.addEventListener('change',()=>{updateEntryUnit(form);rememberEntry(form)});form.elements.format.addEventListener('change',()=>{if(/audio|аудио/i.test(form.elements.format.value))form.elements.unit.value='minutes';rememberEntry(form)})}
  const saved=entryDrafts[kind];if(saved)for(const [name,value] of Object.entries(saved))if(form.elements.namedItem(name))form.elements.namedItem(name).value=value;
  form.elements[kind==='capture'?'text':'title'].focus();
}
function updateEntryUnit(form){form.elements.unit.value=({book:'pages',course:'lessons',manga:'chapters',film:'minutes',anime:'episodes',series:'episodes',game:'hours'})[form.elements.collectionId.value]||'units'}
function rememberEntry(form){entryDrafts[entryKind]={...Object.fromEntries(new FormData(form)),requestId:entryRequest}}
function entrySuggestions(input,kind){const query=input.value.split(',').at(-1).trim().toLowerCase();const selected=input.value.split(',').map(s=>s.trim().toLowerCase());const values=entryOptions[kind].filter(v=>v.toLowerCase().includes(query)&&!selected.includes(v.toLowerCase())).slice(0,8);document.getElementById('suggest-'+kind).innerHTML=values.map(v=>'<button type="button" data-kind="'+kind+'" data-value="'+E(v)+'" onclick="chooseEntrySuggestion(this)">'+E(v)+'</button>').join('')}
function chooseEntrySuggestion(button){const form=document.getElementById('entry-form'),input=form.elements[button.dataset.kind],parts=input.value.split(',');parts.pop();parts.push(button.dataset.value);input.value=parts.map(v=>v.trim()).filter(Boolean).join(', ')+', ';rememberEntry(form);entrySuggestions(input,button.dataset.kind);input.focus()}
async function submitEntry(form,allowDuplicate=false){
  if(entryBusy||!form.reportValidity())return;
  rememberEntry(form);entryBusy=true;form.querySelector('button[type="submit"]').disabled=true;
  document.getElementById('entry-error').textContent='';
  const payload={...entryDrafts[entryKind],allowDuplicate};
  try{
    await api(entryKind==='capture'?'capture':'media-create',{method:'POST',body:JSON.stringify(payload)});
    delete entryDrafts[entryKind];entryBusy=false;
    modal('<div class="entry-success">'+icons.check+' Сохранено</div><h3>'+(entryKind==='capture'?'Запись в дневную заметку':'Произведение добавлено в очередь')+'</h3><p class="row-sub">Ожидает синхронизации с Obsidian.</p><div class="choices"><button class="primary" data-kind="'+entryKind+'" onclick="openEntry(this.dataset.kind)">'+icons.plus+'Добавить ещё</button><button class="secondary" onclick="creationMenu()">Последние записи</button></div>');
  }catch(e){
    const errors={empty_capture:'Введите текст или ссылку.',invalid_url:'Укажите полную ссылку https://…',invalid_media:'Укажите название и коллекцию.',invalid_amount:'Проверьте объём и номер части.',unauthorized:'Переоткройте приложение из Telegram.'};
    document.getElementById('entry-error').textContent=errors[e.message]||(e.message==='duplicate'?'Похожее произведение уже есть в библиотеке или очереди.':'Не удалось сохранить. Повторите отправку.');
    if(e.message==='duplicate')document.getElementById('entry-duplicate').innerHTML='<button type="button" class="secondary" onclick="submitEntry(document.getElementById(\'entry-form\'),true)">Создать ещё один экземпляр</button>';
    entryBusy=false;form.querySelector('button[type="submit"]').disabled=false;
  }
}
`;
