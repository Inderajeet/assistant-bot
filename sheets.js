const { google } = require("googleapis");
const config = require("./config");

const auth = new google.auth.GoogleAuth({
  keyFile: config.googleCredentialsFile,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

async function findTaskRow(taskName) {
  try {
    const sheets = await getSheets();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
    
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
    
    // Find matching row (skip header row if exists)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 4) continue; // Skip rows without enough columns
      
      const rowDate = row[0]; // Column A: Date
      const rowDay = row[1];  // Column B: Day
      const rowActivity = row[3]; // Column D: Activity
      
      // Check if this row matches today's date and the task name
      if (rowDate === todayStr && rowActivity && rowActivity.trim() === taskName.trim()) {
        console.log(`Found matching row at index ${i + 1}:`, row);
        return {
          rowIndex: i + 1, // Sheets uses 1-based indexing
          row: row
        };
      }
    }
    
    console.log(`No matching row found for task: ${taskName} on ${todayStr}`);
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
      console.log(`Task "${taskName}" not found in today's schedule`);
      return { success: false, message: 'Task not found in schedule' };
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
    
    // Prepare update data
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const notes = `Updated via Telegram at ${timestamp}`;
    
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
    
    console.log(`Successfully updated Google Sheets for ${taskName}: ${action}`);
    return { 
      success: true, 
      message: `Updated: ${completedHours}/${plannedHours} hours (${status})` 
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
    
    // Calculate date range for last 7 days
    const today = new Date();
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];
    
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
    
    // Skip header row (if exists)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 5) continue;
      
      const rowDate = row[0];
      
      // Check if within last 7 days
      if (rowDate >= oneWeekAgoStr && rowDate <= todayStr) {
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
