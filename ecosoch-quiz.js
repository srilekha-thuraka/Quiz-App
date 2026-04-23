// ============================================================
// ECOSOCH SOLAR QUIZ — MAIN SCRIPT
// • Questions loaded live from Google Sheets (dynamic count)
// • Topic-wise rounds: 1 question per topic per round
// • Progress resets on every new login (per-session)
// • UserQuizData auto-deleted on logout AND on tab/browser close
// • Grade system after every round
// ============================================================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzrEOxPai4OJOMD_YaOrUD2wV34SuviziFyf_tQbRdllDbm_SjALGv_k8SJ4hEey3t_fQ/exec';
const SPREADSHEET_ID  = '1dTN76objOt1VsYa7ZwafdC5EFCloLzulSmYme9LV70I';
const SHEET_TABS = { beginner:'Beginner', intermediate:'Intermediate', hard:'Hard' };

// ============================================================
// QUESTION BANK  (loaded from Google Sheets on startup)
// questionBank[level] = array of { topic, q, opts, ans, exp }
// topicMap[level]     = { 'TopicName': [index, index, …], … }
// ============================================================
const questionBank = { beginner:[], intermediate:[], hard:[] };
const topicMap     = { beginner:{}, intermediate:{}, hard:{} };
let questionsLoaded = false;

// ── Normalise topic strings coming from the sheet ──
function normTopic(raw) {
  if (!raw) return 'General';
  // Fix common encoding issues (e.g. Cyrillic м in "Net меtering")
  return raw.trim()
    .replace(/[\u0430-\u044f\u0410-\u042f]/g, c => {
      const map = { 'е':'e','м':'m','т':'t','и':'i','н':'n','г':'g','р':'r','о':'o','а':'a','с':'s','к':'k','у':'u' };
      return map[c] || c;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Build topicMap from loaded bank ──
function buildTopicMap(level) {
  const map = {};
  questionBank[level].forEach((q, i) => {
    const t = normTopic(q.topic);
    q.topic = t;                   // normalise in-place
    if (!map[t]) map[t] = [];
    map[t].push(i);
  });
  topicMap[level] = map;
}

function getTopics(level)     { return Object.keys(topicMap[level]).sort(); }
function getTopicCount(level) { return getTopics(level).length; }

// ============================================================
// CSV FETCH + PARSE
// ============================================================
function sheetCsvUrl(tabName) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

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

function rowToQuestion(cols) {
  // Lenient answer extraction — handles "A", "a", "A.", "(A)", "Option A", etc.
  let raw = (cols[6] || '').trim().toUpperCase();
  // Extract first A/B/C/D letter found in the cell
  const match = raw.match(/[ABCD]/);
  const ans = match ? match[0] : '';
  if (!ans) return null;
  const q = (cols[1] || '').trim();
  if (!q) return null;
  return {
    topic: normTopic(cols[0] || ''),
    q,
    opts: [(cols[2]||'').trim(),(cols[3]||'').trim(),(cols[4]||'').trim(),(cols[5]||'').trim()],
    ans: 'ABCD'.indexOf(ans),
    exp: (cols[7] || '').trim()
  };
}

async function fetchLevel(level) {
  const res = await fetch(sheetCsvUrl(SHEET_TABS[level]));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const allRows = parseCsv(await res.text()).slice(1); // skip header
  const valid   = allRows.map(rowToQuestion).filter(Boolean);
  const skipped = allRows.length - valid.length;
  if (skipped > 0) console.warn(`⚠️ ${level}: ${skipped} rows skipped (empty question or no valid A/B/C/D answer). Total in sheet: ${allRows.length}, valid: ${valid.length}`);
  return valid;
}

async function loadQuestionsFromSheets() {
  showLoadingOverlay(true, 'Connecting to Solar Mastery Vault…');
  try {
    const [b, i, h] = await Promise.all([
      fetchLevel('beginner'), fetchLevel('intermediate'), fetchLevel('hard')
    ]);
    questionBank.beginner = b;
    questionBank.intermediate = i;
    questionBank.hard = h;

    // Build topic maps after loading
    buildTopicMap('beginner');
    buildTopicMap('intermediate');
    buildTopicMap('hard');

    questionsLoaded = true;
    updateVaultCounts();
    showLoadingOverlay(false);
    console.log(`✅ Loaded — B:${b.length}(${getTopicCount('beginner')} topics) I:${i.length}(${getTopicCount('intermediate')} topics) H:${h.length}(${getTopicCount('hard')} topics)`);
  } catch (err) {
    console.error('❌ Failed to load questions:', err);
    showLoadingOverlay(false);
    showSheetError();
  }
}

// ============================================================
// VAULT COUNTS — update all dynamic numbers in the UI
// ============================================================
function updateVaultCounts() {
  const el = id => document.getElementById(id);

  ['beginner','intermediate','hard'].forEach(level => {
    const qCount = questionBank[level].length;
    const tCount = getTopicCount(level);

    // Landing vault cards
    const vcQ = el(`vault-count-${level}`);
    if (vcQ) vcQ.textContent = qCount;

    const vcT = el(`vault-topics-${level}`);
    if (vcT) vcT.textContent = tCount + ' topics';

    // Level card vault badge (shows both counts)
    const badge = el(`${level}-vault-badge`);
    if (badge) badge.textContent = `${qCount} questions · ${tCount} topics`;

    // Level card topic count
    const tcEl = el(`${level}-topic-count`);
    if (tcEl) tcEl.textContent = tCount;

    // Level card questions count
    const qcEl = el(`${level}-question-count`);
    if (qcEl) qcEl.textContent = qCount;
  });

  // Total in banner
  const total = questionBank.beginner.length + questionBank.intermediate.length + questionBank.hard.length;
  const vt = el('vault-total');
  if (vt) vt.textContent = total.toLocaleString();

  // "Questions per Round" pill — use max topic count across levels
  const maxTopics = Math.max(getTopicCount('beginner'), getTopicCount('intermediate'), getTopicCount('hard'));
  const pillVal = el('pill-qpr');
  if (pillVal && maxTopics > 0) pillVal.textContent = getTopicCount('beginner') + '/' + getTopicCount('intermediate') + '/' + getTopicCount('hard');
}

function showLoadingOverlay(show, msg = '') {
  const o = document.getElementById('questions-loading-overlay');
  if (!o) return;
  o.style.display = show ? 'flex' : 'none';
  const m = document.getElementById('loading-msg');
  if (m && msg) m.textContent = msg;
}
function showSheetError() {
  const e = document.getElementById('sheet-error-banner');
  if (e) e.style.display = 'flex';
}

// ============================================================
// SESSION STATE
// ============================================================
const session = {
  userName:'', sessionId:'', isLoggedIn:false,
  rounds:[], levelRoundCounts:{ beginner:0, intermediate:0, hard:0 },
  currentRoundQA:[],
  // Per-login progress — completely reset on each new login
  // askedByTopic: { 'TopicName': [questionIndices already shown] }
  progress:{
    beginner:    { attempted:0, correct:0, askedByTopic:{} },
    intermediate:{ attempted:0, correct:0, askedByTopic:{} },
    hard:        { attempted:0, correct:0, askedByTopic:{} }
  }
};

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============================================================
// GOOGLE SHEETS HELPER
// ============================================================
function sendToSheets(action, payload) {
  return fetch(APPS_SCRIPT_URL, {
    method:'POST', mode:'no-cors',
    headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action, ...payload })
  })
  .then(() => console.log('✅ Sheets:', action))
  .catch(err => console.error('❌ Sheets error:', err));
}

function beaconClearSession() {
  if (!session.isLoggedIn || !session.sessionId) return;
  const payload = JSON.stringify({ action:'clearUserQuizData', sessionId:session.sessionId, userName:session.userName });
  try {
    navigator.sendBeacon(APPS_SCRIPT_URL, new Blob([payload], { type:'text/plain' }));
    console.log('📡 Beacon sent');
  } catch (e) {
    fetch(APPS_SCRIPT_URL, { method:'POST', mode:'no-cors', keepalive:true, headers:{'Content-Type':'text/plain'}, body:payload }).catch(()=>{});
  }
}

// ============================================================
// QUIZ RUNTIME STATE
// ============================================================
let currentLevel = '', currentQuestions = [], currentQuestionIndex = 0;
let score = 0, wrongCount = 0, answered = false;

// ============================================================
// FRESH PROGRESS OBJECT helper
// ============================================================
function freshProgress() {
  return {
    beginner:    { attempted:0, correct:0, askedByTopic:{} },
    intermediate:{ attempted:0, correct:0, askedByTopic:{} },
    hard:        { attempted:0, correct:0, askedByTopic:{} }
  };
}

// ============================================================
// NAME MODAL
// ============================================================
function showNameModal() {
  const modal = document.getElementById('name-modal');
  modal.style.display = 'flex';
  const input = document.getElementById('user-name-input');
  input.value = ''; input.classList.remove('error');
  document.getElementById('modal-error').textContent = '';
  setTimeout(() => input.focus(), 100);
}

function submitName() {
  const input = document.getElementById('user-name-input');
  const name  = input.value.trim();
  if (!name) {
    input.classList.add('error');
    document.getElementById('modal-error').textContent = 'Please enter your name to continue.';
    return;
  }

  session.userName         = name;
  session.sessionId        = generateSessionId();
  session.isLoggedIn       = true;
  session.rounds           = [];
  session.levelRoundCounts = { beginner:0, intermediate:0, hard:0 };
  session.currentRoundQA  = [];
  session.progress         = freshProgress();

  document.getElementById('name-modal').style.display  = 'none';
  document.getElementById('main-nav').style.display    = 'flex';
  document.getElementById('landing').style.display     = 'flex';
  document.getElementById('nav-user-badge').textContent = '👤 ' + name;
  document.getElementById('sidebar-username').textContent = name;

  updateLevelProgress();
  sendToSheets('setupSheets', {});
}

// ============================================================
// LOGOUT
// ============================================================
function confirmLogout() {
  if (!confirm('End your session?\n\nYour summary will be saved to the leaderboard and the detailed Q&A will be cleared.')) return;
  performLogout();
}

async function performLogout() {
  session.isLoggedIn = false;
  const overlay = document.getElementById('logout-overlay');
  overlay.style.display = 'flex';
  hideAllSections();

  const totalAttempted = session.rounds.reduce((s,r) => s + r.totalQuestions, 0);
  const totalCorrect   = session.rounds.reduce((s,r) => s + r.score, 0);
  const accuracy       = totalAttempted > 0 ? Math.round((totalCorrect/totalAttempted)*100) : 0;

  try {
    document.getElementById('logout-message').textContent = 'Saving your score…';
    await sendToSheets('saveScoreData', {
      sessionId:session.sessionId, userName:session.userName,
      totalRounds:session.rounds.length,
      rounds:session.rounds.map(r => ({ level:r.level, roundNumber:r.roundNumber, score:r.score, totalQuestions:r.totalQuestions })),
      totalAttempted, totalCorrect, accuracy
    });
    document.getElementById('logout-message').textContent = 'Clearing session data…';
    await sendToSheets('clearUserQuizData', { sessionId:session.sessionId, userName:session.userName });
  } catch (e) { console.error('Logout error:', e); }

  document.getElementById('logout-message').textContent = 'Done! See you again ☀️';
  document.getElementById('logout-sub').textContent     = 'Redirecting…';

  setTimeout(() => {
    session.userName = ''; session.sessionId = '';
    session.rounds = []; session.levelRoundCounts = { beginner:0, intermediate:0, hard:0 };
    session.currentRoundQA = [];
    session.progress = freshProgress();
    overlay.style.display = 'none';
    document.getElementById('main-nav').style.display    = 'none';
    document.getElementById('landing').style.display     = 'none';
    document.getElementById('nav-user-badge').textContent = '';
    document.getElementById('level-select').classList.remove('active');
    showNameModal();
  }, 1500);
}

// ============================================================
// SECTION HELPERS
// ============================================================
function hideAllSections() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('level-select').classList.remove('active');
  document.getElementById('quiz-section').classList.remove('active');
  document.getElementById('score-dashboard').classList.remove('active');
}

// ============================================================
// TOPIC-WISE QUESTION SELECTION
// ── Each round picks exactly 1 question per topic ──
// ── Questions within a topic rotate (no repeat until exhausted) ──
// ============================================================
function selectQuestions(level) {
  const bank    = questionBank[level];
  const tMap    = topicMap[level];
  const topics  = getTopics(level);
  const prog    = session.progress[level];

  if (!bank || bank.length === 0 || topics.length === 0) return [];

  const questions = [];

  topics.forEach(topic => {
    const allIdx = tMap[topic] || [];
    if (allIdx.length === 0) return;

    // Which indices from this topic have already been shown this session?
    const alreadyShown = prog.askedByTopic[topic] || [];
    let available = allIdx.filter(i => !alreadyShown.includes(i));

    // If all exhausted for this topic, reset just this topic
    if (available.length === 0) {
      prog.askedByTopic[topic] = [];
      available = [...allIdx];
    }

    // Pick one random question from available pool
    const pick = available[Math.floor(Math.random() * available.length)];
    prog.askedByTopic[topic] = [...(prog.askedByTopic[topic] || []), pick];

    questions.push({ ...bank[pick], _topicLabel: topic });
  });

  // Shuffle so topics don't always appear in alphabetical order
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  return questions;
}

// ============================================================
// PROGRESS DISPLAY
// Shows topic-level coverage in the progress bar
// ============================================================
function updateLevelProgress() {
  ['beginner','intermediate','hard'].forEach(level => {
    const p      = session.progress[level];
    const tCount = getTopicCount(level);

    // Count how many topics have had at least 1 question shown
    const topicsCovered = Object.keys(p.askedByTopic).filter(
      t => (p.askedByTopic[t] || []).length > 0
    ).length;

    // Progress = rounds completed in terms of topic coverage
    const totalAsked = Object.values(p.askedByTopic).reduce((s,arr) => s + arr.length, 0);
    const totalPossible = questionBank[level].length || 500;
    const pct = (totalAsked / totalPossible) * 100;

    document.getElementById(`${level}-attempted`).textContent = p.attempted;
    document.getElementById(`${level}-correct`).textContent   = p.correct;
    document.getElementById(`${level}-rounds`).textContent    = session.levelRoundCounts[level];
    document.getElementById(`${level}-progress`).style.width  = `${Math.min(pct, 100)}%`;

    // Update topic coverage if element exists
    const tcEl = document.getElementById(`${level}-topics-covered`);
    if (tcEl) tcEl.textContent = `${topicsCovered}/${tCount} topics seen`;
  });

  const ta = ['beginner','intermediate','hard'].reduce((s,l) => s + session.progress[l].attempted, 0);
  const tc = ['beginner','intermediate','hard'].reduce((s,l) => s + session.progress[l].correct, 0);
  document.getElementById('total-attempted').textContent  = ta;
  document.getElementById('total-correct').textContent    = tc;
  document.getElementById('overall-accuracy').textContent = ta > 0 ? `${Math.round((tc/ta)*100)}%` : '0%';
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
  if (!questionsLoaded || questionBank[level].length === 0) {
    alert('Questions are still loading from the vault. Please wait a moment and try again.');
    return;
  }
  currentLevel         = level;
  currentQuestions     = selectQuestions(level);   // topic-wise
  currentQuestionIndex = 0; score = 0; wrongCount = 0; answered = false;
  session.currentRoundQA = [];
  session.levelRoundCounts[level]++;

  hideAllSections();
  document.getElementById('quiz-section').classList.add('active');
  document.getElementById('current-level-badge').textContent =
    { beginner:'Beginner Level', intermediate:'Intermediate Level', hard:'Hard Level' }[level];

  // Update "Questions in this round" display
  const qrEl = document.getElementById('quiz-round-total');
  if (qrEl) qrEl.textContent = currentQuestions.length;

  updateLiveScore();
  loadQuestion();
}

// ============================================================
// LIVE SCORE BOX
// ============================================================
function updateLiveScore() {
  document.getElementById('live-correct').textContent   = score;
  document.getElementById('live-wrong').textContent     = wrongCount;
  document.getElementById('live-remaining').textContent = currentQuestions.length - currentQuestionIndex;
}

// ============================================================
// QUIZ FLOW
// ============================================================
function loadQuestion() {
  if (currentQuestionIndex >= currentQuestions.length) { showScoreDashboard(); return; }
  answered = false;
  const q  = currentQuestions[currentQuestionIndex];

  document.getElementById('quiz-progress-text').textContent =
    `Question ${currentQuestionIndex+1} of ${currentQuestions.length}`;
  document.getElementById('current-score').textContent = `${score} pts`;
  document.getElementById('quiz-progress-fill').style.width =
    `${(currentQuestionIndex / currentQuestions.length) * 100}%`;
  document.getElementById('question-number').textContent = `Question ${currentQuestionIndex+1}`;
  document.getElementById('question-text').textContent   = q.q;

  // Topic — top-right corner
  const topicNameEl = document.getElementById('question-topic');
  const topicCorner = document.getElementById('topic-corner');
  if (topicNameEl) topicNameEl.textContent = q.topic || '';
  if (topicCorner) topicCorner.style.display = q.topic ? 'flex' : 'none';

  const grid = document.getElementById('options-grid');
  grid.innerHTML = '';
  ['A','B','C','D'].forEach((lbl, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="opt-label">${lbl}</span><span class="opt-text">${q.opts[i]}</span>`;
    btn.onclick   = () => selectAnswer(i, q.ans, q.exp, q);
    grid.appendChild(btn);
  });

  document.getElementById('answer-feedback').classList.remove('show');
  document.getElementById('next-btn').classList.remove('show');
  updateLiveScore();
}

function selectAnswer(selected, correct, explanation, questionObj) {
  if (answered) return;
  answered = true;
  session.progress[currentLevel].attempted++;

  const options   = document.querySelectorAll('.option-btn');
  options.forEach(b => b.disabled = true);
  const isCorrect = selected === correct;

  session.currentRoundQA.push({
    questionNumber: currentQuestionIndex + 1,
    question:       questionObj.q,
    topic:          questionObj.topic || '',
    userAnswer:     questionObj.opts[selected],
    correctAnswer:  questionObj.opts[correct],
    isCorrect
  });

  options[selected].classList.add(isCorrect ? 'correct' : 'wrong');
  if (!isCorrect) options[correct].classList.add('correct');

  const fbHeader = document.getElementById('feedback-header');
  fbHeader.innerHTML = isCorrect
    ? '✓ Correct!'
    : `✗ Incorrect — Correct answer: <strong>${questionObj.opts[correct]}</strong>`;
  fbHeader.className = 'feedback-header ' + (isCorrect ? 'correct' : 'wrong');
  document.getElementById('feedback-explanation').textContent = explanation;
  document.getElementById('answer-feedback').classList.add('show');

  if (isCorrect) { score++; session.progress[currentLevel].correct++; } else { wrongCount++; }
  document.getElementById('next-btn').classList.add('show');
  updateLevelProgress();
  updateLiveScore();
}

function nextQuestion() { currentQuestionIndex++; loadQuestion(); }

// ============================================================
// SCORE DASHBOARD with GRADE SYSTEM
// ============================================================
function showScoreDashboard() {
  const percentage = Math.round((score / currentQuestions.length) * 100);
  const roundNum   = session.levelRoundCounts[currentLevel];

  session.rounds.push({
    level:currentLevel, roundNumber:roundNum,
    score, totalQuestions:currentQuestions.length,
    questions:[...session.currentRoundQA]
  });

  sendToSheets('addQuizData', {
    sessionId:session.sessionId, userName:session.userName,
    level:currentLevel, roundNumber:roundNum,
    roundScore:score, totalQuestions:currentQuestions.length,
    questions:session.currentRoundQA
  });

  hideAllSections();
  document.getElementById('score-dashboard').classList.add('active');
  document.getElementById('dashboard-level').textContent =
    { beginner:'Beginner Level', intermediate:'Intermediate Level', hard:'Hard Level' }[currentLevel];

  const circum = 2 * Math.PI * 90;
  document.getElementById('score-circle').style.strokeDashoffset = circum - (percentage/100)*circum;
  document.getElementById('score-percentage').textContent = `${percentage}%`;
  document.getElementById('score-fraction').textContent   = `${score}/${currentQuestions.length}`;
  document.getElementById('stat-correct').textContent     = score;
  document.getElementById('stat-wrong').textContent       = currentQuestions.length - score;
  document.getElementById('stat-percentage').textContent  = `${percentage}%`;

  // ── Grade System ──
  let grade, gradeClass, gradeMsg;
  if      (percentage >= 90) { grade='Outstanding ⭐';      gradeClass='grade-outstanding'; gradeMsg='🏆 Exceptional! You are a true solar energy expert!'; }
  else if (percentage >= 70) { grade='Excellent 🥇';        gradeClass='grade-excellent';   gradeMsg='🌟 Excellent work! You have strong solar knowledge!'; }
  else if (percentage >= 50) { grade='Good 👍';             gradeClass='grade-good';        gradeMsg='👏 Good job! Keep practising to master solar technology!'; }
  else if (percentage >= 30) { grade='Average 📘';          gradeClass='grade-average';     gradeMsg='💪 Average performance. Review the topics and try again!'; }
  else                       { grade='Needs Improvement 📚';gradeClass='grade-poor';        gradeMsg='📖 Keep studying! Solar knowledge takes consistent effort.'; }

  const gradeEl = document.getElementById('score-grade');
  if (gradeEl) { gradeEl.textContent = grade; gradeEl.className = 'score-grade-badge ' + gradeClass; }
  document.getElementById('score-message').textContent = gradeMsg;

  const totalCorrect   = session.rounds.reduce((s,r) => s + r.score, 0);
  const totalAttempted = session.rounds.reduce((s,r) => s + r.totalQuestions, 0);
  const breakdownStr   = session.rounds
    .map(r => `${capitalize(r.level)} R${r.roundNumber}: ${r.score}/${r.totalQuestions}`)
    .join('  ·  ');

  const summaryEl = document.getElementById('session-summary');
  summaryEl.innerHTML =
    `<strong>👤 ${session.userName}</strong> &nbsp;|&nbsp; ` +
    `Rounds: <strong>${session.rounds.length}</strong> &nbsp;|&nbsp; ` +
    `Overall: <strong>${totalCorrect}/${totalAttempted}</strong><br>` +
    `<small style="opacity:0.85">${breakdownStr}</small>`;
  summaryEl.classList.add('show');

  updateLevelProgress();
}

function retakeQuiz() { startQuiz(currentLevel); }
function goHome()     { showLevelSelect(); }

// ============================================================
// UTILITY
// ============================================================
function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }
function updateFooterYear() {
  const el = document.getElementById('footer-year');
  if (el) el.textContent = new Date().getFullYear();
}

// ============================================================
// AUTO-CLEAR ON TAB / BROWSER CLOSE
// ============================================================
function registerUnloadHandlers() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && session.isLoggedIn) beaconClearSession();
  });
  window.addEventListener('pagehide', () => { if (session.isLoggedIn) beaconClearSession(); });
  window.addEventListener('beforeunload', () => { if (session.isLoggedIn) beaconClearSession(); });
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  updateFooterYear();
  registerUnloadHandlers();
  showNameModal();
  await loadQuestionsFromSheets();
  updateLevelProgress();
});