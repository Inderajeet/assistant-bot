require("dotenv").config();

module.exports = {
  reminderOffset: 10, // minutes before task
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  spreadsheetId: process.env.SPREADSHEET_ID,
  googleCredentialsFile: process.env.GOOGLE_CREDENTIALS_FILE
};