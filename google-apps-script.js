// ============================================================
// ECOSOCH SOLAR QUIZ — GOOGLE APPS SCRIPT
// Paste this entire file into Google Apps Script and deploy
// as a Web App (Execute as: Me, Access: Anyone)
// ============================================================

const SPREADSHEET_ID   = '1dTN76objOt1VsYa7ZwafdC5EFCloLzulSmYme9LV70I';
const QUIZ_DATA_SHEET  = 'UserQuizData';
const SCORE_DATA_SHEET = 'UserScoreData';

// ---------- Entry Points ----------

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'EcoSoch Quiz API is running ✅' }))
    .setMimeType(ContentService.MimeType.JSON);
}

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

// ---------- Sheet Setup ----------

function setupSheets(ss) {
  // ── UserQuizData ──
  let quizSheet = ss.getSheetByName(QUIZ_DATA_SHEET);
  if (!quizSheet) {
    quizSheet = ss.insertSheet(QUIZ_DATA_SHEET);
    const headers = [
      'Timestamp', 'Session ID', 'User Name', 'Level', 'Round #',
      'Q No.', 'Question', 'Topic', 'User Answer', 'Correct Answer',
      'Result', 'Round Score', 'Total Questions'
    ];
    const headerRange = quizSheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#F57C00');
    headerRange.setFontColor('#FFFFFF');
    quizSheet.setFrozenRows(1);
    quizSheet.setColumnWidth(7, 350);
    quizSheet.setColumnWidth(8, 180);
    quizSheet.setColumnWidth(9, 200);
    quizSheet.setColumnWidth(10, 200);
  }

  // ── UserScoreData ──
  let scoreSheet = ss.getSheetByName(SCORE_DATA_SHEET);
  if (!scoreSheet) {
    scoreSheet = ss.insertSheet(SCORE_DATA_SHEET);
    const headers = [
      'Logout Timestamp', 'User Name', 'Session ID',
      'Total Rounds Played', 'Levels Played',
      'Total Questions Attempted', 'Total Correct Answers',
      'Overall Accuracy %', 'Round-by-Round Breakdown'
    ];
    const headerRange = scoreSheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1565C0');
    headerRange.setFontColor('#FFFFFF');
    scoreSheet.setFrozenRows(1);
    scoreSheet.setColumnWidth(9, 500);
  }

  return { message: 'Sheets initialized successfully' };
}

// ---------- Add per-question data to UserQuizData ----------

function addQuizData(ss, data) {
  let sheet = ss.getSheetByName(QUIZ_DATA_SHEET);
  if (!sheet) { setupSheets(ss); sheet = ss.getSheetByName(QUIZ_DATA_SHEET); }

  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const levelLabel = capitalise(data.level) + ' Level';

  const rows = (data.questions || []).map(q => [
    timestamp,
    data.sessionId,
    data.userName,
    levelLabel,
    'Round ' + data.roundNumber,
    'Q' + q.questionNumber,
    q.question,
    q.topic || '',
    q.userAnswer,
    q.correctAnswer,
    q.isCorrect ? '✅ Correct' : '❌ Wrong',
    data.roundScore + ' / ' + data.totalQuestions,
    data.totalQuestions
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

// ---------- Save summary row to UserScoreData ----------

function saveScoreData(ss, data) {
  let sheet = ss.getSheetByName(SCORE_DATA_SHEET);
  if (!sheet) { setupSheets(ss); sheet = ss.getSheetByName(SCORE_DATA_SHEET); }

  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const breakdown = (data.rounds || []).map(r =>
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

// ---------- Delete this session's rows from UserQuizData ----------

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
// ⏰  WEEKLY AUTO-CLEAR — UserQuizData
// This function deletes ALL data rows in UserQuizData every week.
// Set up: Apps Script → Triggers → Add Trigger:
//   Function: weeklyAutoCleanUserQuizData
//   Event source: Time-driven
//   Type: Week timer → Every Monday (or any day) at 00:00–01:00
// ============================================================
function weeklyAutoCleanUserQuizData() {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(QUIZ_DATA_SHEET);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log('UserQuizData is already empty — nothing to delete.');
      return;
    }

    // Delete all rows after the header (row 1)
    sheet.deleteRows(2, lastRow - 1);
    Logger.log('✅ Weekly auto-clear: Deleted ' + (lastRow - 1) + ' rows from UserQuizData on ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));

    // Optional: log the cleanup in UserScoreData as a system note
    const scoreSheet = ss.getSheetByName(SCORE_DATA_SHEET);
    if (scoreSheet) {
      const note = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      scoreSheet.appendRow([
        note, '⚙️ SYSTEM', 'weekly-auto-clear',
        '', '', '', '',
        '', '🗑️ Weekly auto-clear: ' + (lastRow - 1) + ' rows deleted from UserQuizData'
      ]);
      scoreSheet.getRange(scoreSheet.getLastRow(), 1, 1, 9).setBackground('#FFF9C4');
    }

  } catch (err) {
    Logger.log('❌ weeklyAutoCleanUserQuizData error: ' + err.toString());
  }
}

// ---------- Helpers ----------

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}