const $=s=>document.querySelector(s),dlg=$('#dlg');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nrm=p=>{let d=String(p).replace(/\D/g,'');if(d.startsWith('880'))d='0'+d.slice(3);else if(/^1\d{9}$/.test(d))d='0'+d;return d};
const tel=p=>{const n=nrm(p);return n.startsWith('01')?'+880'+n.slice(1):n};
let tok=localStorage.tok||'',db=JSON.parse(localStorage.db||'{"c":{},"t":null}');
const save=()=>localStorage.db=JSON.stringify(db);
async function api(p,o={}){const h={};if(tok)h.Authorization='Bearer '+tok;
 if(o.body&&!(o.body instanceof FormData)){h['Content-Type']='application/json';o.body=JSON.stringify(o.body)}
 const r=await fetch('/api'+p,{...o,headers:h});
 if(r.status===401&&tok){tok='';localStorage.removeItem('tok');bar();render()}
 if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||r.status);return r}
const dl=async(f)=>{const b=await(await api('/export/'+f)).blob(),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='cse-staff.'+f;a.click()};

function render(){const t=$('#q').value.trim().toLowerCase(),d=nrm(t);
 const a=Object.values(db.c).filter(c=>!t||c.name.toLowerCase().includes(t)||(c.designation||'').toLowerCase().includes(t)||(d.length>2&&c.phone_norm.includes(d))).sort((x,y)=>x.name.localeCompare(y.name));
 $('#list').innerHTML=a.map(c=>`<article class="card"><div><b>${esc(c.name)}</b><p>${esc(c.designation)}</p><p>${esc(c.phone)}</p></div>
 <div class="acts">${tok?`<button data-e="${c.id}">✎</button><button data-d="${c.id}">🗑</button>`:''}<a class="call" href="tel:${tel(c.phone)}">📞 Call</a></div></article>`).join('')||'<p>No contacts found.</p>';
 $('#st').textContent=`${a.length} contacts · Last synced: ${db.t?new Date(db.t).toLocaleString():'never'}${navigator.onLine?'':' · offline (showing saved data)'}`}
async function sync(){const b=$('#sync');b.textContent='Syncing…';
 try{const j=await(await fetch('/api/contacts'+(db.t?'?since='+encodeURIComponent(db.t):''))).json();
  for(const c of j.contacts)c.deleted?delete db.c[c.id]:db.c[c.id]=c;db.t=j.now;save()}   // server wins (last-write-wins by updated_at)
 catch{if(!navigator.onLine)alert('You are offline. Showing last synced data.')}
 b.textContent='⟳ Sync';render()}
function bar(){$('#adm').textContent=tok?'Logout':'Admin';
 $('#bar').innerHTML=tok?'<button id="add">＋ Add</button><button id="imp">Import VCF</button><button id="dash">Dashboard</button><button onclick="dl(\'vcf\')">VCF</button><button onclick="dl(\'csv\')">CSV</button><button onclick="dl(\'xlsx\')">Excel</button>':''}
const open=(h)=>{dlg.innerHTML=h;dlg.showModal()};
function login(){open('<form id="f"><h3>Admin login</h3><label>Username<input name="u" required></label><label>Password<input name="p" type="password" required></label><menu><button value="x" formnovalidate>Cancel</button><button>Login</button></menu></form>');
 $('#f').onsubmit=async e=>{e.preventDefault();if(e.submitter.value==='x')return dlg.close();const f=new FormData(e.target);
  try{tok=(await(await api('/login',{method:'POST',body:{username:f.get('u'),password:f.get('p')}})).json()).token;localStorage.tok=tok;dlg.close();bar();render()}catch(x){alert(x.message)}}}
function form(c={}){open(`<form id="f"><h3>${c.id?'Edit':'Add'} staff</h3>${['name','designation','phone','email','photo_url','department'].map(k=>`<label>${k.replace('_',' ')}<input name="${k}" value="${esc(c[k]??(k=='department'?'CSE':''))}" ${k=='name'||k=='phone'?'required':''}></label>`).join('')}<menu><button value="x" formnovalidate>Cancel</button><button>Save</button></menu></form>`);
 $('#f').onsubmit=async e=>{e.preventDefault();if(e.submitter.value==='x')return dlg.close();
  try{await api('/contacts'+(c.id?'/'+c.id:''),{method:c.id?'PUT':'POST',body:Object.fromEntries(new FormData(e.target))});dlg.close();await sync()}catch(x){alert(x.message)}}}
function importVcf(){const i=document.createElement('input');i.type='file';i.accept='.vcf,text/vcard';
 i.onchange=async()=>{const fd=new FormData();fd.append('file',i.files[0]);let items;
  try{items=(await(await api('/import/preview',{method:'POST',body:fd})).json()).items}catch(x){return alert(x.message)}
  open(`<form id="f"><h3>Review ${items.length} contacts</h3>${items.map((c,k)=>`<div class="row"><b>${esc(c.name)}</b> · ${esc(c.phone)} ${c.valid?'':'<span class="dup">(invalid – skipped)</span>'}
  ${c.dup?`<br><span class="dup">Duplicate (${c.dup.kind}) of “${esc(c.dup.name)}”</span>`:''}
  <select name="a${k}">${c.dup?'<option value="skip">Skip duplicate</option><option value="update">Update existing</option><option value="create">Create anyway</option>':'<option value="create">Import</option><option value="skip">Skip</option>'}</select></div>`).join('')}<menu><button value="x" formnovalidate>Cancel</button><button>Import</button></menu></form>`);
  $('#f').onsubmit=async e=>{e.preventDefault();if(e.submitter.value==='x')return dlg.close();const f=new FormData(e.target);
   const body={items:items.map((c,k)=>({...c,action:c.valid?f.get('a'+k):'skip',matchId:c.dup?.id}))};
   try{const r=await(await api('/import/commit',{method:'POST',body})).json();dlg.close();alert(`Created ${r.created}, updated ${r.updated}, skipped ${r.skipped}`);sync()}catch(x){alert(x.message)}}};i.click()}
async function dash(){try{const s=await(await api('/admin/stats')).json(),D=x=>x?new Date(x).toLocaleString():'—';
 open(`<h3>Dashboard</h3><p>Total contacts: <b>${s.total}</b> · Duplicate phone groups: <b>${s.duplicates}</b><br>Last update: ${D(s.last)}</p><h4>Recently updated</h4>${s.recent.map(r=>`<div class="row">${esc(r.name)} <small>${D(r.updated_at)}</small></div>`).join('')}
 <h4>Audit log</h4>${s.audit.map(a=>`<div class="row"><b>${a.action}</b> ${esc(a.detail?.name||(a.action=='IMPORT'?JSON.stringify(a.detail):'#'+a.contact_id))} <small>${D(a.at)}</small></div>`).join('')}<menu><button onclick="dlg.close()">Close</button></menu>`)}catch(x){alert(x.message)}}

$('#q').oninput=render;$('#sync').onclick=sync;
$('#th').onclick=()=>{const d=document.documentElement,n=d.dataset.theme==='dark'?'light':'dark';d.dataset.theme=n;localStorage.theme=n};
$('#adm').onclick=()=>{if(tok){tok='';localStorage.removeItem('tok');bar();render()}else login()};
$('#bar').onclick=e=>{const i=e.target.id;if(i==='add')form();if(i==='imp')importVcf();if(i==='dash')dash()};
$('#list').onclick=async e=>{const b=e.target.dataset;if(b.e)form(db.c[b.e]);
 if(b.d&&confirm('Delete '+db.c[b.d].name+'?')){try{await api('/contacts/'+b.d,{method:'DELETE'});sync()}catch(x){alert(x.message)}}};
document.documentElement.dataset.theme=localStorage.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
addEventListener('online',sync);bar();render();sync();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');
