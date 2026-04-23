// ============================================================
// ECOSOCH SOLAR QUIZ — GOOGLE APPS SCRIPT  (UPDATED)
// Deploy as Web App: Execute as Me, Access: Anyone
// ============================================================

const SPREADSHEET_ID   = '1dTN76objOt1VsYa7ZwafdC5EFCloLzulSmYme9LV70I';
const QUIZ_DATA_SHEET  = 'UserQuizData';
const SCORE_DATA_SHEET = 'UserScoreData';

// ── Answer extractor (mirrors JS side) ──
function extractAnswerGAS(raw) {
  if (!raw) return '';
  const s = raw.toString().trim().toUpperCase();
  if (/^[ABCD]$/.test(s)) return s;
  let m;
  m = s.match(/^([ABCD])[.):\-\s]/);   if (m) return m[1];
  m = s.match(/^[(\[{]([ABCD])[)\]}]/); if (m) return m[1];
  m = s.match(/(?:OPTION|OPT|ANSWER|ANS(?:WER)?)[.\s:]*([ABCD])\b/); if (m) return m[1];
  m = s.match(/(?:CORRECT\s+)?ANSWER\s+IS\s+([ABCD])\b/);            if (m) return m[1];
  m = s.match(/^([1-4])$/);  if (m) return 'ABCD'['ABCD'.indexOf('')] || 'ABCD'[parseInt(m[1]) - 1];
  m = s.match(/[ABCD]/);     if (m) return m[0];
  return '';
}

// ============================================================
// doGet — handles ?action=getQuestions (fresh data, no cache)
// ============================================================
function doGet(e) {
  // ── CORS headers helper ──
  const output = (data) =>
    ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);

  if (e && e.parameter && e.parameter.action === 'getQuestions') {
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const result = { beginner: [], intermediate: [], hard: [], counts: {} };

      [['Beginner','beginner'], ['Intermediate','intermediate'], ['Hard','hard']].forEach(([tab, key]) => {
        const sheet = ss.getSheetByName(tab);
        if (!sheet) { result[key] = []; result.counts[key] = 0; return; }

        const lastRow = sheet.getLastRow();
        if (lastRow <= 1) { result[key] = []; result.counts[key] = 0; return; }

        // Read all data at once (fast)
        const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
        const questions = [];

        data.forEach(row => {
          const q   = (row[1] || '').toString().trim();
          if (!q) return;
          const ans = extractAnswerGAS(row[6]);
          if (!ans) return;
          questions.push({
            topic: (row[0] || '').toString().trim() || 'General',
            q,
            opts: [
              (row[2] || '').toString().trim() || '—',
              (row[3] || '').toString().trim() || '—',
              (row[4] || '').toString().trim() || '—',
              (row[5] || '').toString().trim() || '—'
            ],
            ans: 'ABCD'.indexOf(ans),
            exp: (row[7] || '').toString().trim()
          });
        });

        result[key] = questions;
        result.counts[key] = questions.length;
      });

      return output({ success: true, ...result });
    } catch (err) {
      return output({ success: false, error: err.toString() });
    }
  }

  // Default GET response
  return output({ status: 'EcoSoch Quiz API is running ✅' });
}

// ============================================================
// doPost — handles score saving, data logging, session clear
// ============================================================
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    let result   = {};

    if      (action === 'setupSheets')       result = setupSheets(ss);
    else if (action === 'addQuizData')       result = addQuizData(ss, data);
    else if (action === 'saveScoreData')     result = saveScoreData(ss, data);
    else if (action === 'clearUserQuizData') result = clearUserQuizData(ss, data);
    else                                     result = { error: 'Unknown action' };

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, ...result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// Sheet Setup
// ============================================================
function setupSheets(ss) {
  let quizSheet = ss.getSheetByName(QUIZ_DATA_SHEET);
  if (!quizSheet) {
    quizSheet = ss.insertSheet(QUIZ_DATA_SHEET);
    const headers = [
      'Timestamp', 'Session ID', 'User Name', 'Level', 'Round #',
      'Q No.', 'Question', 'Topic', 'User Answer', 'Correct Answer',
      'Result', 'Round Score', 'Total Questions'
    ];
    const hr = quizSheet.getRange(1, 1, 1, headers.length);
    hr.setValues([headers]);
    hr.setFontWeight('bold');
    hr.setBackground('#F57C00');
    hr.setFontColor('#FFFFFF');
    quizSheet.setFrozenRows(1);
    quizSheet.setColumnWidth(7, 350);
    quizSheet.setColumnWidth(8, 180);
    quizSheet.setColumnWidth(9, 200);
    quizSheet.setColumnWidth(10, 200);
  }

  let scoreSheet = ss.getSheetByName(SCORE_DATA_SHEET);
  if (!scoreSheet) {
    scoreSheet = ss.insertSheet(SCORE_DATA_SHEET);
    const headers = [
      'Logout Timestamp', 'User Name', 'Session ID',
      'Total Rounds Played', 'Levels Played',
      'Total Questions Attempted', 'Total Correct Answers',
      'Overall Accuracy %', 'Round-by-Round Breakdown'
    ];
    const hr = scoreSheet.getRange(1, 1, 1, headers.length);
    hr.setValues([headers]);
    hr.setFontWeight('bold');
    hr.setBackground('#1565C0');
    hr.setFontColor('#FFFFFF');
    scoreSheet.setFrozenRows(1);
    scoreSheet.setColumnWidth(9, 500);
  }

  return { message: 'Sheets initialized successfully' };
}

// ============================================================
// Add per-question data
// ============================================================
function addQuizData(ss, data) {
  let sheet = ss.getSheetByName(QUIZ_DATA_SHEET);
  if (!sheet) { setupSheets(ss); sheet = ss.getSheetByName(QUIZ_DATA_SHEET); }

  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const levelLabel = capitalise(data.level) + ' Level';

  const rows = (data.questions || []).map(q => [
    timestamp, data.sessionId, data.userName,
    levelLabel, 'Round ' + data.roundNumber, 'Q' + q.questionNumber,
    q.question, q.topic || '', q.userAnswer, q.correctAnswer,
    q.isCorrect ? '✅ Correct' : '❌ Wrong',
    data.roundScore + ' / ' + data.totalQuestions, data.totalQuestions
  ]);

  if (rows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 13).setValues(rows);
    rows.forEach((row, i) => {
      const cell = sheet.getRange(startRow + i, 11);
      if (row[10].includes('Correct')) {
        cell.setBackground('#E8F5E9').setFontColor('#2E7D32');
      } else {
        cell.setBackground('#FFEBEE').setFontColor('#C62828');
      }
    });
  }
  return { rowsAdded: rows.length };
}

// ============================================================
// Save summary row
// ============================================================
function saveScoreData(ss, data) {
  let sheet = ss.getSheetByName(SCORE_DATA_SHEET);
  if (!sheet) { setupSheets(ss); sheet = ss.getSheetByName(SCORE_DATA_SHEET); }

  const timestamp  = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const breakdown  = (data.rounds || []).map(r =>
    capitalise(r.level) + ' Round ' + r.roundNumber + ': ' + r.score + '/' + r.totalQuestions
  ).join('  |  ');
  const levelsPlayed = [...new Set((data.rounds || []).map(r => capitalise(r.level)))].join(', ');

  sheet.appendRow([
    timestamp, data.userName, data.sessionId,
    data.totalRounds, levelsPlayed,
    data.totalAttempted, data.totalCorrect,
    data.accuracy + '%', breakdown
  ]);

  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 1, 1, 9).setBackground(newRow % 2 === 0 ? '#E3F2FD' : '#FFFFFF');
  return { success: true };
}

// ============================================================
// Clear session rows
// ============================================================
function clearUserQuizData(ss, data) {
  const sheet = ss.getSheetByName(QUIZ_DATA_SHEET);
  if (!sheet) return { deleted: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { deleted: 0 };

  const values  = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  const toDelete = [];
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).trim() === String(data.sessionId).trim()) {
      toDelete.push(i + 2);
    }
  }
  toDelete.forEach(rowNum => sheet.deleteRow(rowNum));
  return { deleted: toDelete.length };
}

// ============================================================
// Weekly auto-clear
// ============================================================
function weeklyAutoCleanUserQuizData() {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(QUIZ_DATA_SHEET);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) { Logger.log('UserQuizData already empty.'); return; }
    sheet.deleteRows(2, lastRow - 1);
    Logger.log('✅ Weekly auto-clear: Deleted ' + (lastRow - 1) + ' rows.');
    const scoreSheet = ss.getSheetByName(SCORE_DATA_SHEET);
    if (scoreSheet) {
      scoreSheet.appendRow([
        new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        '⚙️ SYSTEM', 'weekly-auto-clear', '', '', '', '', '',
        '🗑️ Weekly auto-clear: ' + (lastRow - 1) + ' rows deleted from UserQuizData'
      ]);
      scoreSheet.getRange(scoreSheet.getLastRow(), 1, 1, 9).setBackground('#FFF9C4');
    }
  } catch (err) {
    Logger.log('❌ weeklyAutoCleanUserQuizData error: ' + err.toString());
  }
}

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}