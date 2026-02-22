const { google } = require('googleapis');
const {config} = require('./config');

// Google Sheets configuration
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Replace with your Google Sheet ID
const SHEET_NAME = 'Weekly Tracker'; // Replace with your sheet name if different

// Authenticate with Google Sheets
const TIMEZONE_OFFSET = 5.5; // IST

function getLocalDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const localTime = new Date(utc + (3600000 * TIMEZONE_OFFSET));
  
  const year = localTime.getFullYear();
  const month = (localTime.getMonth() + 1).toString().padStart(2, '0');
  const day = localTime.getDate().toString().padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

function getLocalDayName() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const localTime = new Date(utc + (3600000 * TIMEZONE_OFFSET));
  
  return localTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
}

async function getAuthClient() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
  } catch (error) {
    console.error('Error authenticating with Google Sheets:', error);
    throw error;
  }
}

async function getSheets() {
  const auth = await getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

async function findTaskRow(taskName) {
  try {
    const sheets = await getSheets();
    const todayStr = getLocalDate();
    const dayName = getLocalDayName();
    
    console.log(`Looking for task: "${taskName}" on ${todayStr} (${dayName})`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:H`,
    });
    
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('No data found in sheet');
      return null;
    }
    
    // Log first few rows for debugging
    console.log(`Total rows in sheet: ${rows.length}`);
    console.log('Sample rows:');
    for (let i = 1; i < Math.min(5, rows.length); i++) {
      console.log(`Row ${i + 1}: ${rows[i]?.join(' | ')}`);
    }
    
    // Find matching row (skip header row)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 4) continue;
      
      const rowDate = row[0]; // Column A: Date
      const rowDay = row[1];  // Column B: Day
      const rowActivity = row[3]; // Column D: Activity
      
      if (rowDate === todayStr && rowActivity && 
          rowActivity.trim().toLowerCase() === taskName.trim().toLowerCase()) {
        console.log(`✅ Found matching row at index ${i + 1}:`, row);
        return {
          rowIndex: i + 1,
          row: row
        };
      }
    }
    
    console.log(`❌ No matching row found for task: "${taskName}" on ${todayStr}`);
    
    // Alternative: try to find by partial match
    console.log('Attempting partial match search...');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 4) continue;
      
      const rowDate = row[0];
      const rowActivity = row[3];
      
      if (rowDate === todayStr && rowActivity && 
          rowActivity.toLowerCase().includes(taskName.toLowerCase())) {
        console.log(`✅ Found partial match at index ${i + 1}:`, row);
        return {
          rowIndex: i + 1,
          row: row
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding task row:', error);
    throw error;
  }
}

async function markTask(taskName, action) {
  try {
    console.log(`Marking task: ${taskName} with action: ${action}`);
    
    const taskRow = await findTaskRow(taskName);
    if (!taskRow) {
      return { 
        success: false, 
        message: `Task "${taskName}" not found in today's schedule. Check if the task name matches exactly.` 
      };
    }
    
    const sheets = await getSheets();
    const rowIndex = taskRow.rowIndex;
    
    let completedHours = 0;
    let status = '';
    
    const plannedHours = parseFloat(taskRow.row[4]) || 0;
    
    switch(action) {
      case 'DONE':
        completedHours = plannedHours;
        status = '✅';
        break;
      case 'HALF':
        completedHours = plannedHours / 2;
        status = '⚠️';
        break;
      case 'SKIP':
        completedHours = 0;
        status = '❌';
        break;
      default:
        completedHours = 0;
        status = '❓';
    }
    
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const localTime = new Date(utc + (3600000 * TIMEZONE_OFFSET));
    const timestamp = localTime.toLocaleTimeString('en-US', { hour12: false });
    const notes = `✅ Updated via Telegram at ${timestamp} (Local Time)`;
    
    // Update Completed Hours
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!F${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[completedHours]]
      }
    });
    
    // Update Status
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[status]]
      }
    });
    
    // Update Notes
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!H${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[notes]]
      }
    });
    
    console.log(`✅ Successfully updated Google Sheets for ${taskName}: ${action} (${completedHours}/${plannedHours} hrs)`);
    return { 
      success: true, 
      message: `📊 ${completedHours}/${plannedHours} hours completed (${status})` 
    };
    
  } catch (error) {
    console.error('Error updating Google Sheets:', error);
    throw error;
  }
}

async function getWeeklyReport() {
  try {
    const sheets = await getSheets();
    
    const today = new Date();
    const utc = today.getTime() + (today.getTimezoneOffset() * 60000);
    const localToday = new Date(utc + (3600000 * TIMEZONE_OFFSET));
    
    const oneWeekAgo = new Date(localToday);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];
    const todayStr = localToday.toISOString().split('T')[0];
    
    console.log(`Getting weekly report from ${oneWeekAgoStr} to ${todayStr}`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:H`,
    });
    
    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return { done: 0, total: 0, percent: 0 };
    }
    
    let totalTasks = 0;
    let completedTasks = 0;
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 5) continue;
      
      const rowDate = row[0];
      
      if (rowDate >= oneWeekAgoStr && rowDate <= todayStr) {
        const plannedHours = parseFloat(row[4]) || 0;
        const completedHours = parseFloat(row[5]) || 0;
        
        if (plannedHours > 0) {
          totalTasks++;
          if (completedHours > 0) {
            if (completedHours >= plannedHours) {
              completedTasks += 1;
            } else {
              completedTasks += completedHours / plannedHours;
            }
          }
        }
      }
    }
    
    const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    return {
      done: completedTasks.toFixed(1),
      total: totalTasks,
      percent: percent
    };
    
  } catch (error) {
    console.error('Error getting weekly report:', error);
    return { done: 0, total: 0, percent: 0 };
  }
}

module.exports = {
  markTask,
  getWeeklyReport
};
