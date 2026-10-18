const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),helmet=require('helmet'),rl=require('express-rate-limit'),multer=require('multer'),XLSX=require('xlsx'),fs=require('fs');
const {DATABASE_URL,JWT_SECRET,ADMIN_USER='admin',ADMIN_PASS,PORT=3000}=process.env;
if(!JWT_SECRET||!DATABASE_URL)throw Error('Set DATABASE_URL and JWT_SECRET');
const pool=new Pool({connectionString:DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(DATABASE_URL)?false:{rejectUnauthorized:false}});
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:5e6}});
const app=express();app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}),express.json({limit:'2mb'}),rl({windowMs:6e4,limit:120}));
const bad=(m,s=400)=>Object.assign(Error(m),{status:s});
const clean=s=>String(s??'').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,200);
const norm=p=>{let d=String(p||'').replace(/\D/g,'');if(d.startsWith('880'))d='0'+d.slice(3);else if(/^1\d{9}$/.test(d))d='0'+d;return d};
function row(b){const r={name:clean(b.name),designation:clean(b.designation),phone:clean(b.phone),email:clean(b.email).toLowerCase(),
 department:clean(b.department)||'CSE',photo_url:/^https?:\/\//.test(b.photo_url||'')?clean(b.photo_url):''};
 r.phone_norm=norm(r.phone);
 if(!r.name||r.phone_norm.length<10||r.phone_norm.length>13)throw bad('Valid name and phone required');
 if(r.email&&!/^\S+@\S+\.\S+$/.test(r.email))throw bad('Invalid email');return r}
const auth=(q,s,n)=>{try{jwt.verify((q.headers.authorization||'').slice(7),JWT_SECRET);n()}catch{s.status(401).json({error:'Unauthorized'})}};
const wrap=f=>(q,s)=>f(q,s).catch(e=>e.status?s.status(e.status).json({error:e.message}):(console.error(e),s.status(500).json({error:'Server error'})));
const log=(a,id,d,c=pool)=>c.query('INSERT INTO audit_log(action,contact_id,detail) VALUES($1,$2,$3)',[a,id,d]);
const COLS='id,name,designation,phone,phone_norm,email,department,photo_url,deleted,updated_at';
const INS='INSERT INTO contacts(name,designation,phone,phone_norm,email,department,photo_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id';
const vals=r=>[r.name,r.designation,r.phone,r.phone_norm,r.email,r.department,r.photo_url];

// ---- public: incremental sync (?since=ISO returns changes incl. deletions)
app.get('/api/contacts',wrap(async(q,s)=>{
 const since=q.query.since&&!isNaN(Date.parse(q.query.since))?q.query.since:null,now=new Date(Date.now()-5000).toISOString();
 const {rows}=await pool.query(`SELECT ${COLS} FROM contacts WHERE ($1::timestamptz IS NULL AND NOT deleted) OR updated_at>$1::timestamptz ORDER BY name`,[since]);
 s.json({now,contacts:rows})}));
app.post('/api/login',rl({windowMs:9e5,limit:10}),wrap(async(q,s)=>{
 const {rows}=await pool.query('SELECT * FROM admin WHERE username=$1',[clean(q.body.username)]);
 if(!rows[0]||!await bcrypt.compare(String(q.body.password||''),rows[0].password_hash))throw bad('Invalid credentials',401);
 s.json({token:jwt.sign({u:rows[0].username},JWT_SECRET,{expiresIn:'8h'})})}));

// ---- admin CRUD
app.post('/api/contacts',auth,wrap(async(q,s)=>{const r=row(q.body),{rows}=await pool.query(INS,vals(r));await log('ADD',rows[0].id,r);s.json({id:rows[0].id})}));
app.put('/api/contacts/:id',auth,wrap(async(q,s)=>{const r=row(q.body);
 await pool.query('UPDATE contacts SET name=$1,designation=$2,phone=$3,phone_norm=$4,email=$5,department=$6,photo_url=$7,updated_at=now() WHERE id=$8',[...vals(r),+q.params.id]);
 await log('UPDATE',+q.params.id,r);s.json({ok:1})}));
app.delete('/api/contacts/:id',auth,wrap(async(q,s)=>{
 await pool.query('UPDATE contacts SET deleted=true,updated_at=now() WHERE id=$1',[+q.params.id]);await log('DELETE',+q.params.id,{});s.json({ok:1})}));

// ---- VCF import: parse + duplicate detection, then commit with per-record decisions
function parseVcf(t){return t.replace(/\r?\n[ \t]/g,'').split(/BEGIN:VCARD/i).slice(1).map(b=>{
 const g=k=>{const m=b.match(new RegExp('^'+k+'(;[^:\\n]*)?:(.*)$','im'));return m?m[2].trim():''};
 const name=g('FN')||g('N').split(';').filter(Boolean).reverse().join(' ').trim();
 return{name,phone:g('TEL'),email:g('EMAIL'),designation:g('TITLE')}}).filter(c=>c.name||c.phone)}
app.post('/api/import/preview',auth,up.single('file'),wrap(async(q,s)=>{
 if(!q.file)throw bad('No file');
 const {rows}=await pool.query('SELECT id,name,phone_norm FROM contacts WHERE NOT deleted'),byP=new Map(rows.map(r=>[r.phone_norm,r])),seen=new Map();
 const items=parseVcf(q.file.buffer.toString('utf8')).map(c=>{
  const n=norm(c.phone),m=byP.get(n)||seen.get(n);if(n)seen.set(n,{id:null,name:c.name,phone_norm:n});
  const dup=m?{id:m.id,name:m.name,kind:m.name.toLowerCase()===c.name.toLowerCase()?'name+phone':'phone'}:null;
  return{...c,valid:n.length>=10&&n.length<=13&&!!c.name,dup}});
 s.json({items})}));
app.post('/api/import/commit',auth,wrap(async(q,s)=>{
 const items=Array.isArray(q.body.items)?q.body.items.slice(0,5000):[],n={created:0,updated:0,skipped:0},c=await pool.connect();
 try{await c.query('BEGIN');
  for(const i of items){if(i.action==='skip'){n.skipped++;continue}
   let r;try{r=row(i)}catch{n.skipped++;continue}
   if(i.action==='update'&&+i.matchId){await c.query("UPDATE contacts SET name=$1,designation=COALESCE(NULLIF($2,''),designation),email=COALESCE(NULLIF($3,''),email),phone=$4,phone_norm=$5,updated_at=now() WHERE id=$6",[r.name,r.designation,r.email,r.phone,r.phone_norm,+i.matchId]);n.updated++}
   else{await c.query(INS,vals(r));n.created++}}
  await log('IMPORT',null,n,c);await c.query('COMMIT')}
 catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 s.json(n)}));

// ---- dashboard, audit, export
app.get('/api/admin/stats',auth,wrap(async(q,s)=>{
 const a=(await pool.query('SELECT count(*)::int total,max(updated_at) last FROM contacts WHERE NOT deleted')).rows[0];
 const d=(await pool.query('SELECT count(*)::int n FROM(SELECT 1 FROM contacts WHERE NOT deleted GROUP BY phone_norm HAVING count(*)>1)x')).rows[0].n;
 const recent=(await pool.query('SELECT name,designation,updated_at FROM contacts WHERE NOT deleted ORDER BY updated_at DESC LIMIT 5')).rows;
 const audit=(await pool.query('SELECT action,contact_id,detail,at FROM audit_log ORDER BY id DESC LIMIT 25')).rows;
 s.json({total:a.total,last:a.last,duplicates:d,recent,audit})}));
app.get('/api/export/:f',auth,wrap(async(q,s)=>{
 const {rows}=await pool.query('SELECT name,designation,phone,email,department,updated_at FROM contacts WHERE NOT deleted ORDER BY name'),f=q.params.f;
 if(f==='csv'){const e=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  s.type('text/csv').send('Name,Designation,Phone,Email,Department\n'+rows.map(r=>[r.name,r.designation,r.phone,r.email,r.department].map(e).join(',')).join('\n'))}
 else if(f==='vcf')s.type('text/vcard').send(rows.map(r=>`BEGIN:VCARD\nVERSION:3.0\nFN:${r.name}\nTITLE:${r.designation}\nORG:${r.department}\nTEL;TYPE=CELL:${r.phone}\n${r.email?'EMAIL:'+r.email+'\n':''}END:VCARD`).join('\n'))
 else if(f==='xlsx'){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Staff');s.type('application/octet-stream').send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))}
 else throw bad('Unknown format',404)}));

app.get('/sw.js',(q,s)=>s.set('Cache-Control','no-cache').sendFile(__dirname+'/public/sw.js'));
app.use(express.static(__dirname+'/public'));
(async()=>{await pool.query(fs.readFileSync(__dirname+'/schema.sql','utf8'));
 if(!(await pool.query('SELECT 1 FROM admin LIMIT 1')).rowCount){if(!ADMIN_PASS)throw Error('Set ADMIN_PASS for first run');
  await pool.query('INSERT INTO admin(username,password_hash) VALUES($1,$2)',[ADMIN_USER,await bcrypt.hash(ADMIN_PASS,12)]);console.log('Admin created')}
 app.listen(PORT,()=>console.log('Listening on',PORT))})();
