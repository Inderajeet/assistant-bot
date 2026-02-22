const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const schedule = require("./schedule.json");
const tracker = require("./tracker");
const config = require("./config");
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const URL = process.env.RENDER_EXTERNAL_URL; // Provided by Render

// Your local timezone (change this to your timezone)
const TIMEZONE_OFFSET = 5.5; // IST = UTC+5:30 (5.5 hours)
// For other timezones:
// US Eastern: -4 or -5
// US Pacific: -7 or -8
// UTC: 0
// UK: +1 (during BST) or 0

// ✅ Telegram bot WITHOUT polling
const tgBot = new TelegramBot(TOKEN);

// ✅ Setup webhook
tgBot.setWebHook(`${URL}/bot${TOKEN}`);

app.post(`/bot${TOKEN}`, (req, res) => {
  tgBot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health route for Render + UptimeRobot
app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server time: ${new Date().toISOString()}`);
  console.log(`Local time (UTC${TIMEZONE_OFFSET >= 0 ? '+' : ''}${TIMEZONE_OFFSET}): ${getLocalTime()}`);
});

let lastReminderKey = null;

// Helper function to get local time with timezone offset
function getLocalTime() {
  const now = new Date();
  // Convert to local time by adding timezone offset
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const localTime = new Date(utc + (3600000 * TIMEZONE_OFFSET));
  return localTime;
}

// Helper function to get local time components
function getLocalTimeComponents() {
  const localTime = getLocalTime();
  
  const year = localTime.getFullYear();
  const month = (localTime.getMonth() + 1).toString().padStart(2, '0');
  const day = localTime.getDate().toString().padStart(2, '0');
  const hours = localTime.getHours().toString().padStart(2, '0');
  const minutes = localTime.getMinutes().toString().padStart(2, '0');
  const seconds = localTime.getSeconds().toString().padStart(2, '0');
  const weekday = localTime.toLocaleDateString('en-US', { weekday: 'long' });
  
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
    hour: hours,
    minute: minutes,
    second: seconds,
    weekday,
    full: localTime
  };
}

// ============================
// SEND TASK NOTIFICATION
// ============================
async function sendTaskNotification(task) {
  const localTime = getLocalTimeComponents();
  const message = `⏰ *${task.name}* starts in ${config.reminderOffset} mins at *${task.time}* (Local Time: ${localTime.time})\n⏱ Duration: ${task.hours} hrs\n\nChoose your action:`;

  const buttons = {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ DONE", callback_data: `DONE|${task.name}` },
          { text: "⚠ SKIP", callback_data: `SKIP|${task.name}` },
          { text: "➗ HALF", callback_data: `HALF|${task.name}` }
        ]
      ]
    }
  };

  try {
    await tgBot.sendMessage(CHAT_ID, message, buttons);
    console.log(`✅ Reminder sent for: ${task.name} at local time: ${localTime.time}`);
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

// ============================
// BUTTON HANDLER
// ============================
tgBot.on("callback_query", async (callbackQuery) => {
  try {
    const messageId = callbackQuery.message.message_id;
    const chatId = callbackQuery.message.chat.id;
    const messageText = callbackQuery.message.text;

    const [action, taskName] = callbackQuery.data.split("|");

    console.log(`Button pressed: ${action} for task: ${taskName}`);

    // Update tracker + Google Sheets
    await tracker.markTask(taskName, action);

    await tgBot.answerCallbackQuery(callbackQuery.id, {
      text: `${taskName} marked as ${action}`,
      show_alert: false
    });

    await tgBot.editMessageText(
      `✅ Task: *${taskName}*\n📊 Status: *${action}*`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      }
    );

    await tgBot.sendMessage(
      CHAT_ID,
      `✅ *${taskName}* has been marked as *${action}* at ${getLocalTimeComponents().time} (Local Time)`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    console.error("Error handling button press:", err);

    try {
      await tgBot.answerCallbackQuery(callbackQuery.id, {
        text: "Error processing your request. Please try again.",
        show_alert: true
      });
    } catch (e) {
      console.error("Error sending error notification:", e);
    }
  }
});

// ============================
// STARTUP MESSAGE
// ============================
async function startBot() {
  try {
    const localTime = getLocalTimeComponents();
    await tgBot.sendMessage(
      CHAT_ID, 
      `🚀 *Assistant is LIVE*\n📍 Timezone: UTC${TIMEZONE_OFFSET >= 0 ? '+' : ''}${TIMEZONE_OFFSET}\n🕐 Local Time: ${localTime.time} (${localTime.weekday})`, 
      { parse_mode: "Markdown" }
    );
    console.log("Bot started successfully!");
  } catch (error) {
    console.error("Error sending startup message:", error);
  }
}

startBot();

// ============================
// REMINDER ENGINE - Using Local Time
// ============================
cron.schedule("* * * * *", async () => {
  try {
    // Get local time with timezone offset
    const local = getLocalTimeComponents();
    const currentTime = `${local.hour}:${local.minute}`;
    const todayKey = local.date; // Use YYYY-MM-DD format

    console.log(`⏰ Checking reminders at Local Time: ${currentTime} (${local.weekday})`);

    for (let task of schedule) {
      const [hour, minute] = task.time.split(":").map(Number);

      let reminderHour = hour;
      let reminderMinute = minute - config.reminderOffset;

      if (reminderMinute < 0) {
        reminderMinute += 60;
        reminderHour -= 1;
      }

      // Handle negative hours (previous day)
      if (reminderHour < 0) {
        reminderHour += 24;
      }

      const reminderTime = 
        reminderHour.toString().padStart(2, "0") + ":" + 
        reminderMinute.toString().padStart(2, "0");

      if (currentTime === reminderTime) {
        const reminderKey = `${todayKey}-${task.name}`;
        if (lastReminderKey === reminderKey) {
          console.log(`⚠️ Reminder already sent for: ${task.name}`);
          return;
        }

        lastReminderKey = reminderKey;
        console.log(`📢 Sending reminder for: ${task.name} (scheduled at ${task.time}, reminding at ${reminderTime})`);
        await sendTaskNotification(task);
      }
    }
  } catch (error) {
    console.error("Error in reminder engine:", error);
  }
});

// ============================
// WEEKLY REPORT - Using Local Time
// ============================
// Run every Sunday at 9 PM local time
// To schedule at different time, change the cron expression
cron.schedule("0 21 * * 0", async () => {
  try {
    const local = getLocalTimeComponents();
    const report = await tracker.getWeeklyReport();

    await tgBot.sendMessage(
      CHAT_ID,
      `📊 *Weekly Report*\n🗓 Week ending: ${local.date}\n\n✅ Completed: ${report.done}\n📋 Total: ${report.total}\n📈 Performance: ${report.percent}%`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error sending weekly report:", error);
  }
}, {
  timezone: "Asia/Kolkata" // You can also use IANA timezone names
});

// ============================
// DIAGNOSTIC: Check time every hour
// ============================
cron.schedule("0 * * * *", async () => {
  const local = getLocalTimeComponents();
  console.log(`🕐 Diagnostic - Local Time: ${local.time}, Date: ${local.date}, Weekday: ${local.weekday}`);
}, {
  timezone: "Asia/Kolkata"
});