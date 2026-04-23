// ============================================================
// ECOSOCH SOLAR QUIZ — MAIN SCRIPT
//
// FLOW:  Name → Level Select → TOPIC SELECT → Quiz → Score
//
// PERSISTENCE:
//  Phase 1  → Embedded bank (1500 Qs) loads INSTANTLY
//  Phase 1b → localStorage extras load INSTANTLY on refresh
//  Phase 2  → Apps Script proxy syncs live sheet (no CDN cache)
//             New Qs saved to localStorage so count persists on refresh
// ============================================================

const APPS_SCRIPT_URL    = 'https://script.google.com/macros/s/AKfycbzrEOxPai4OJOMD_YaOrUD2wV34SuviziFyf_tQbRdllDbm_SjALGv_k8SJ4hEey3t_fQ/exec';
const SPREADSHEET_ID     = '1dTN76objOt1VsYa7ZwafdC5EFCloLzulSmYme9LV70I';
const SHEET_TABS         = { beginner:'Beginner', intermediate:'Intermediate', hard:'Hard' };
const EXTRAS_STORAGE_KEY = 'ecosoch_extra_questions_v1';

const questionBank  = { beginner:[], intermediate:[], hard:[] };
const topicMap      = { beginner:{}, intermediate:{}, hard:{} };
let questionsLoaded = false;
let syncIntervalId  = null;
let isSyncing       = false;
const embeddedCount = { beginner:0, intermediate:0, hard:0 };

// currently selected topic filter (null = All Topics)
let currentTopicFilter = null;

// ============================================================
// INJECT TOPIC-SELECT SCREEN
// No changes needed to your HTML file — this builds the screen in JS.
// ============================================================
function injectTopicSelectUI() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── Topic Modal Overlay ── */
    #topic-modal-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 8000;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      align-items: center; justify-content: center;
      padding: 16px;
    }
    #topic-modal-overlay.open { display: flex; }

    #topic-modal {
      background: #1a1d27;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 20px;
      width: 100%; max-width: 640px;
      max-height: 82vh;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,.5);
      animation: modalPop .25s cubic-bezier(.34,1.56,.64,1);
    }
    @keyframes modalPop {
      from { transform: scale(.92) translateY(16px); opacity:0; }
      to   { transform: scale(1) translateY(0); opacity:1; }
    }

    .tm-head {
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
    }
    .tm-back {
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.14);
      color: #fff; border-radius: 8px;
      padding: 6px 14px; font-size: .85rem;
      cursor: pointer; transition: background .18s;
      white-space: nowrap;
    }
    .tm-back:hover { background: rgba(255,255,255,.16); }
    .tm-title {
      font-size: 1.1rem; font-weight: 700;
      color: #fff; flex: 1;
    }
    .tm-badge {
      font-size: .72rem; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase;
      padding: 3px 12px; border-radius: 20px;
      background: rgba(255,193,7,.18); color: #FFC107;
    }

    .tm-search-wrap {
      padding: 12px 20px 10px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      flex-shrink: 0; position: relative;
    }
    .tm-search {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,.07);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 10px; color: #fff;
      padding: 9px 14px 9px 38px;
      font-size: .9rem; outline: none;
      transition: border-color .2s;
    }
    .tm-search::placeholder { color: rgba(255,255,255,.3); }
    .tm-search:focus { border-color: rgba(255,193,7,.5); }
    .tm-search-icon {
      position: absolute; left: 34px; top: 50%;
      transform: translateY(-50%);
      font-size: 1rem; pointer-events: none;
    }

    .tm-body {
      overflow-y: auto; padding: 14px 16px 18px;
      flex: 1;
    }
    .tm-body::-webkit-scrollbar { width: 4px; }
    .tm-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }

    .tm-subtitle {
      font-size: .8rem; color: rgba(255,255,255,.4);
      padding: 0 4px 12px; margin: 0;
    }

    .tm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
      gap: 10px;
    }

    .tm-card {
      background: rgba(255,255,255,.06);
      border: 1.5px solid rgba(255,255,255,.1);
      border-radius: 12px; padding: 14px 14px;
      cursor: pointer;
      transition: transform .15s, background .15s, border-color .15s;
      display: flex; flex-direction: column; gap: 5px;
    }
    .tm-card:hover {
      transform: translateY(-2px);
      background: rgba(255,255,255,.11);
      border-color: rgba(255,193,7,.5);
    }
    .tm-card.tm-all {
      background: linear-gradient(135deg,rgba(255,193,7,.18),rgba(255,152,0,.1));
      border-color: rgba(255,193,7,.35);
      grid-column: 1 / -1;
      flex-direction: row; align-items: center; gap: 14px;
    }
    .tm-card.tm-all:hover { border-color: #FFC107; }
    .tm-icon  { font-size: 1.4rem; }
    .tm-name  { font-size: .88rem; font-weight: 600; color: #fff; line-height: 1.3; }
    .tm-count { font-size: .75rem; color: rgba(255,255,255,.45); }
    .tm-card.tm-all .tm-name  { font-size: .96rem; }
    .tm-card.tm-all .tm-count { font-size: .82rem; }

    .tm-no-results {
      color: rgba(255,255,255,.35); text-align: center;
      padding: 32px 0; font-size: .9rem;
    }

    /* Change Topic button shown inside quiz */
    #change-topic-btn {
      display: none;
      background: rgba(255,193,7,.14);
      border: 1px solid rgba(255,193,7,.35);
      color: #FFC107; border-radius: 8px;
      padding: 5px 13px; font-size: .8rem; font-weight: 600;
      cursor: pointer; transition: background .18s;
      white-space: nowrap;
    }
    #change-topic-btn:hover { background: rgba(255,193,7,.26); }
    #change-topic-btn.visible { display: inline-block; }

    @media(max-width: 480px){
      #topic-modal { max-height: 90vh; border-radius: 16px; }
      .tm-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(style);

  // Modal HTML
  const overlay = document.createElement('div');
  overlay.id = 'topic-modal-overlay';
  overlay.innerHTML = `
    <div id="topic-modal">
      <div class="tm-head">
        <button class="tm-back" id="tm-back-btn" onclick="closeTopicModal()">&#8592; Back</button>
        <div class="tm-title">Choose a Topic</div>
        <span class="tm-badge" id="tm-badge">Beginner</span>
      </div>
      <div class="tm-search-wrap">
        <span class="tm-search-icon">&#128269;</span>
        <input class="tm-search" id="tm-search" type="text"
               placeholder="Search topics&#8230;" oninput="filterTopicCards()" autocomplete="off">
      </div>
      <div class="tm-body">
        <p class="tm-subtitle" id="tm-subtitle"></p>
        <div class="tm-grid" id="ts-grid"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Click backdrop to close
  overlay.addEventListener('click', e => { if(e.target===overlay) closeTopicModal(); });

  // Inject "Change Topic" button into quiz header
  setTimeout(() => {
    const quizHeader = document.querySelector('.quiz-header');
    if (quizHeader) {
      const btn = document.createElement('button');
      btn.id = 'change-topic-btn';
      btn.textContent = '📚 Change Topic';
      btn.onclick = () => showTopicSelect(currentLevel);
      quizHeader.appendChild(btn);
    }
  }, 300);
}


function showTopicSelect(level) {
  if (!questionsLoaded || questionBank[level].length === 0) {
    alert('Questions not loaded yet. Please refresh.'); return;
  }
  // Store level for modal
  document.getElementById('ts-grid').dataset.level = level;

  // Update badge
  const labels = { beginner:'&#127807; Beginner', intermediate:'&#9889; Intermediate', hard:'&#128293; Hard' };
  document.getElementById('tm-badge').innerHTML = labels[level] || capitalize(level);
  document.getElementById('tm-subtitle').textContent =
    `${questionBank[level].length} questions · ${getTopicCount(level)} topics`;

  // Set back button behaviour:
  // If quiz is running → back closes modal (stays on quiz)
  // If no quiz yet → back goes to level select
  const quizActive = document.getElementById('quiz-section').classList.contains('active') ||
                     document.getElementById('score-dashboard').classList.contains('active');
  const backBtn = document.getElementById('tm-back-btn');
  if (quizActive) {
    backBtn.textContent = '✕ Close';
    backBtn.onclick = closeTopicModal;
  } else {
    backBtn.innerHTML = '&#8592; Back';
    backBtn.onclick = () => { closeTopicModal(); showLevelSelect(); };
  }

  // Clear search and render
  document.getElementById('tm-search').value = '';
  renderTopicCards(level, '');

  // Show modal
  document.getElementById('topic-modal-overlay').classList.add('open');
}

function closeTopicModal() {
  document.getElementById('topic-modal-overlay').classList.remove('open');
}


function renderTopicCards(level, filter) {
  const grid   = document.getElementById('ts-grid');
  const topics = getTopics(level);
  const bank   = questionBank[level];
  const search = (filter || '').toLowerCase().trim();
  grid.dataset.level = level;

  const filtered = search ? topics.filter(t => t.toLowerCase().includes(search)) : topics;

  const emojiPool = ['&#9728;&#65039;','&#128267;','&#9889;','&#128268;','&#127970;','&#127758;','&#128161;','&#128295;','&#128202;','&#128736;&#65039;','&#127807;','&#128176;','&#128290;','&#128225;','&#9881;&#65039;','&#128300;','&#127777;&#65039;','&#128200;','&#9878;&#65039;','&#128736;&#65039;'];

  function topicEmoji(name, idx) {
    const n = name.toLowerCase();
    if (n.includes('solar') || n.includes('sun'))               return '&#9728;&#65039;';
    if (n.includes('batter') || n.includes('storage'))          return '&#128267;';
    if (n.includes('invert') || n.includes('power'))            return '&#9889;';
    if (n.includes('grid') || n.includes('connect'))            return '&#128268;';
    if (n.includes('financ') || n.includes('cost') || n.includes('roi')) return '&#128176;';
    if (n.includes('install') || n.includes('mount'))           return '&#128295;';
    if (n.includes('panel') || n.includes('module'))            return '&#127970;';
    if (n.includes('environ') || n.includes('sustain'))         return '&#127758;';
    if (n.includes('calculat') || n.includes('math'))           return '&#128202;';
    if (n.includes('safet') || n.includes('hazard'))            return '&#9888;&#65039;';
    if (n.includes('wire') || n.includes('electric'))           return '&#128268;';
    if (n.includes('monitor') || n.includes('system'))          return '&#128225;';
    return emojiPool[idx % emojiPool.length];
  }

  let html = '';

  if (!search) {
    html += `
      <div class="tm-card tm-all" onclick="startQuizWithTopic('${level}', null)">
        <div class="tm-icon">&#127775;</div>
        <div>
          <div class="tm-name">All Topics — Mixed Quiz</div>
          <div class="tm-count">${bank.length} questions &middot; ${topics.length} topics</div>
        </div>
      </div>`;
  }

  if (filtered.length === 0) {
    html += `<div class="tm-no-results">No topics match "<strong>${filter}</strong>"</div>`;
  } else {
    filtered.forEach((topic, idx) => {
      const count = (topicMap[level][topic] || []).length;
      const icon  = topicEmoji(topic, idx);
      const safe  = topic.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      html += `
        <div class="tm-card" onclick="startQuizWithTopic('${level}', '${safe}')">
          <div class="tm-icon">${icon}</div>
          <div class="tm-name">${topic}</div>
          <div class="tm-count">${count} question${count !== 1 ? 's' : ''}</div>
        </div>`;
    });
  }

  grid.innerHTML = html;
}


function filterTopicCards() {
  const grid  = document.getElementById('ts-grid');
  const level = grid.dataset.level;
  const val   = document.getElementById('ts-search').value;
  renderTopicCards(level, val);
}

// ============================================================
// TOPIC HELPERS
// ============================================================
function normTopic(raw) {
  if (!raw || !raw.toString().trim()) return 'General';
  return raw.toString().trim().replace(/\s+/g,' ').trim();
}

function buildTopicMap(level) {
  const map = {};
  questionBank[level].forEach((q, i) => {
    const t = normTopic(q.topic);
    q.topic = t;
    if (!map[t]) map[t] = [];
    map[t].push(i);
  });
  topicMap[level] = map;
}

function getTopics(level)     { return Object.keys(topicMap[level]).sort(); }
function getTopicCount(level) { return getTopics(level).length; }

function normKey(str) {
  return str.toString().toLowerCase().replace(/[\s.,!?'"()\-:;]/g,'');
}

// ============================================================
// PHASE 1 — EMBEDDED BANK
// ============================================================
function loadEmbeddedBank() {
  const bank = window.QUESTION_BANK;
  if (!bank) { console.error('question_bank_data.js not found'); return false; }
  ['beginner','intermediate','hard'].forEach(level => {
    questionBank[level] = [...(bank[level]||[])];
    embeddedCount[level] = questionBank[level].length;
    buildTopicMap(level);
  });
  questionsLoaded = true;
  console.log(`Embedded — B:${embeddedCount.beginner} | I:${embeddedCount.intermediate} | H:${embeddedCount.hard}`);
  return true;
}

// ============================================================
// PHASE 1b — localStorage CACHE
// ============================================================
function loadCachedExtras() {
  try {
    const raw = localStorage.getItem(EXTRAS_STORAGE_KEY);
    if (!raw) { console.log('No cached extras yet'); return 0; }
    const extras = JSON.parse(raw);
    let total = 0;
    ['beginner','intermediate','hard'].forEach(level => {
      const list = extras[level]||[];
      if (!list.length) return;
      const keys = new Set(questionBank[level].map(q => normKey(q.q)));
      list.forEach(q => {
        if (q && q.q && !keys.has(normKey(q.q))) {
          questionBank[level].push(q); keys.add(normKey(q.q)); total++;
        }
      });
      if (list.length) buildTopicMap(level);
    });
    if (total > 0) console.log(`Loaded ${total} cached extras from localStorage`);
    return total;
  } catch(e) { console.warn('loadCachedExtras error:',e); return 0; }
}

function saveCachedExtras() {
  try {
    const extras = {};
    ['beginner','intermediate','hard'].forEach(level => {
      extras[level] = questionBank[level].slice(embeddedCount[level]);
    });
    localStorage.setItem(EXTRAS_STORAGE_KEY, JSON.stringify(extras));
    const c = Object.values(extras).map(a=>a.length);
    console.log(`Saved extras — B:${c[0]} I:${c[1]} H:${c[2]}`);
  } catch(e) { console.warn('saveCachedExtras error:',e); }
}

// ============================================================
// PHASE 2 — APPS SCRIPT PROXY
// ============================================================
async function fetchSheetViaProxy() {
  const res  = await fetch(`${APPS_SCRIPT_URL}?action=getQuestions&_=${Date.now()}`,{cache:'no-store'});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error||'Apps Script error');
  return data;
}

// ============================================================
// CSV FALLBACK
// ============================================================
function parseCsv(text) {
  const rows=[];let row=[],field='',inQuote=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(inQuote){
      if(ch==='"'&&next==='"'){field+='"';i++;}
      else if(ch==='"'){inQuote=false;}
      else{field+=ch;}
    }else{
      if(ch==='"'){inQuote=true;}
      else if(ch===','){row.push(field.trim());field='';}
      else if(ch==='\n'||(ch==='\r'&&next==='\n')){
        if(ch==='\r')i++;
        row.push(field.trim());rows.push(row);row=[];field='';
      }else{field+=ch;}
    }
  }
  if(field||row.length){row.push(field.trim());if(row.some(c=>c))rows.push(row);}
  return rows;
}

function extractAnswer(raw){
  if(!raw)return'';
  const s=raw.toString().trim().toUpperCase();
  if(/^[ABCD]$/.test(s))return s;
  let m;
  m=s.match(/^([ABCD])[.):\-\s]/);if(m)return m[1];
  m=s.match(/^[(\[{]([ABCD])[)\]}]/);if(m)return m[1];
  m=s.match(/(?:OPTION|OPT|ANSWER|ANS(?:WER)?)[.\s:]*([ABCD])\b/);if(m)return m[1];
  m=s.match(/(?:CORRECT\s+)?ANSWER\s+IS\s+([ABCD])\b/);if(m)return m[1];
  m=s.match(/^([1-4])$/);if(m)return'ABCD'[parseInt(m[1])-1];
  m=s.match(/[ABCD]/);if(m)return m[0];
  return'';
}

async function fetchSheetViaCsv(level){
  const ts=Date.now(),r=Math.random().toString(36).substr(2,8);
  const url=`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TABS[level])}&_=${ts}&r=${r}`;
  try{
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok)return[];
    const allRows=parseCsv(await res.text()).slice(1);
    return allRows.map(cols=>{
      while(cols.length<8)cols.push('');
      const q=(cols[1]||'').toString().trim();
      if(!q||q.toLowerCase()==='question')return null;
      const ans=extractAnswer(cols[6]);
      if(!ans)return null;
      return{
        topic:normTopic(cols[0]),q,
        opts:[(cols[2]||'').toString().trim()||'—',(cols[3]||'').toString().trim()||'—',
              (cols[4]||'').toString().trim()||'—',(cols[5]||'').toString().trim()||'—'],
        ans:'ABCD'.indexOf(ans),exp:(cols[7]||'').toString().trim()
      };
    }).filter(Boolean);
  }catch{return[];}
}

// ============================================================
// MERGE
// ============================================================
function mergeNewQuestions(level, sheetQuestions){
  const bankSize=questionBank[level].length;
  const keys=new Set(questionBank[level].map(q=>normKey(q.q)));
  let newOnes=sheetQuestions.filter(q=>q&&q.q&&!keys.has(normKey(q.q)));
  if(newOnes.length===0&&sheetQuestions.length>bankSize){
    const extra=sheetQuestions.length-bankSize;
    newOnes=sheetQuestions.slice(-extra).filter(q=>q&&q.q);
    if(newOnes.length)console.warn(`${level}: normKey collision — adding ${newOnes.length} by position`);
  }
  if(newOnes.length>0){
    newOnes.forEach(q=>questionBank[level].push(q));
    buildTopicMap(level);
    console.log(`${level}: +${newOnes.length} new questions. Total: ${questionBank[level].length}`);
  }else{
    console.log(`${level}: up to date (sheet:${sheetQuestions.length} bank:${bankSize})`);
  }
  return newOnes.length;
}

// ============================================================
// SYNC
// ============================================================
async function syncWithSheet(isManual=false){
  if(isSyncing)return;
  isSyncing=true;setSyncIndicator('syncing');
  try{
    let addedB=0,addedI=0,addedH=0;
    try{
      console.log('Syncing via Apps Script proxy…');
      const d=await fetchSheetViaProxy();
      console.log(`Proxy: B:${d.counts?.beginner} I:${d.counts?.intermediate} H:${d.counts?.hard}`);
      addedB=mergeNewQuestions('beginner',d.beginner||[]);
      addedI=mergeNewQuestions('intermediate',d.intermediate||[]);
      addedH=mergeNewQuestions('hard',d.hard||[]);
    }catch(e){
      console.warn('Proxy failed:',e.message,'— CSV fallback…');
      const[b,i,h]=await Promise.all([fetchSheetViaCsv('beginner'),fetchSheetViaCsv('intermediate'),fetchSheetViaCsv('hard')]);
      addedB=mergeNewQuestions('beginner',b);
      addedI=mergeNewQuestions('intermediate',i);
      addedH=mergeNewQuestions('hard',h);
    }
    const total=addedB+addedI+addedH;
    if(total>0){
      updateVaultCounts();updateLevelProgress();saveCachedExtras();showSyncBanner(total);
      // Refresh topic screen live if open
      const ts=document.getElementById('topic-modal-overlay');
      if(ts&&ts.classList.contains('active')){
        const lv=document.getElementById('ts-grid').dataset.level;
        if(lv)renderTopicCards(lv,document.getElementById('ts-search').value||'');
      }
    }else{
      saveCachedExtras();
    }
    setSyncIndicator('ok');
  }catch(err){
    console.error('Sync error:',err);setSyncIndicator('error');
  }finally{isSyncing=false;}
}

function startAutoSync(){
  if(syncIntervalId)clearInterval(syncIntervalId);
  syncIntervalId=setInterval(()=>syncWithSheet(false),30000);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')syncWithSheet(false);
  });
  console.log('Auto-sync: every 30s + on tab focus');
}

function setSyncIndicator(state){
  const btn=document.getElementById('force-sync-btn');if(!btn)return;
  if(state==='syncing'){btn.textContent='🔄 Checking…';btn.disabled=true;}
  else if(state==='ok'){btn.textContent='✅ Synced';btn.disabled=false;setTimeout(()=>{btn.textContent='🔄 Sync Now';},3000);}
  else{btn.textContent='⚠️ Retry Sync';btn.disabled=false;}
}

function showSyncBanner(count){
  let b=document.getElementById('sync-banner');
  if(!b){
    b=document.createElement('div');b.id='sync-banner';
    b.style.cssText=`position:fixed;bottom:20px;right:20px;z-index:9999;background:#2E7D32;color:#fff;padding:14px 22px;border-radius:14px;font-size:.95rem;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:Inter,sans-serif;`;
    document.head.insertAdjacentHTML('beforeend',`<style>@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}</style>`);
    document.body.appendChild(b);
  }
  b.textContent=`✅ ${count} new question${count>1?'s':''} added from Google Sheets!`;
  b.style.display='block';b.style.animation='none';void b.offsetWidth;b.style.animation='slideUp 0.4s ease';
  clearTimeout(b._t);b._t=setTimeout(()=>{b.style.display='none';},6000);
}

// ============================================================
// VAULT COUNTS
// ============================================================
function updateVaultCounts(){
  const el=id=>document.getElementById(id);
  ['beginner','intermediate','hard'].forEach(level=>{
    const qc=questionBank[level].length,tc=getTopicCount(level);
    const v=el(`vault-count-${level}`);if(v)v.textContent=qc;
    const badge=el(`${level}-vault-badge`);if(badge)badge.textContent=`${qc} questions · ${tc} topics`;
    const tcEl=el(`${level}-topic-count`);if(tcEl)tcEl.textContent=tc;
    const qcEl=el(`${level}-question-count`);if(qcEl)qcEl.textContent=qc;
  });
  const total=questionBank.beginner.length+questionBank.intermediate.length+questionBank.hard.length;
  const vt=el('vault-total');if(vt)vt.textContent=total.toLocaleString();
  const pv=el('pill-qpr');if(pv)pv.textContent=`${getTopicCount('beginner')} / ${getTopicCount('intermediate')} / ${getTopicCount('hard')}`;
}

function showLoadingOverlay(show,msg=''){
  const o=document.getElementById('questions-loading-overlay');if(!o)return;
  o.style.display=show?'flex':'none';
  const m=document.getElementById('loading-msg');if(m&&msg)m.textContent=msg;
}

// ============================================================
// SESSION STATE
// ============================================================
const session={
  userName:'',sessionId:'',isLoggedIn:false,
  rounds:[],levelRoundCounts:{beginner:0,intermediate:0,hard:0},
  currentRoundQA:[],
  progress:{
    beginner:{attempted:0,correct:0,askedByTopic:{}},
    intermediate:{attempted:0,correct:0,askedByTopic:{}},
    hard:{attempted:0,correct:0,askedByTopic:{}}
  }
};

function generateSessionId(){return'sess_'+Date.now()+'_'+Math.random().toString(36).substr(2,9);}
function freshProgress(){
  return{
    beginner:{attempted:0,correct:0,askedByTopic:{}},
    intermediate:{attempted:0,correct:0,askedByTopic:{}},
    hard:{attempted:0,correct:0,askedByTopic:{}}
  };
}

// ============================================================
// GOOGLE SHEETS — SCORE SAVING
// ============================================================
function sendToSheets(action,payload){
  return fetch(APPS_SCRIPT_URL,{
    method:'POST',mode:'no-cors',
    headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({action,...payload})
  }).then(()=>console.log('Sheets:',action)).catch(e=>console.error(e));
}

function beaconClearSession(){
  if(!session.isLoggedIn||!session.sessionId)return;
  const p=JSON.stringify({action:'clearUserQuizData',sessionId:session.sessionId,userName:session.userName});
  try{navigator.sendBeacon(APPS_SCRIPT_URL,new Blob([p],{type:'text/plain'}));}
  catch(e){fetch(APPS_SCRIPT_URL,{method:'POST',mode:'no-cors',keepalive:true,headers:{'Content-Type':'text/plain'},body:p}).catch(()=>{});}
}

// ============================================================
// QUIZ RUNTIME STATE
// ============================================================
let currentLevel='',currentQuestions=[],currentQuestionIndex=0;
let score=0,wrongCount=0,answered=false;

// ============================================================
// NAME MODAL
// ============================================================
function showNameModal(){
  const modal=document.getElementById('name-modal');modal.style.display='flex';
  const input=document.getElementById('user-name-input');
  input.value='';input.classList.remove('error');
  document.getElementById('modal-error').textContent='';
  setTimeout(()=>input.focus(),100);
}

function submitName(){
  const input=document.getElementById('user-name-input');
  const name=input.value.trim();
  if(!name){input.classList.add('error');document.getElementById('modal-error').textContent='Please enter your name to continue.';return;}
  session.userName=name;session.sessionId=generateSessionId();session.isLoggedIn=true;
  session.rounds=[];session.levelRoundCounts={beginner:0,intermediate:0,hard:0};
  session.currentRoundQA=[];session.progress=freshProgress();
  document.getElementById('name-modal').style.display='none';
  document.getElementById('main-nav').style.display='flex';
  document.getElementById('landing').style.display='flex';
  document.getElementById('nav-user-badge').textContent='👤 '+name;
  document.getElementById('sidebar-username').textContent=name;
  updateLevelProgress();sendToSheets('setupSheets',{});
}

// ============================================================
// LOGOUT
// ============================================================
function confirmLogout(){
  if(!confirm('End your session?\n\nYour summary will be saved to the leaderboard and the detailed Q&A will be cleared.'))return;
  performLogout();
}

async function performLogout(){
  session.isLoggedIn=false;
  if(syncIntervalId){clearInterval(syncIntervalId);syncIntervalId=null;}
  const overlay=document.getElementById('logout-overlay');overlay.style.display='flex';hideAllSections();
  const ta=session.rounds.reduce((s,r)=>s+r.totalQuestions,0);
  const tc=session.rounds.reduce((s,r)=>s+r.score,0);
  try{
    document.getElementById('logout-message').textContent='Saving your score…';
    await sendToSheets('saveScoreData',{
      sessionId:session.sessionId,userName:session.userName,totalRounds:session.rounds.length,
      rounds:session.rounds.map(r=>({level:r.level,roundNumber:r.roundNumber,score:r.score,totalQuestions:r.totalQuestions})),
      totalAttempted:ta,totalCorrect:tc,accuracy:ta>0?Math.round((tc/ta)*100):0
    });
    document.getElementById('logout-message').textContent='Clearing session data…';
    await sendToSheets('clearUserQuizData',{sessionId:session.sessionId,userName:session.userName});
  }catch(e){console.error('Logout error:',e);}
  document.getElementById('logout-message').textContent='Done! See you again ☀️';
  document.getElementById('logout-sub').textContent='Redirecting…';
  setTimeout(()=>{
    session.userName='';session.sessionId='';
    session.rounds=[];session.levelRoundCounts={beginner:0,intermediate:0,hard:0};
    session.currentRoundQA=[];session.progress=freshProgress();
    overlay.style.display='none';
    document.getElementById('main-nav').style.display='none';
    document.getElementById('landing').style.display='none';
    document.getElementById('nav-user-badge').textContent='';
    document.getElementById('level-select').classList.remove('active');
    showNameModal();startAutoSync();
  },1500);
}

// ============================================================
// SECTION HELPERS
// ============================================================
function hideAllSections(){
  document.getElementById('landing').style.display='none';
  document.getElementById('level-select').classList.remove('active');
  // topic modal is an overlay, handled by closeTopicModal()
  document.getElementById('quiz-section').classList.remove('active');
  document.getElementById('score-dashboard').classList.remove('active');
}

// ============================================================
// QUESTION SELECTION
// topicFilter = null  → 1 question per topic, mixed round
// topicFilter = name  → up to 15 questions from that topic only
// ============================================================
function selectQuestions(level, topicFilter){
  const bank=questionBank[level],tMap=topicMap[level],prog=session.progress[level];
  if(!bank||bank.length===0)return[];

  if(topicFilter){
    // Single-topic mode
    const allIdx=tMap[topicFilter]||[];
    if(allIdx.length===0)return[];
    let shown=prog.askedByTopic[topicFilter]||[];
    let avail=allIdx.filter(i=>!shown.includes(i));
    if(avail.length===0){prog.askedByTopic[topicFilter]=[];avail=[...allIdx];}
    const shuffled=avail.sort(()=>Math.random()-.5).slice(0,15);
    prog.askedByTopic[topicFilter]=[...(prog.askedByTopic[topicFilter]||[]),...shuffled];
    return shuffled.map(i=>({...bank[i],_topicLabel:topicFilter}));
  }else{
    // All-topics mode — 1 per topic
    const topics=getTopics(level),questions=[];
    topics.forEach(topic=>{
      const allIdx=tMap[topic]||[];if(allIdx.length===0)return;
      let shown=prog.askedByTopic[topic]||[];
      let avail=allIdx.filter(i=>!shown.includes(i));
      if(avail.length===0){prog.askedByTopic[topic]=[];avail=[...allIdx];}
      const pick=avail[Math.floor(Math.random()*avail.length)];
      prog.askedByTopic[topic]=[...(prog.askedByTopic[topic]||[]),pick];
      questions.push({...bank[pick],_topicLabel:topic});
    });
    for(let i=questions.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));[questions[i],questions[j]]=[questions[j],questions[i]];
    }
    return questions;
  }
}

// ============================================================
// PROGRESS DISPLAY
// ============================================================
function updateLevelProgress(){
  ['beginner','intermediate','hard'].forEach(level=>{
    const p=session.progress[level],tCount=getTopicCount(level);
    const topicsCovered=Object.keys(p.askedByTopic).filter(t=>(p.askedByTopic[t]||[]).length>0).length;
    const totalAsked=Object.values(p.askedByTopic).reduce((s,arr)=>s+arr.length,0);
    const pct=(totalAsked/(questionBank[level].length||1))*100;
    document.getElementById(`${level}-attempted`).textContent=p.attempted;
    document.getElementById(`${level}-correct`).textContent=p.correct;
    document.getElementById(`${level}-rounds`).textContent=session.levelRoundCounts[level];
    document.getElementById(`${level}-progress`).style.width=`${Math.min(pct,100)}%`;
    const tcEl=document.getElementById(`${level}-topics-covered`);
    if(tcEl)tcEl.textContent=`${topicsCovered}/${tCount} topics seen`;
  });
  const ta=['beginner','intermediate','hard'].reduce((s,l)=>s+session.progress[l].attempted,0);
  const tc=['beginner','intermediate','hard'].reduce((s,l)=>s+session.progress[l].correct,0);
  document.getElementById('total-attempted').textContent=ta;
  document.getElementById('total-correct').textContent=tc;
  document.getElementById('overall-accuracy').textContent=ta>0?`${Math.round((tc/ta)*100)}%`:'0%';
}

// ============================================================
// NAVIGATION
// ============================================================
function showLevelSelect(){
  hideAllSections();
  document.getElementById('level-select').classList.add('active');
  updateLevelProgress();
}

// Called by level buttons in HTML — goes to topic select first
function startQuiz(level){
  showTopicSelect(level);
}

// Called by topic cards
function startQuizWithTopic(level, topicFilter){
  if(!questionsLoaded||questionBank[level].length===0){alert('Questions not loaded yet. Please refresh.');return;}
  closeTopicModal();  // close the modal
  currentLevel=level;
  currentTopicFilter=topicFilter||null;
  currentQuestions=selectQuestions(level,currentTopicFilter);
  currentQuestionIndex=0;score=0;wrongCount=0;answered=false;
  session.currentRoundQA=[];session.levelRoundCounts[level]++;
  hideAllSections();
  document.getElementById('quiz-section').classList.add('active');
  const ll={beginner:'Beginner Level',intermediate:'Intermediate Level',hard:'Hard Level'}[level];
  const tl=currentTopicFilter?` — ${currentTopicFilter}`:'';
  document.getElementById('current-level-badge').textContent=ll+tl;
  const qrEl=document.getElementById('quiz-round-total');
  if(qrEl)qrEl.textContent=currentQuestions.length;
  // Show Change Topic button
  const ctBtn=document.getElementById('change-topic-btn');
  if(ctBtn)ctBtn.classList.add('visible');
  updateLiveScore();loadQuestion();
}


// ============================================================
// LIVE SCORE
// ============================================================
function updateLiveScore(){
  document.getElementById('live-correct').textContent=score;
  document.getElementById('live-wrong').textContent=wrongCount;
  document.getElementById('live-remaining').textContent=currentQuestions.length-currentQuestionIndex;
}

// ============================================================
// QUIZ FLOW
// ============================================================
function loadQuestion(){
  if(currentQuestionIndex>=currentQuestions.length){showScoreDashboard();return;}
  answered=false;
  const q=currentQuestions[currentQuestionIndex];
  document.getElementById('quiz-progress-text').textContent=`Question ${currentQuestionIndex+1} of ${currentQuestions.length}`;
  document.getElementById('current-score').textContent=`${score} pts`;
  document.getElementById('quiz-progress-fill').style.width=`${(currentQuestionIndex/currentQuestions.length)*100}%`;
  document.getElementById('question-number').textContent=`Question ${currentQuestionIndex+1}`;
  document.getElementById('question-text').textContent=q.q;
  const topicNameEl=document.getElementById('question-topic');
  const topicCorner=document.getElementById('topic-corner');
  if(topicNameEl)topicNameEl.textContent=q.topic||'';
  if(topicCorner)topicCorner.style.display=q.topic?'flex':'none';
  const grid=document.getElementById('options-grid');grid.innerHTML='';
  ['A','B','C','D'].forEach((lbl,i)=>{
    const btn=document.createElement('button');btn.className='option-btn';
    btn.innerHTML=`<span class="opt-label">${lbl}</span><span class="opt-text">${q.opts[i]}</span>`;
    btn.onclick=()=>selectAnswer(i,q.ans,q.exp,q);
    grid.appendChild(btn);
  });
  document.getElementById('answer-feedback').classList.remove('show');
  document.getElementById('next-btn').classList.remove('show');
  updateLiveScore();
}

function selectAnswer(selected,correct,explanation,questionObj){
  if(answered)return;answered=true;
  session.progress[currentLevel].attempted++;
  const options=document.querySelectorAll('.option-btn');options.forEach(b=>b.disabled=true);
  const isCorrect=selected===correct;
  session.currentRoundQA.push({questionNumber:currentQuestionIndex+1,question:questionObj.q,topic:questionObj.topic||'',userAnswer:questionObj.opts[selected],correctAnswer:questionObj.opts[correct],isCorrect});
  options[selected].classList.add(isCorrect?'correct':'wrong');
  if(!isCorrect)options[correct].classList.add('correct');
  const fbHeader=document.getElementById('feedback-header');
  fbHeader.innerHTML=isCorrect?'✓ Correct!':`✗ Incorrect — Correct answer: <strong>${questionObj.opts[correct]}</strong>`;
  fbHeader.className='feedback-header '+(isCorrect?'correct':'wrong');
  document.getElementById('feedback-explanation').textContent=explanation;
  document.getElementById('answer-feedback').classList.add('show');
  if(isCorrect){score++;session.progress[currentLevel].correct++;}else{wrongCount++;}
  document.getElementById('next-btn').classList.add('show');
  updateLevelProgress();updateLiveScore();
}

function nextQuestion(){currentQuestionIndex++;loadQuestion();}

// ============================================================
// SCORE DASHBOARD
// ============================================================
function showScoreDashboard(){
  const percentage=Math.round((score/currentQuestions.length)*100);
  const roundNum=session.levelRoundCounts[currentLevel];
  session.rounds.push({level:currentLevel,roundNumber:roundNum,score,totalQuestions:currentQuestions.length,questions:[...session.currentRoundQA]});
  sendToSheets('addQuizData',{sessionId:session.sessionId,userName:session.userName,level:currentLevel,roundNumber:roundNum,roundScore:score,totalQuestions:currentQuestions.length,questions:session.currentRoundQA});
  hideAllSections();
  document.getElementById('score-dashboard').classList.add('active');
  document.getElementById('dashboard-level').textContent={beginner:'Beginner Level',intermediate:'Intermediate Level',hard:'Hard Level'}[currentLevel];
  const circum=2*Math.PI*90;
  document.getElementById('score-circle').style.strokeDashoffset=circum-(percentage/100)*circum;
  document.getElementById('score-percentage').textContent=`${percentage}%`;
  document.getElementById('score-fraction').textContent=`${score}/${currentQuestions.length}`;
  document.getElementById('stat-correct').textContent=score;
  document.getElementById('stat-wrong').textContent=currentQuestions.length-score;
  document.getElementById('stat-percentage').textContent=`${percentage}%`;
  let grade,gradeClass,gradeMsg;
  if(percentage>=90){grade='Outstanding ⭐';gradeClass='grade-outstanding';gradeMsg='🏆 Exceptional! You are a true solar energy expert!';}
  else if(percentage>=70){grade='Excellent 🥇';gradeClass='grade-excellent';gradeMsg='🌟 Excellent work! You have strong solar knowledge!';}
  else if(percentage>=50){grade='Good 👍';gradeClass='grade-good';gradeMsg='👏 Good job! Keep practising to master solar technology!';}
  else if(percentage>=30){grade='Average 📘';gradeClass='grade-average';gradeMsg='💪 Average performance. Review the topics and try again!';}
  else{grade='Needs Improvement 📚';gradeClass='grade-poor';gradeMsg='📖 Keep studying! Solar knowledge takes consistent effort.';}
  const gradeEl=document.getElementById('score-grade');
  if(gradeEl){gradeEl.textContent=grade;gradeEl.className='score-grade-badge '+gradeClass;}
  document.getElementById('score-message').textContent=gradeMsg;
  const totalCorrect=session.rounds.reduce((s,r)=>s+r.score,0);
  const totalAttempted=session.rounds.reduce((s,r)=>s+r.totalQuestions,0);
  const breakdownStr=session.rounds.map(r=>`${capitalize(r.level)} R${r.roundNumber}: ${r.score}/${r.totalQuestions}`).join('  ·  ');
  const summaryEl=document.getElementById('session-summary');
  summaryEl.innerHTML=`<strong>👤 ${session.userName}</strong> &nbsp;|&nbsp; Rounds: <strong>${session.rounds.length}</strong> &nbsp;|&nbsp; Overall: <strong>${totalCorrect}/${totalAttempted}</strong><br><small style="opacity:0.85">${breakdownStr}</small>`;
  summaryEl.classList.add('show');
  updateLevelProgress();
}

// Retake same topic
function retakeQuiz(){ startQuizWithTopic(currentLevel, currentTopicFilter); }
// Back to topic select for same level
function goHome(){ showTopicSelect(currentLevel); }

// ============================================================
// UTILITY
// ============================================================
function capitalize(str){return str?str.charAt(0).toUpperCase()+str.slice(1):'';}
function updateFooterYear(){const el=document.getElementById('footer-year');if(el)el.textContent=new Date().getFullYear();}

// ============================================================
// UNLOAD HANDLERS
// ============================================================
function registerUnloadHandlers(){
  window.addEventListener('pagehide',()=>{if(session.isLoggedIn)beaconClearSession();});
  window.addEventListener('beforeunload',()=>{if(session.isLoggedIn)beaconClearSession();});
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  updateFooterYear();
  registerUnloadHandlers();
  injectTopicSelectUI();   // builds topic screen in DOM
  showNameModal();

  showLoadingOverlay(true,'Loading Solar Mastery Vault…');

  setTimeout(()=>{
    loadEmbeddedBank();
    const cached=loadCachedExtras();
    updateVaultCounts();
    showLoadingOverlay(false);
    updateLevelProgress();
    if(cached>0)console.log(`Page loaded with ${cached} extra question(s) from cache!`);
    syncWithSheet(false);
    startAutoSync();
  },80);
});