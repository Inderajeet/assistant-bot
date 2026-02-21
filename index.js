const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const schedule = require("./schedule.json");
const tracker = require("./tracker");
const config = require("./config");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const tgBot = new TelegramBot(config.telegramBotToken, { 
  polling: true  // Changed to true to handle callbacks
});

let lastReminderKey = null;

// Send task notification with inline buttons
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
    await tgBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, buttons);
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

// Handle button presses
tgBot.on("callback_query", async (callbackQuery) => {
  try {
    const messageId = callbackQuery.message.message_id;
    const chatId = callbackQuery.message.chat.id;
    const messageText = callbackQuery.message.text;

    const [action, taskName] = callbackQuery.data.split("|");

    console.log(`Button pressed: ${action} for task: ${taskName}`);

    // Update tracker & Google Sheets
    await tracker.markTask(taskName, action);

    // Answer callback to remove loading state and show notification
    await tgBot.answerCallbackQuery(callbackQuery.id, { 
      text: `${taskName} marked as ${action}`,
      show_alert: false 
    });

    // Edit original message to show status
    await tgBot.editMessageText(
      `✅ Task: ${taskName}\n📊 Status: ${action}\n\nOriginal message: ${messageText}`,
      { 
        chat_id: chatId, 
        message_id: messageId,
        reply_markup: { inline_keyboard: [] } // Remove buttons
      }
    );

    // Send confirmation to the chat
    await tgBot.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `✅ *${taskName}* has been marked as *${action}*`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    console.error("Error handling button press:", err);
    
    // Try to notify user about error
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

// Handle errors
tgBot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

// Startup message
async function startBot() {
  try {
    await tgBot.sendMessage(process.env.TELEGRAM_CHAT_ID, "🚀 Assistant is LIVE (Mon–Sun Mode)");
    console.log("Bot started successfully!");
  } catch (error) {
    console.error("Error sending startup message:", error);
  }
}

startBot();

// REMINDER ENGINE - every minute
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const currentHour = now.getHours().toString().padStart(2, "0");
    const currentMinute = now.getMinutes().toString().padStart(2, "0");
    const currentTime = `${currentHour}:${currentMinute}`;
    const todayKey = now.toDateString();

    console.log(`Checking reminders at ${currentTime}...`);

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
        if (lastReminderKey === reminderKey) {
          console.log(`Reminder already sent for ${task.name}`);
          return;
        }

        lastReminderKey = reminderKey;
        console.log(`Sending reminder for: ${task.name}`);
        await sendTaskNotification(task);
      }
    }
  } catch (error) {
    console.error("Error in reminder engine:", error);
  }
});

// WEEKLY REPORT - every Sunday 9 PM
cron.schedule("0 21 * * 0", async () => {
  try {
    const report = tracker.getWeeklyReport();
    await tgBot.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `📊 *Sunday Weekly Report*\n\n✅ Completed: ${report.done}\n📋 Total: ${report.total}\n📈 Performance: ${report.percent}%`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error sending weekly report:", error);
  }
});