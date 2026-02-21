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
});

let lastReminderKey = null;

// ============================
// SEND TASK NOTIFICATION
// ============================
async function sendTaskNotification(task) {
  const message = `⏰ ${task.name} starts in ${config.reminderOffset} mins.\nDuration: ${task.hours} hrs\nChoose your action:`;

  const buttons = {
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
      `✅ Task: ${taskName}\n📊 Status: ${action}`,
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      }
    );

    await tgBot.sendMessage(
      CHAT_ID,
      `✅ *${taskName}* has been marked as *${action}*`,
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
    await tgBot.sendMessage(CHAT_ID, "🚀 Assistant is LIVE (Mon–Sun Mode)");
    console.log("Bot started successfully!");
  } catch (error) {
    console.error("Error sending startup message:", error);
  }
}

startBot();

// ============================
// REMINDER ENGINE
// ============================
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const currentHour = now.getHours().toString().padStart(2, "0");
    const currentMinute = now.getMinutes().toString().padStart(2, "0");
    const currentTime = `${currentHour}:${currentMinute}`;
    const todayKey = now.toDateString();

    for (let task of schedule) {
      const [hour, minute] = task.time.split(":").map(Number);

      let reminderHour = hour;
      let reminderMinute = minute - config.reminderOffset;

      if (reminderMinute < 0) {
        reminderMinute += 60;
        reminderHour -= 1;
      }

      const reminderTime =
        reminderHour.toString().padStart(2, "0") +
        ":" +
        reminderMinute.toString().padStart(2, "0");

      if (currentTime === reminderTime) {
        const reminderKey = `${todayKey}-${task.name}`;
        if (lastReminderKey === reminderKey) return;

        lastReminderKey = reminderKey;
        await sendTaskNotification(task);
      }
    }
  } catch (error) {
    console.error("Error in reminder engine:", error);
  }
});

// ============================
// WEEKLY REPORT
// ============================
cron.schedule("0 21 * * 0", async () => {
  try {
    const report = tracker.getWeeklyReport();

    await tgBot.sendMessage(
      CHAT_ID,
      `📊 *Sunday Weekly Report*\n\n✅ Completed: ${report.done}\n📋 Total: ${report.total}\n📈 Performance: ${report.percent}%`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error sending weekly report:", error);
  }
});