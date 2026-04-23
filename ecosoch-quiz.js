// ============================================================
// ECOSOCH SOLAR QUIZ — MAIN SCRIPT (HYBRID + PERSISTENT MODE)
//
// HOW IT WORKS:
//  Phase 1 → Embedded bank (1500 Qs) loads INSTANTLY
//  Phase 1b→ localStorage extras load INSTANTLY (persists across refresh)
//  Phase 2 → Apps Script proxy fetches live sheet (no cache)
//            New questions saved to localStorage + vault card updates
//
// RESULT: Vault card always shows the CORRECT count on every refresh —
//         no more reset to 500 on page load.
// ============================================================

const APPS_SCRIPT_URL   = 'https://script.google.com/macros/s/AKfycbzrEOxPai4OJOMD_YaOrUD2wV34SuviziFyf_tQbRdllDbm_SjALGv_k8SJ4hEey3t_fQ/exec';
const SPREADSHEET_ID    = '1dTN76objOt1VsYa7ZwafdC5EFCloLzulSmYme9LV70I';
const SHEET_TABS        = { beginner:'Beginner', intermediate:'Intermediate', hard:'Hard' };
const EXTRAS_STORAGE_KEY = 'ecosoch_extra_questions_v1';  // localStorage key

const questionBank = { beginner:[], intermediate:[], hard:[] };
const topicMap     = { beginner:{}, intermediate:{}, hard:{} };
let questionsLoaded = false;
let syncIntervalId  = null;
let isSyncing       = false;
// Track how many questions came from the embedded bank (never changes)
const embeddedCount = { beginner:0, intermediate:0, hard:0 };

// ============================================================
// TOPIC HELPERS
// ============================================================
function normTopic(raw) {
  if (!raw || !raw.toString().trim()) return 'General';
  return raw.toString().trim().replace(/\s+/g, ' ').trim();
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

// Full-text normalization for dedup — NO truncation to prevent false matches
function normKey(str) {
  return str.toString().toLowerCase().replace(/[\s.,!?'"()\-:;]/g, '');
}

// ============================================================
// PHASE 1 — LOAD EMBEDDED BANK INSTANTLY
// ============================================================
function loadEmbeddedBank() {
  const bank = window.QUESTION_BANK;
  if (!bank) { console.error('❌ question_bank_data.js not found'); return false; }

  ['beginner', 'intermediate', 'hard'].forEach(level => {
    questionBank[level] = [...(bank[level] || [])];
    embeddedCount[level] = questionBank[level].length;  // record baseline
    buildTopicMap(level);
  });

  questionsLoaded = true;
  console.log(
    `📦 Embedded — B:${embeddedCount.beginner} | ` +
    `I:${embeddedCount.intermediate} | H:${embeddedCount.hard}`
  );
  return true;
}

// ============================================================
// PHASE 1b — LOAD CACHED EXTRAS FROM localStorage (INSTANT)
// These are extra questions from Google Sheet saved on the last sync.
// Loading them here means the correct count shows immediately on refresh.
// ============================================================
function loadCachedExtras() {
  try {
    const raw = localStorage.getItem(EXTRAS_STORAGE_KEY);
    if (!raw) { console.log('💾 No cached extras yet'); return 0; }
    const extras = JSON.parse(raw);
    let totalLoaded = 0;

    ['beginner', 'intermediate', 'hard'].forEach(level => {
      const list = extras[level] || [];
      if (list.length === 0) return;
      // Only add if not already in bank (guard against double-loading)
      const currentKeys = new Set(questionBank[level].map(q => normKey(q.q)));
      list.forEach(q => {
        if (q && q.q && !currentKeys.has(normKey(q.q))) {
          questionBank[level].push(q);
          currentKeys.add(normKey(q.q));
          totalLoaded++;
        }
      });
      if (list.length > 0) buildTopicMap(level);
    });

    if (totalLoaded > 0) {
      console.log(`💾 Loaded ${totalLoaded} cached extra question(s) from localStorage`);
    }
    return totalLoaded;
  } catch (e) {
    console.warn('Could not load cached extras:', e);
    return 0;
  }
}

// ============================================================
// SAVE EXTRAS TO localStorage (called after every successful sync)
// Only stores questions BEYOND the embedded bank count.
// ============================================================
function saveCachedExtras() {
  try {
    const extras = {};
    ['beginner', 'intermediate', 'hard'].forEach(level => {
      // Extra questions = everything beyond the original embedded count
      extras[level] = questionBank[level].slice(embeddedCount[level]);
    });
    localStorage.setItem(EXTRAS_STORAGE_KEY, JSON.stringify(extras));
    const counts = Object.values(extras).map(arr => arr.length);
    console.log(`💾 Saved extras to localStorage — B:${counts[0]} I:${counts[1]} H:${counts[2]}`);
  } catch (e) {
    console.warn('Could not save cached extras:', e);
  }
}

// ============================================================
// PHASE 2 — FETCH FRESH QUESTIONS VIA APPS SCRIPT PROXY
// Apps Script reads directly from the spreadsheet — zero CDN caching.
// ============================================================
async function fetchSheetViaProxy() {
  const url = `${APPS_SCRIPT_URL}?action=getQuestions&_=${Date.now()}`;
  const res  = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Apps Script error');
  return data;
}

// ============================================================
// CSV FALLBACK (used only if Apps Script proxy fails)
// ============================================================
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ',')  { row.push(field.trim()); field = ''; }
      else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        if (ch === '\r') i++;
        row.push(field.trim()); rows.push(row); row = []; field = '';
      } else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(c => c)) rows.push(row); }
  return rows;
}

function extractAnswer(raw) {
  if (!raw) return '';
  const s = raw.toString().trim().toUpperCase();
  if (/^[ABCD]$/.test(s)) return s;
  let m;
  m = s.match(/^([ABCD])[.):\-\s]/);   if (m) return m[1];
  m = s.match(/^[(\[{]([ABCD])[)\]}]/); if (m) return m[1];
  m = s.match(/(?:OPTION|OPT|ANSWER|ANS(?:WER)?)[.\s:]*([ABCD])\b/); if (m) return m[1];
  m = s.match(/(?:CORRECT\s+)?ANSWER\s+IS\s+([ABCD])\b/);            if (m) return m[1];
  m = s.match(/^([1-4])$/);  if (m) return 'ABCD'[parseInt(m[1]) - 1];
  m = s.match(/[ABCD]/);     if (m) return m[0];
  return '';
}

async function fetchSheetViaCsv(level) {
  const ts  = Date.now();
  const r   = Math.random().toString(36).substr(2, 8);
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TABS[level])}&_=${ts}&r=${r}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const text    = await res.text();
    const allRows = parseCsv(text).slice(1);
    return allRows.map(cols => {
      while (cols.length < 8) cols.push('');
      const q = (cols[1] || '').toString().trim();
      if (!q || q.toLowerCase() === 'question') return null;
      const ans = extractAnswer(cols[6]);
      if (!ans) return null;
      return {
        topic: normTopic(cols[0]),
        q,
        opts: [
          (cols[2] || '').toString().trim() || '—',
          (cols[3] || '').toString().trim() || '—',
          (cols[4] || '').toString().trim() || '—',
          (cols[5] || '').toString().trim() || '—'
        ],
        ans: 'ABCD'.indexOf(ans),
        exp: (cols[7] || '').toString().trim()
      };
    }).filter(Boolean);
  } catch { return []; }
}

// ============================================================
// MERGE: add questions from sheet not already in the bank
// ============================================================
function mergeNewQuestions(level, sheetQuestions) {
  const bankSize    = questionBank[level].length;
  const currentKeys = new Set(questionBank[level].map(q => normKey(q.q)));

  // Primary: full-text dedup
  let newOnes = sheetQuestions.filter(q => q && q.q && !currentKeys.has(normKey(q.q)));

  // Safety net: if sheet has MORE questions than bank but text dedup found none
  // (means normKey collision — add by position instead)
  if (newOnes.length === 0 && sheetQuestions.length > bankSize) {
    const extraCount = sheetQuestions.length - bankSize;
    newOnes = sheetQuestions.slice(-extraCount).filter(q => q && q.q);
    if (newOnes.length > 0) {
      console.warn(`  ⚠️ ${level}: normKey collision — adding ${newOnes.length} by position`);
    }
  }

  if (newOnes.length > 0) {
    newOnes.forEach(q => questionBank[level].push(q));
    buildTopicMap(level);
    console.log(`✅ ${level}: +${newOnes.length} new! Total: ${questionBank[level].length}`);
    newOnes.forEach(q => console.log(`   ➕ "${q.q.substring(0, 70)}"`));
  } else {
    console.log(`  ✔ ${level}: up to date (sheet:${sheetQuestions.length} bank:${bankSize})`);
  }
  return newOnes.length;
}

// ============================================================
// SYNC — proxy first, CSV fallback
// After finding new questions: saves them to localStorage
// so next page load shows the correct count immediately.
// ============================================================
async function syncWithSheet(isManual = false) {
  if (isSyncing) return;
  isSyncing = true;
  setSyncIndicator('syncing');
  if (isManual) console.log('🔄 Manual sync…');

  try {
    let sheetData = null;
    let addedB = 0, addedI = 0, addedH = 0;

    // Try Apps Script proxy (reads sheet directly, no CDN cache)
    try {
      console.log('🌐 Syncing via Apps Script proxy…');
      sheetData = await fetchSheetViaProxy();
      console.log(`  Proxy: B:${sheetData.counts?.beginner} I:${sheetData.counts?.intermediate} H:${sheetData.counts?.hard}`);
      addedB = mergeNewQuestions('beginner',     sheetData.beginner     || []);
      addedI = mergeNewQuestions('intermediate', sheetData.intermediate || []);
      addedH = mergeNewQuestions('hard',         sheetData.hard         || []);
    } catch (proxyErr) {
      console.warn('  Proxy failed:', proxyErr.message, '— trying CSV fallback…');
      const [b, i, h] = await Promise.all([
        fetchSheetViaCsv('beginner'),
        fetchSheetViaCsv('intermediate'),
        fetchSheetViaCsv('hard')
      ]);
      console.log(`  CSV: B:${b.length} I:${i.length} H:${h.length}`);
      addedB = mergeNewQuestions('beginner',     b);
      addedI = mergeNewQuestions('intermediate', i);
      addedH = mergeNewQuestions('hard',         h);
    }

    const total = addedB + addedI + addedH;

    if (total > 0) {
      updateVaultCounts();
      updateLevelProgress();
      // ★ KEY: save extras so next refresh starts with correct count
      saveCachedExtras();
      showSyncBanner(total);
      console.log(`🎉 ${total} new question(s) added and saved to cache!`);
    } else {
      console.log('✅ Vault up to date');
      // Always re-save to keep localStorage fresh (handles edge cases)
      saveCachedExtras();
    }

    setSyncIndicator('ok');
  } catch (err) {
    console.error('Sync error:', err);
    setSyncIndicator('error');
  } finally {
    isSyncing = false;
  }
}

function startAutoSync() {
  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(() => syncWithSheet(false), 30000);
  // Sync whenever user returns to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncWithSheet(false);
  });
  console.log('⏱ Auto-sync: every 30s + on tab focus');
}

function setSyncIndicator(state) {
  const btn = document.getElementById('force-sync-btn');
  if (!btn) return;
  if (state === 'syncing') { btn.textContent = '🔄 Checking…'; btn.disabled = true; }
  else if (state === 'ok') { btn.textContent = '✅ Synced'; btn.disabled = false; setTimeout(() => { btn.textContent = '🔄 Sync Now'; }, 3000); }
  else                     { btn.textContent = '⚠️ Retry Sync'; btn.disabled = false; }
}

function showSyncBanner(count) {
  let banner = document.getElementById('sync-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sync-banner';
    banner.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:9999;background:#2E7D32;color:#fff;padding:14px 22px;border-radius:14px;font-size:.95rem;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:Inter,sans-serif;`;
    document.head.insertAdjacentHTML('beforeend', `<style>@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}</style>`);
    document.body.appendChild(banner);
  }
  banner.textContent = `✅ ${count} new question${count > 1 ? 's' : ''} added from Google Sheets!`;
  banner.style.display = 'block';
  banner.style.animation = 'none';
  void banner.offsetWidth;
  banner.style.animation = 'slideUp 0.4s ease';
  clearTimeout(banner._t);
  banner._t = setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// ============================================================
// VAULT COUNTS
// ============================================================
function updateVaultCounts() {
  const el = id => document.getElementById(id);
  ['beginner', 'intermediate', 'hard'].forEach(level => {
    const qCount = questionBank[level].length;
    const tCount = getTopicCount(level);
    const vcQ = el(`vault-count-${level}`);   if (vcQ) vcQ.textContent = qCount;
    const badge = el(`${level}-vault-badge`); if (badge) badge.textContent = `${qCount} questions · ${tCount} topics`;
    const tcEl = el(`${level}-topic-count`);  if (tcEl) tcEl.textContent = tCount;
    const qcEl = el(`${level}-question-count`); if (qcEl) qcEl.textContent = qCount;
  });
  const total = questionBank.beginner.length + questionBank.intermediate.length + questionBank.hard.length;
  const vt = el('vault-total');   if (vt) vt.textContent = total.toLocaleString();
  const pv = el('pill-qpr');      if (pv) pv.textContent = `${getTopicCount('beginner')} / ${getTopicCount('intermediate')} / ${getTopicCount('hard')}`;
}

function showLoadingOverlay(show, msg = '') {
  const o = document.getElementById('questions-loading-overlay');
  if (!o) return;
  o.style.display = show ? 'flex' : 'none';
  const m = document.getElementById('loading-msg');
  if (m && msg) m.textContent = msg;
}

// ============================================================
// SESSION STATE
// ============================================================
const session = {
  userName:'', sessionId:'', isLoggedIn:false,
  rounds:[], levelRoundCounts:{beginner:0,intermediate:0,hard:0},
  currentRoundQA:[],
  progress:{
    beginner:    {attempted:0,correct:0,askedByTopic:{}},
    intermediate:{attempted:0,correct:0,askedByTopic:{}},
    hard:        {attempted:0,correct:0,askedByTopic:{}}
  }
};

function generateSessionId() { return 'sess_'+Date.now()+'_'+Math.random().toString(36).substr(2,9); }
function freshProgress() {
  return {
    beginner:    {attempted:0,correct:0,askedByTopic:{}},
    intermediate:{attempted:0,correct:0,askedByTopic:{}},
    hard:        {attempted:0,correct:0,askedByTopic:{}}
  };
}

// ============================================================
// GOOGLE SHEETS — SCORE SAVING
// ============================================================
function sendToSheets(action, payload) {
  return fetch(APPS_SCRIPT_URL, {
    method:'POST', mode:'no-cors',
    headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({action,...payload})
  }).then(()=>console.log('✅ Sheets:',action)).catch(err=>console.error('❌',err));
}

function beaconClearSession() {
  if (!session.isLoggedIn||!session.sessionId) return;
  const payload = JSON.stringify({action:'clearUserQuizData',sessionId:session.sessionId,userName:session.userName});
  try { navigator.sendBeacon(APPS_SCRIPT_URL,new Blob([payload],{type:'text/plain'})); }
  catch(e) { fetch(APPS_SCRIPT_URL,{method:'POST',mode:'no-cors',keepalive:true,headers:{'Content-Type':'text/plain'},body:payload}).catch(()=>{}); }
}

// ============================================================
// QUIZ RUNTIME STATE
// ============================================================
let currentLevel='', currentQuestions=[], currentQuestionIndex=0;
let score=0, wrongCount=0, answered=false;

// ============================================================
// NAME MODAL
// ============================================================
function showNameModal() {
  const modal=document.getElementById('name-modal');
  modal.style.display='flex';
  const input=document.getElementById('user-name-input');
  input.value=''; input.classList.remove('error');
  document.getElementById('modal-error').textContent='';
  setTimeout(()=>input.focus(),100);
}

function submitName() {
  const input=document.getElementById('user-name-input');
  const name=input.value.trim();
  if (!name) { input.classList.add('error'); document.getElementById('modal-error').textContent='Please enter your name to continue.'; return; }
  session.userName=name; session.sessionId=generateSessionId(); session.isLoggedIn=true;
  session.rounds=[]; session.levelRoundCounts={beginner:0,intermediate:0,hard:0};
  session.currentRoundQA=[]; session.progress=freshProgress();
  document.getElementById('name-modal').style.display='none';
  document.getElementById('main-nav').style.display='flex';
  document.getElementById('landing').style.display='flex';
  document.getElementById('nav-user-badge').textContent='👤 '+name;
  document.getElementById('sidebar-username').textContent=name;
  updateLevelProgress();
  sendToSheets('setupSheets',{});
}

// ============================================================
// LOGOUT
// ============================================================
function confirmLogout() {
  if (!confirm('End your session?\n\nYour summary will be saved to the leaderboard and the detailed Q&A will be cleared.')) return;
  performLogout();
}

async function performLogout() {
  session.isLoggedIn=false;
  if (syncIntervalId) { clearInterval(syncIntervalId); syncIntervalId=null; }
  const overlay=document.getElementById('logout-overlay');
  overlay.style.display='flex';
  hideAllSections();
  const totalAttempted=session.rounds.reduce((s,r)=>s+r.totalQuestions,0);
  const totalCorrect=session.rounds.reduce((s,r)=>s+r.score,0);
  const accuracy=totalAttempted>0?Math.round((totalCorrect/totalAttempted)*100):0;
  try {
    document.getElementById('logout-message').textContent='Saving your score…';
    await sendToSheets('saveScoreData',{
      sessionId:session.sessionId,userName:session.userName,totalRounds:session.rounds.length,
      rounds:session.rounds.map(r=>({level:r.level,roundNumber:r.roundNumber,score:r.score,totalQuestions:r.totalQuestions})),
      totalAttempted,totalCorrect,accuracy
    });
    document.getElementById('logout-message').textContent='Clearing session data…';
    await sendToSheets('clearUserQuizData',{sessionId:session.sessionId,userName:session.userName});
  } catch(e) { console.error('Logout error:',e); }
  document.getElementById('logout-message').textContent='Done! See you again ☀️';
  document.getElementById('logout-sub').textContent='Redirecting…';
  setTimeout(()=>{
    session.userName=''; session.sessionId='';
    session.rounds=[]; session.levelRoundCounts={beginner:0,intermediate:0,hard:0};
    session.currentRoundQA=[]; session.progress=freshProgress();
    overlay.style.display='none';
    document.getElementById('main-nav').style.display='none';
    document.getElementById('landing').style.display='none';
    document.getElementById('nav-user-badge').textContent='';
    document.getElementById('level-select').classList.remove('active');
    showNameModal();
    startAutoSync();
  },1500);
}

// ============================================================
// SECTION HELPERS
// ============================================================
function hideAllSections() {
  document.getElementById('landing').style.display='none';
  document.getElementById('level-select').classList.remove('active');
  document.getElementById('quiz-section').classList.remove('active');
  document.getElementById('score-dashboard').classList.remove('active');
}

// ============================================================
// TOPIC-WISE QUESTION SELECTION
// ============================================================
function selectQuestions(level) {
  const bank=questionBank[level],tMap=topicMap[level],topics=getTopics(level),prog=session.progress[level];
  if (!bank||bank.length===0||topics.length===0) return [];
  const questions=[];
  topics.forEach(topic=>{
    const allIdx=tMap[topic]||[];
    if (allIdx.length===0) return;
    let shown=prog.askedByTopic[topic]||[];
    let avail=allIdx.filter(i=>!shown.includes(i));
    if (avail.length===0){prog.askedByTopic[topic]=[];avail=[...allIdx];}
    const pick=avail[Math.floor(Math.random()*avail.length)];
    prog.askedByTopic[topic]=[...(prog.askedByTopic[topic]||[]),pick];
    questions.push({...bank[pick],_topicLabel:topic});
  });
  for(let i=questions.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [questions[i],questions[j]]=[questions[j],questions[i]];
  }
  return questions;
}

// ============================================================
// PROGRESS DISPLAY
// ============================================================
function updateLevelProgress() {
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
    if(tcEl) tcEl.textContent=`${topicsCovered}/${tCount} topics seen`;
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
function showLevelSelect() {
  hideAllSections();
  document.getElementById('level-select').classList.add('active');
  updateLevelProgress();
}

function startQuiz(level) {
  if (!questionsLoaded||questionBank[level].length===0){alert('Questions not loaded yet. Please refresh.');return;}
  currentLevel=level; currentQuestions=selectQuestions(level);
  currentQuestionIndex=0; score=0; wrongCount=0; answered=false;
  session.currentRoundQA=[]; session.levelRoundCounts[level]++;
  hideAllSections();
  document.getElementById('quiz-section').classList.add('active');
  document.getElementById('current-level-badge').textContent={beginner:'Beginner Level',intermediate:'Intermediate Level',hard:'Hard Level'}[level];
  const qrEl=document.getElementById('quiz-round-total');
  if(qrEl) qrEl.textContent=currentQuestions.length;
  updateLiveScore(); loadQuestion();
}

// ============================================================
// LIVE SCORE
// ============================================================
function updateLiveScore() {
  document.getElementById('live-correct').textContent=score;
  document.getElementById('live-wrong').textContent=wrongCount;
  document.getElementById('live-remaining').textContent=currentQuestions.length-currentQuestionIndex;
}

// ============================================================
// QUIZ FLOW
// ============================================================
function loadQuestion() {
  if (currentQuestionIndex>=currentQuestions.length){showScoreDashboard();return;}
  answered=false;
  const q=currentQuestions[currentQuestionIndex];
  document.getElementById('quiz-progress-text').textContent=`Question ${currentQuestionIndex+1} of ${currentQuestions.length}`;
  document.getElementById('current-score').textContent=`${score} pts`;
  document.getElementById('quiz-progress-fill').style.width=`${(currentQuestionIndex/currentQuestions.length)*100}%`;
  document.getElementById('question-number').textContent=`Question ${currentQuestionIndex+1}`;
  document.getElementById('question-text').textContent=q.q;
  const topicNameEl=document.getElementById('question-topic');
  const topicCorner=document.getElementById('topic-corner');
  if(topicNameEl) topicNameEl.textContent=q.topic||'';
  if(topicCorner) topicCorner.style.display=q.topic?'flex':'none';
  const grid=document.getElementById('options-grid');
  grid.innerHTML='';
  ['A','B','C','D'].forEach((lbl,i)=>{
    const btn=document.createElement('button');
    btn.className='option-btn';
    btn.innerHTML=`<span class="opt-label">${lbl}</span><span class="opt-text">${q.opts[i]}</span>`;
    btn.onclick=()=>selectAnswer(i,q.ans,q.exp,q);
    grid.appendChild(btn);
  });
  document.getElementById('answer-feedback').classList.remove('show');
  document.getElementById('next-btn').classList.remove('show');
  updateLiveScore();
}

function selectAnswer(selected,correct,explanation,questionObj) {
  if(answered) return;
  answered=true;
  session.progress[currentLevel].attempted++;
  const options=document.querySelectorAll('.option-btn');
  options.forEach(b=>b.disabled=true);
  const isCorrect=selected===correct;
  session.currentRoundQA.push({questionNumber:currentQuestionIndex+1,question:questionObj.q,topic:questionObj.topic||'',userAnswer:questionObj.opts[selected],correctAnswer:questionObj.opts[correct],isCorrect});
  options[selected].classList.add(isCorrect?'correct':'wrong');
  if(!isCorrect) options[correct].classList.add('correct');
  const fbHeader=document.getElementById('feedback-header');
  fbHeader.innerHTML=isCorrect?'✓ Correct!':`✗ Incorrect — Correct answer: <strong>${questionObj.opts[correct]}</strong>`;
  fbHeader.className='feedback-header '+(isCorrect?'correct':'wrong');
  document.getElementById('feedback-explanation').textContent=explanation;
  document.getElementById('answer-feedback').classList.add('show');
  if(isCorrect){score++;session.progress[currentLevel].correct++;}else{wrongCount++;}
  document.getElementById('next-btn').classList.add('show');
  updateLevelProgress(); updateLiveScore();
}

function nextQuestion(){currentQuestionIndex++;loadQuestion();}

// ============================================================
// SCORE DASHBOARD + GRADE
// ============================================================
function showScoreDashboard() {
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
  if     (percentage>=90){grade='Outstanding ⭐';gradeClass='grade-outstanding';gradeMsg='🏆 Exceptional! You are a true solar energy expert!';}
  else if(percentage>=70){grade='Excellent 🥇';  gradeClass='grade-excellent';  gradeMsg='🌟 Excellent work! You have strong solar knowledge!';}
  else if(percentage>=50){grade='Good 👍';        gradeClass='grade-good';       gradeMsg='👏 Good job! Keep practising to master solar technology!';}
  else if(percentage>=30){grade='Average 📘';     gradeClass='grade-average';    gradeMsg='💪 Average performance. Review the topics and try again!';}
  else                   {grade='Needs Improvement 📚';gradeClass='grade-poor'; gradeMsg='📖 Keep studying! Solar knowledge takes consistent effort.';}
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

function retakeQuiz(){startQuiz(currentLevel);}
function goHome(){showLevelSelect();}

// ============================================================
// UTILITY
// ============================================================
function capitalize(str){return str?str.charAt(0).toUpperCase()+str.slice(1):'';}
function updateFooterYear(){const el=document.getElementById('footer-year');if(el) el.textContent=new Date().getFullYear();}

// ============================================================
// UNLOAD HANDLERS
// ============================================================
function registerUnloadHandlers() {
  window.addEventListener('pagehide',    ()=>{if(session.isLoggedIn) beaconClearSession();});
  window.addEventListener('beforeunload',()=>{if(session.isLoggedIn) beaconClearSession();});
}

// ============================================================
// INIT — three-phase load
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  updateFooterYear();
  registerUnloadHandlers();
  showNameModal();

  showLoadingOverlay(true, 'Loading Solar Mastery Vault…');

  setTimeout(() => {
    // ── Phase 1: load embedded bank (always 500/500/500) ──
    loadEmbeddedBank();

    // ── Phase 1b: load cached extras from localStorage ──
    // This makes the vault show the CORRECT count immediately on refresh
    // without waiting for any network request.
    const cached = loadCachedExtras();

    // Update UI with whatever we have (may already be 501+ from cache)
    updateVaultCounts();
    showLoadingOverlay(false);
    updateLevelProgress();

    if (cached > 0) {
      console.log(`⚡ Page loaded with ${cached} extra question(s) from cache — no flash!`);
    }

    // ── Phase 2: sync with sheet (confirms cache or finds newer questions) ──
    syncWithSheet(false);
    startAutoSync();
  }, 80);
});