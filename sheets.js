const { google } = require("googleapis");
const config = require("./config");

// Get these from config or environment variables
const SPREADSHEET_ID = config.googleSheetId || process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = config.googleSheetName || 'Sheet1';

// Timezone offset (match with your index.js)
const TIMEZONE_OFFSET = 5.5; // IST = UTC+5:30

// Initialize auth client
let authClient = null;

// Helper function to get local date with timezone
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
  
  return localTime.toLocaleDateString('en-US', { weekday: 'long' });
}

function getLocalTimestamp() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const localTime = new Date(utc + (3600000 * TIMEZONE_OFFSET));
  
  return localTime.toLocaleTimeString('en-US', { hour12: false });
}

// Get authenticated sheets client
async function getSheets() {
  try {
    if (!authClient) {
      // Handle service account JSON from environment variable
      let credentials;
      
      if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        // Parse the JSON string from environment variable
        try {
          credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        } catch (e) {
          console.error('Error parsing GOOGLE_SERVICE_ACCOUNT_JSON:', e);
          throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON format');
        }
        
        const auth = new google.auth.GoogleAuth({
          credentials: credentials,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });
        authClient = await auth.getClient();
      } else {
        // Fallback to key file
        const auth = new google.auth.GoogleAuth({
          keyFile: config.googleServiceAccountKeyFile || './credentials.json',
          scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });
        authClient = await auth.getClient();
      }
    }
    
    return google.sheets({ version: 'v4', auth: authClient });
  } catch (error) {
    console.error('Error authenticating with Google Sheets:', error);
    throw error;
  }
}

async function findTaskRow(taskName) {
  try {
    const sheets = await getSheets();
    const todayStr = getLocalDate();
    const dayName = getLocalDayName();
    
    console.log(`Looking for task: "${taskName}" on ${todayStr} (${dayName})`);
    
    // Get all data from sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:H`, // Get all columns
    });
    
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('No data found in sheet');
      return null;
    }
    
    console.log(`Total rows in sheet: ${rows.length}`);
    
    // Find matching row (skip header row if exists - assuming row 1 is header)
    for (let i = 1; i < rows.length; i++) { // Start from 1 to skip header
      const row = rows[i];
      if (!row || row.length < 4) continue; // Skip rows without enough columns
      
      const rowDate = row[0]; // Column A: Date
      const rowDay = row[1];  // Column B: Day
      const rowActivity = row[3] ? row[3].trim() : ''; // Column D: Activity
      
      // Check if this row matches today's date and the task name (case-insensitive)
      if (rowDate === todayStr && rowActivity && 
          rowActivity.toLowerCase() === taskName.trim().toLowerCase()) {
        console.log(`✅ Found matching row at index ${i + 1}:`, row);
        return {
          rowIndex: i + 1, // Sheets uses 1-based indexing
          row: row
        };
      }
    }
    
    // If not found, try partial match
    console.log(`No exact match found, trying partial match...`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 4) continue;
      
      const rowDate = row[0];
      const rowActivity = row[3] ? row[3].trim() : '';
      
      if (rowDate === todayStr && rowActivity && 
          rowActivity.toLowerCase().includes(taskName.trim().toLowerCase())) {
        console.log(`✅ Found partial match at index ${i + 1}:`, row);
        return {
          rowIndex: i + 1,
          row: row
        };
      }
    }
    
    console.log(`❌ No matching row found for task: "${taskName}" on ${todayStr}`);
    return null;
  } catch (error) {
    console.error('Error finding task row:', error);
    throw error;
  }
}

// Mark task in Google Sheets
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
    
    // Calculate completed hours based on action
    let completedHours = 0;
    let status = '';
    
    // Find planned hours from column E (index 4)
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
    
    // Prepare update data with local timestamp
    const timestamp = getLocalTimestamp();
    const notes = `✅ Updated via Telegram at ${timestamp} (Local Time)`;
    
    console.log(`Updating row ${rowIndex}: Hours: ${completedHours}, Status: ${status}`);
    
    // Update Completed Hours (Column F)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!F${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[completedHours]]
      }
    });
    
    // Update Status (Column G)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[status]]
      }
    });
    
    // Update Notes (Column H)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!H${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[notes]]
      }
    });
    
    console.log(`✅ Successfully updated Google Sheets for ${taskName}: ${action}`);
    return { 
      success: true, 
      message: `📊 ${completedHours}/${plannedHours} hours completed (${status})` 
    };
    
  } catch (error) {
    console.error('Error updating Google Sheets:', error);
    throw error;
  }
}

// Get weekly report from Google Sheets
async function getWeeklyReport() {
  try {
    const sheets = await getSheets();
    
    // Calculate date range for last 7 days using local time
    const today = new Date();
    const utc = today.getTime() + (today.getTimezoneOffset() * 60000);
    const localToday = new Date(utc + (3600000 * TIMEZONE_OFFSET));
    
    const oneWeekAgo = new Date(localToday);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];
    const todayStr = localToday.toISOString().split('T')[0];
    
    console.log(`Getting weekly report from ${oneWeekAgoStr} to ${todayStr}`);
    
    // Get all data
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
    
    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;
      
      const rowDate = row[0];
      
      // Check if within last 7 days
      if (rowDate && rowDate >= oneWeekAgoStr && rowDate <= todayStr) {
        const plannedHours = parseFloat(row[4]) || 0;
        const completedHours = parseFloat(row[5]) || 0;
        
        if (plannedHours > 0) {
          totalTasks++;
          if (completedHours > 0) {
            if (completedHours >= plannedHours) {
              completedTasks += 1; // Full task
            } else {
              completedTasks += completedHours / plannedHours; // Partial task
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