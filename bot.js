// ================================================================
// CHUNK 1 — IMPORTS + ENV + MONGODB + TELEGRAM BOT SETUP
// ================================================================

import 'dotenv/config';
import TelegramBot from "node-telegram-bot-api";
import fs from "fs-extra";
import express from "express";
import moment from "moment";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// -------- Resolve __dirname in ES modules --------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// -------- LOAD ENV --------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "airdlivers";
const BASE_URL = process.env.BASE_URL;   // Railway or Render URL

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing in .env");
if (!ADMIN_GROUP_ID) throw new Error("ADMIN_GROUP_ID missing in .env");
if (!ADMIN_PIN) throw new Error("ADMIN_PIN missing in .env");
if (!MONGO_URI) throw new Error("MONGO_URI missing in .env");
if (!BASE_URL) throw new Error("BASE_URL missing in .env");

// -------- JSON BACKUP FILES --------
const SENDERS_JSON = join(__dirname, "senders.json");
const TRAVELERS_JSON = join(__dirname, "travelers.json");
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// -------- CONNECT MONGODB --------
let mongoClient, db, sendersCol, travelersCol, chatLogsCol, userControlCol;

try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);

    sendersCol = db.collection("senders");
    travelersCol = db.collection("travelers");
    chatLogsCol = db.collection("chatLogs");
    userControlCol = db.collection("userControls");

    console.log("✅ MongoDB connected successfully");
} catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
}

// -------- TELEGRAM BOT (Webhook Mode) --------
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${BASE_URL}${WEBHOOK_PATH}`;

try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("🔗 Webhook set to:", WEBHOOK_URL);
} catch (err) {
    console.error("Webhook setup error:", err.message);
}

// -------- EXPRESS SERVER (Required for Webhook) --------
const app = express();
app.use(express.json({ limit: "20mb" }));

// health check
app.get("/", (req, res) => res.send("🌍 AirDlivers bot is running via webhook"));

// webhook endpoint
app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// start express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
    console.log(`🌍 HTTP server running on port ${PORT}`)
);

// -------- Basic Utility Helpers --------
function escapeHtml(str = "") {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function nowYYMMDDHHMMSS() {
    return moment().format("YYMMDDHHmmss");
}

function makeRequestId(prefix) {
    return `${prefix}${nowYYMMDDHHMMSS()}`;
}

function isValidEmail(t) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function isValidPhone(t) {
    return /^\+\d{8,15}$/.test(t);
}

console.log("✅ CHUNK 1 loaded.");

// ================================================================
// CHUNK 2 — USER SESSION SYSTEM + AIRPORT + DATE HELPERS + BACKUP
// ================================================================

// ------ In-memory user sessions ------
const userSessions = {};

// Airport cleanup
function normalizeAirportName(str = "") {
    return String(str)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " ")
        .replace(/\bINTERNATIONAL\b/g, "")
        .replace(/\bINTL\b/g, "")
        .replace(/\bAIRPORT\b/g, "")
        .trim();
}

function airportsMatch(a, b) {
    if (!a || !b) return false;
    return normalizeAirportName(a) === normalizeAirportName(b);
}

// Date helpers
function parseDate_ddmmyyyy(txt) {
    const m = moment(txt, "DD-MM-YYYY", true);
    return m.isValid() ? m.toDate() : null;
}

function parseDate_ddmmyy_hhmm(txt) {
    const m = moment(txt, "DD-MM-YY HH:mm", true);
    return m.isValid() ? m.toDate() : null;
}

function todayStart() {
    return moment().startOf("day").toDate();
}

// Weight matching
function isWeightCompatible(senderKg, travelerKg) {
    const s = Number(senderKg), t = Number(travelerKg);
    if (isNaN(s) || isNaN(t)) return false;
    return Math.abs(s - t) <= 2; // ±2 kg rule
}

function areDatesClose(sendDate, depDateTime) {
    const s = moment(sendDate, "DD-MM-YYYY", true);
    const t = moment(depDateTime, "DD-MM-YY HH:mm", true);
    if (!s.isValid() || !t.isValid()) return false;
    return Math.abs(t.startOf("day").diff(s.startOf("day"), "days")) <= 1;
}

// JSON backup
async function backupSenderJSON(doc) {
    const arr = (await fs.readJson(SENDERS_JSON).catch(() => [])) || [];
    arr.push(doc);
    await fs.writeJson(SENDERS_JSON, arr, { spaces: 2 });
}

async function backupTravelerJSON(doc) {
    const arr = (await fs.readJson(TRAVELERS_JSON).catch(() => [])) || [];
    arr.push(doc);
    await fs.writeJson(TRAVELERS_JSON, arr, { spaces: 2 });
}

console.log("✅ CHUNK 2 loaded.");
// ================================================================
// CHUNK 3 — MAIN MENU + START FLOW + HELP/SUPPORT SECTION
// ================================================================

const mainMenuKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📦 Send a Package", callback_data: "flow_sender" }],
      [{ text: "🧳 Traveler (carry items)", callback_data: "flow_traveler" }],
      [{ text: "📍 Track Shipment", callback_data: "flow_tracking" }],
      [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
    ]
  }
};

// HELP / SUPPORT
function helpSupportText() {
  return (
    `<b>ℹ️ Help & Support</b>\n\n` +
    `AirDlivers connects <b>senders</b> with <b>verified travelers</b> for safe international package delivery.\n\n` +

    `<b>📞 Support</b>\n` +
    `• Telegram Support Group: <a href="https://t.me/+CAntejDg9plmNWI0">Join Here</a>\n` +
    `• Email: support@airdlivers.com\n\n` +

    `<b>🔐 Privacy Policy (Simple)</b>\n` +
    `• We only collect what is needed for verification (name, phone, email, ID).\n` +
    `• Photos (ID, passport, itinerary) are only for safety.\n` +
    `• We NEVER sell or share your data.\n` +
    `• Admin may view conversations only if suspicious activity is reported.\n\n` +

    `<b>⚠️ Safety Notes</b>\n` +
    `• No illegal or restricted items.\n` +
    `• Travelers MUST verify identity.\n` +
    `• Personal information stays hidden until both sides confirm.\n\n` +

    `<b>🛟 Need Help?</b>\n` +
    `Contact us anytime.`
  );
}

async function showHelpMenu(chatId) {
  await bot.sendMessage(chatId, helpSupportText(), {
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

bot.onText(/\/help|\/privacy/, (msg) => showHelpMenu(msg.chat.id));

// START COMMAND
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // Reset user session
  userSessions[chatId] = null;

  const welcome =
    `<b>👋 Welcome to AirDlivers!</b>\n\n` +
    `We connect <b>Senders</b> with <b>Travelers</b> for fast, reliable, and budget-friendly delivery.\n\n` +
    `Choose an option below to begin.`;

  await bot.sendMessage(chatId, welcome, {
    parse_mode: "HTML",
    ...mainMenuKeyboard
  });
});

console.log("✅ CHUNK 3 loaded.");



// ================================================================
// CHUNK 4 — ADMIN LOGIN SYSTEM
// ================================================================

const adminAuth = {}; 
// adminAuth[userId] = {
//   awaitingPin: boolean,
//   loggedIn: boolean,
//   super: boolean,
//   awaitingSuspendReasonFor: userId|null,
//   awaitingTerminateReasonFor: userId|null
// };

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;

  // SUPER ADMIN bypass
  if (String(adminId) === String(SUPER_ADMIN_ID)) {
    adminAuth[adminId] = {
      loggedIn: true,
      super: true,
      awaitingPin: false
    };
    return bot.sendMessage(chatId, "🧠 Super Admin access granted.");
  }

  // must use admin group
  if (String(chatId) !== String(ADMIN_GROUP_ID))
    return bot.sendMessage(chatId, "🚫 Admin login allowed only in admin group.");

  adminAuth[adminId] = {
    loggedIn: false,
    awaitingPin: true,
    super: false
  };

  await bot.sendMessage(chatId, "🔑 Enter Admin PIN:");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  const text = (msg.text || "").trim();

  if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

  if (!adminAuth[adminId]?.awaitingPin) return;

  if (text === String(ADMIN_PIN)) {
    adminAuth[adminId] = {
      loggedIn: true,
      awaitingPin: false,
      super: false
    };
    return bot.sendMessage(chatId, "✅ Admin login successful.");
  }

  adminAuth[adminId].awaitingPin = false;
  adminAuth[adminId].loggedIn = false;

  await bot.sendMessage(chatId, "❌ Incorrect PIN.");
});

function isAdmin(userId) {
  return (
    adminAuth[userId]?.loggedIn ||
    String(userId) === String(SUPER_ADMIN_ID)
  );
}

console.log("✅ CHUNK 4 loaded.");



// ================================================================
// CHUNK 5 — SUSPEND / UNSUSPEND / TERMINATE SYSTEM
// ================================================================

async function isUserSuspended(userId) {
  const doc = await userControlCol.findOne({ userId: String(userId) });
  return doc?.suspended === true;
}

async function isChatTerminated(userId) {
  const doc = await userControlCol.findOne({ userId: String(userId) });
  return doc?.terminated === true;
}

async function suspendUser(userId, reason = "Violation") {
  await userControlCol.updateOne(
    { userId: String(userId) },
    {
      $set: {
        suspended: true,
        terminated: false,
        reason,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await bot.sendMessage(
    userId,
    `⚠️ <b>Your access has been suspended</b>\nReason: ${escapeHtml(reason)}`,
    { parse_mode: "HTML" }
  );

  await bot.sendMessage(
    ADMIN_GROUP_ID,
    `⚠️ Suspended user <code>${userId}</code>\nReason: ${escapeHtml(reason)}`,
    { parse_mode: "HTML" }
  );
}

async function unsuspendUser(userId) {
  await userControlCol.updateOne(
    { userId: String(userId) },
    { $set: { suspended: false, updatedAt: new Date() } }
  );

  await bot.sendMessage(
    userId,
    `🟢 Your suspension has been removed. Use /start`,
    { parse_mode: "HTML" }
  );

  await bot.sendMessage(
    ADMIN_GROUP_ID,
    `ℹ️ User <code>${userId}</code> unsuspended.`,
    { parse_mode: "HTML" }
  );
}

async function terminateChat(userId, type = "completed", reason = "") {
  let msgOut = "";

  if (type === "completed") {
    msgOut =
      `🎉 <b>Delivery Completed</b>\nThank you for using AirDlivers!\n/start`;
  } else {
    msgOut =
      `🚫 <b>Chat terminated (Suspicious)</b>\nReason: ${escapeHtml(reason)}\n/start`;
  }

  await userControlCol.updateOne(
    { userId: String(userId) },
    {
      $set: {
        terminated: true,
        terminatedReason: msgOut,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await bot.sendMessage(userId, msgOut, { parse_mode: "HTML" });

  await bot.sendMessage(
    ADMIN_GROUP_ID,
    `🛑 Terminated chat of <code>${userId}</code>\nType: ${type}\nReason: ${escapeHtml(reason)}`,
    { parse_mode: "HTML" }
  );
}

bot.onText(/\/suspend (\d+) (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id))
    return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

  await suspendUser(match[1], match[2]);
});

bot.onText(/\/unsuspend (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id))
    return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

  await unsuspendUser(match[1]);
});

bot.onText(/\/terminate (\d+) (completed|suspicious) ?(.*)?/, async (msg, match) => {
  if (!isAdmin(msg.from.id))
    return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

  await terminateChat(match[1], match[2], match[3] || "");
});

// BLOCK SUSPENDED USERS GLOBALLY
bot.on("message", async (msg) => {
  const userId = msg.from.id;
  const txt = msg.text || "";

  if (String(msg.chat.id) === String(ADMIN_GROUP_ID)) return;
  if (txt.startsWith("/start")) return;

  if (await isUserSuspended(userId))
    return bot.sendMessage(userId, "⛔ You are suspended. Contact support.");

  if (await isChatTerminated(userId))
    return bot.sendMessage(userId, "🔴 Chat terminated. Use /start again.");
});

console.log("✅ CHUNK 5 loaded.");
// ================================================================
// CHUNK 6 — INLINE BUTTON HANDLERS (ADMIN CONTROL BUTTONS)
// ================================================================

bot.on("callback_query", async (query) => {
  const data = query.data;
  const adminId = query.from.id;
  const chatId = query.message.chat.id;

  try {
    if (!isAdmin(adminId)) {
      await bot.answerCallbackQuery(query.id, { text: "Not allowed" });
      return;
    }

    // SUSPEND USER
    if (data.startsWith("suspend_user_")) {
      const userId = data.replace("suspend_user_", "");
      adminAuth[adminId] = {
        ...adminAuth[adminId],
        awaitingSuspendReasonFor: userId
      };
      await bot.sendMessage(
        chatId,
        `✍️ Enter reason for suspending <code>${userId}</code>:`,
        { parse_mode: "HTML" }
      );
      return bot.answerCallbackQuery(query.id);
    }

    // UNSUSPEND USER
    if (data.startsWith("unsuspend_user_")) {
      const userId = data.replace("unsuspend_user_", "");
      await unsuspendUser(userId);
      return bot.answerCallbackQuery(query.id, { text: "User unsuspended" });
    }

    // TERMINATE — COMPLETED
    if (data.startsWith("terminate_completed_")) {
      const userId = data.replace("terminate_completed_", "");
      await terminateChat(userId, "completed");
      return bot.answerCallbackQuery(query.id, { text: "Chat marked completed" });
    }

    // TERMINATE — SUSPICIOUS
    if (data.startsWith("terminate_suspicious_")) {
      const userId = data.replace("terminate_suspicious_", "");
      adminAuth[adminId] = {
        ...adminAuth[adminId],
        awaitingTerminateReasonFor: userId
      };
      await bot.sendMessage(
        chatId,
        `🚨 Enter suspicious termination reason for <code>${userId}</code>:`,
        { parse_mode: "HTML" }
      );
      return bot.answerCallbackQuery(query.id);
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error("Callback Error:", err);
  }
});


// ================================================================
// CHUNK 7 — ADMIN REASON INPUT HANDLER
// ================================================================

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  const text = (msg.text || "").trim();

  if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

  // SUSPEND — typed reason
  if (adminAuth[adminId]?.awaitingSuspendReasonFor) {
    const userId = adminAuth[adminId].awaitingSuspendReasonFor;
    await suspendUser(userId, text);
    delete adminAuth[adminId].awaitingSuspendReasonFor;

    return bot.sendMessage(
      chatId,
      `🚫 Suspended <code>${userId}</code>\nReason: ${escapeHtml(text)}`,
      { parse_mode: "HTML" }
    );
  }

  // TERMINATE — typed reason
  if (adminAuth[adminId]?.awaitingTerminateReasonFor) {
    const userId = adminAuth[adminId].awaitingTerminateReasonFor;
    await terminateChat(userId, "suspicious", text);
    delete adminAuth[adminId].awaitingTerminateReasonFor;

    return bot.sendMessage(
      chatId,
      `🛑 Chat terminated for <code>${userId}</code>\nReason: ${escapeHtml(text)}`,
      { parse_mode: "HTML" }
    );
  }
});


// ================================================================
// CHUNK 8 — CONFIRM KEYBOARD
// ================================================================

function confirmKeyboard(role, requestId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Confirm & Submit", callback_data: `confirm_${role}_${requestId}` }],
        [{ text: "❌ Cancel", callback_data: "cancel_flow" }]
      ]
    }
  };
}


// ================================================================
// CHUNK 9 — SENDER FLOW (Full)
// ================================================================
// CHUNK 9 — FINAL SENDER FLOW (ALL STEPS + VALIDATIONS)
// ================================================================

async function handleSenderTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;
    const cleaned = text.trim();

    switch (sess.step) {

        // NAME
        case "sender_name":
            if (cleaned.length < 2)
                return bot.sendMessage(chatId, "❌ Please enter a valid full name.");
            data.name = cleaned;
            sess.step = "sender_phone";
            return bot.sendMessage(chatId, "📞 Enter Phone (Format: +911234567890)");

        // PHONE
        case "sender_phone":
            if (!isValidPhone(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid phone format. Use +911234567890");
            data.phone = cleaned;
            sess.step = "sender_email";
            return bot.sendMessage(chatId, "📧 Enter Email:");

        // EMAIL
        case "sender_email":
            if (!isValidEmail(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid email. Try again.");
            data.email = cleaned;
            sess.step = "pickup_airport";
            return bot.sendMessage(chatId, "🛫 Enter Pickup Airport:");

        // PICKUP AIRPORT
        case "pickup_airport":
            data.pickupAirport = cleaned;
            sess.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        // DESTINATION AIRPORT
        case "destination_airport":
            data.destinationAirport = cleaned;
            sess.step = "weight";
            return bot.sendMessage(chatId, "⚖️ Enter Weight (kg):");

        // WEIGHT
        case "weight":
            const w = Number(cleaned);
            if (isNaN(w) || w <= 0)
                return bot.sendMessage(chatId, "❌ Enter valid weight in kg.");
            data.weight = w;
            sess.step = "category";
            return bot.sendMessage(chatId, "📦 Enter Package Category:");

        // CATEGORY
        case "category":
            data.category = cleaned;
            sess.step = "send_date";
            return bot.sendMessage(chatId, "📅 Enter Send Date (DD-MM-YYYY)");

        // SEND DATE
        case "send_date":
            const sd = parseDate_ddmmyyyy(cleaned);
            if (!sd)
                return bot.sendMessage(chatId, "❌ Invalid date format. Use DD-MM-YYYY.");
            data.sendDate = moment(sd).format("DD-MM-YYYY");
            sess.step = "arrival_date";
            return bot.sendMessage(chatId, "📅 Enter Arrival Date (DD-MM-YYYY)");

        // ARRIVAL DATE
        case "arrival_date":
            const ad = parseDate_ddmmyyyy(cleaned);
            if (!ad)
                return bot.sendMessage(chatId, "❌ Invalid date format.");
            data.arrivalDate = moment(ad).format("DD-MM-YYYY");

            sess.expectingPhoto = "package_photo";
            sess.step = "package_photo";
            return bot.sendMessage(chatId, "📸 Upload Package Photo:");

        // package_photo → handled in photo handler
        case "package_photo":
            return;

        // ID selfie → handled in photo handler
        case "id_selfie":
            return;

        case "optional_notes":
            data.notes = cleaned.toLowerCase() === "none" ? "" : cleaned;

            sess.requestId = makeRequestId("snd");
            sess.step = "sender_confirm";

            let summary =
                `<b>📦 SENDER SUMMARY</b>\n\n` +
                `<b>Request ID:</b> <code>${escapeHtml(sess.requestId)}</code>\n` +
                `<b>Name:</b> ${escapeHtml(data.name)}\n` +
                `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
                `<b>Email:</b> ${escapeHtml(data.email)}\n` +
                `<b>From:</b> ${escapeHtml(data.pickupAirport)}\n` +
                `<b>To:</b> ${escapeHtml(data.destinationAirport)}\n` +
                `<b>Weight:</b> ${escapeHtml(String(data.weight))}kg\n` +
                `<b>Category:</b> ${escapeHtml(data.category)}\n` +
                `<b>Send Date:</b> ${escapeHtml(data.sendDate)}\n` +
                `<b>Arrival Date:</b> ${escapeHtml(data.arrivalDate)}\n`;

            if (data.notes)
                summary += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            return bot.sendMessage(chatId, summary, {
                parse_mode: "HTML",
                ...confirmKeyboard("sender", sess.requestId)
            });

        default:
            return;
    }
}

// ================================================================
// CHUNK 10 — TRAVELER FLOW (Full)
// ================================================================
// CHUNK 10 — FINAL TRAVELER FLOW
// ================================================================

async function handleTravelerTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;
    const cleaned = text.trim();

    switch (sess.step) {

        case "traveler_name":
            if (cleaned.length < 2)
                return bot.sendMessage(chatId, "❌ Enter a valid name.");
            data.name = cleaned;
            sess.step = "traveler_phone";
            return bot.sendMessage(chatId, "📞 Enter Phone (+911234567890)");

        case "traveler_phone":
            if (!isValidPhone(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid phone format.");
            data.phone = cleaned;
            sess.step = "traveler_email";
            return bot.sendMessage(chatId, "📧 Enter Email:");

        case "traveler_email":
            if (!isValidEmail(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid email.");
            data.email = cleaned;
            sess.step = "departure_airport";
            return bot.sendMessage(chatId, "🛫 Enter Departure Airport:");

        case "departure_airport":
            data.departureAirport = cleaned;
            sess.step = "departure_country";
            return bot.sendMessage(chatId, "🌍 Enter Departure Country:");

        case "departure_country":
            data.departureCountry = cleaned;
            sess.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        case "destination_airport":
            data.destinationAirport = cleaned;
            sess.step = "arrival_country";
            return bot.sendMessage(chatId, "🌍 Enter Arrival Country:");

        case "arrival_country":
            data.arrivalCountry = cleaned;
            sess.step = "departure_time";
            return bot.sendMessage(chatId, "⏰ Enter Departure Time (DD-MM-YY HH:mm)");

        case "departure_time":
            const dt = parseDate_ddmmyy_hhmm(cleaned);
            if (!dt)
                return bot.sendMessage(chatId, "❌ Invalid format. Use DD-MM-YY HH:mm");
            data.departureTime = moment(dt).format("DD-MM-YY HH:mm");
            sess.step = "arrival_time";
            return bot.sendMessage(chatId, "⏰ Enter Arrival Time (DD-MM-YY HH:mm)");

        case "arrival_time":
            const at = parseDate_ddmmyy_hhmm(cleaned);
            if (!at)
                return bot.sendMessage(chatId, "❌ Invalid date.");
            data.arrivalTime = moment(at).format("DD-MM-YY HH:mm");
            sess.step = "available_weight";
            return bot.sendMessage(chatId, "⚖️ Enter Available Weight (Max 10kg)");

        case "available_weight":
            const w = Number(cleaned);
            if (isNaN(w) || w <= 0 || w > 10)
                return bot.sendMessage(chatId, "❌ Weight must be between 1–10kg.");
            data.availableWeight = w;
            sess.step = "passport_number";
            return bot.sendMessage(chatId, "🛂 Enter Passport Number:");

        case "passport_number":
            data.passportNumber = cleaned;
            sess.expectingPhoto = "passport_selfie";
            sess.step = "passport_selfie";
            return bot.sendMessage(chatId, "📸 Upload Selfie holding Passport:");

        // passport selfie handled by photo handler
        case "passport_selfie":
            return;

        // itinerary handled by photo handler
        case "itinerary_photo":
            return;

        case "optional_notes":
            data.notes = cleaned.toLowerCase() === "none" ? "" : cleaned;

            sess.requestId = makeRequestId("trv");
            sess.step = "traveler_confirm";

            let summary =
                `<b>🧳 TRAVELER SUMMARY</b>\n\n` +
                `<b>ID:</b> <code>${sess.requestId}</code>\n` +
                `<b>Name:</b> ${escapeHtml(data.name)}\n` +
                `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
                `<b>Email:</b> ${escapeHtml(data.email)}\n` +
                `<b>From:</b> ${escapeHtml(data.departureAirport)} (${escapeHtml(data.departureCountry)})\n` +
                `<b>To:</b> ${escapeHtml(data.destinationAirport)} (${escapeHtml(data.arrivalCountry)})\n` +
                `<b>Dep:</b> ${escapeHtml(data.departureTime)}\n` +
                `<b>Arr:</b> ${escapeHtml(data.arrivalTime)}\n` +
                `<b>Capacity:</b> ${escapeHtml(String(data.availableWeight))}kg\n` +
                `<b>Passport:</b> ${escapeHtml(data.passportNumber)}\n`;

            if (data.notes)
                summary += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            return bot.sendMessage(chatId, summary, {
                parse_mode: "HTML",
                ...confirmKeyboard("traveler", sess.requestId)
            });

        default:
            return;
    }
}

// ================================================================
// CHUNK 11 — PHOTO HANDLER
// ================================================================

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const sess = userSessions[chatId];
  if (!sess) return;

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  if (sess.expectingPhoto === "package_photo") {
    sess.data.packagePhoto = photoId;
    sess.expectingPhoto = "id_selfie";
    sess.step = "id_selfie";
    return bot.sendMessage(chatId, "📸 Upload Selfie holding ID:");
  }

  if (sess.expectingPhoto === "id_selfie") {
    sess.data.idSelfie = photoId;
    sess.step = "optional_notes";
    sess.expectingPhoto = null;
    return bot.sendMessage(chatId, "📝 Add Extra Notes (or type: none):");
  }

  if (sess.expectingPhoto === "passport_selfie") {
    sess.data.passportSelfie = photoId;
    sess.expectingPhoto = "itinerary_photo";
    sess.step = "itinerary_photo";
    return bot.sendMessage(chatId, "📄 Upload Itinerary / Ticket:");
  }

  if (sess.expectingPhoto === "itinerary_photo") {
    sess.data.itinerary = photoId;
    sess.expectingPhoto = null;
    sess.step = "optional_notes";
    return bot.sendMessage(chatId, "📝 Add Extra Notes (or type: none):");
  }
});


// ================================================================
// CHUNK 12 — AUTO MATCHING ENGINE
// ================================================================

async function attemptAutoMatchSender(senderDoc) {
  const matches = await travelersCol
    .find({
      destination: senderDoc.destinationAirport,
      departure: senderDoc.pickupAirport,
      availableWeight: { $gte: senderDoc.weight },
      matchLocked: { $ne: true }
    })
    .toArray();

  if (!matches.length) return;

  const traveller = matches[0];

  await sendersCol.updateOne(
    { requestId: senderDoc.requestId },
    { $set: { pendingMatchWith: traveller.requestId } }
  );

  await travelersCol.updateOne(
    { requestId: traveller.requestId },
    { $set: { pendingMatchWith: senderDoc.requestId } }
  );

  await bot.sendMessage(
    traveller.userId,
    `🔔 A new sender may match your trip!\nUse /start to check.`
  );

  await bot.sendMessage(
    senderDoc.userId,
    `🔔 A traveler is available. Waiting for confirmation...`
  );
}

async function attemptAutoMatchTraveler(travellerDoc) {
  const matches = await sendersCol
    .find({
      pickupAirport: travellerDoc.departure,
      destinationAirport: travellerDoc.destination,
      weight: { $lte: travellerDoc.availableWeight },
      matchLocked: { $ne: true }
    })
    .toArray();

  if (!matches.length) return;

  const sender = matches[0];

  await sendersCol.updateOne(
    { requestId: sender.requestId },
    { $set: { pendingMatchWith: travellerDoc.requestId } }
  );

  await travelersCol.updateOne(
    { requestId: travellerDoc.requestId },
    { $set: { pendingMatchWith: sender.requestId } }
  );

  await bot.sendMessage(
    travellerDoc.userId,
    `🔔 A sender matches your route!`
  );

  await bot.sendMessage(
    sender.userId,
    `🔔 A traveler is available!`
  );
}

console.log("✅ Part 3 loaded.");
// ================================================================
// CHUNK 13 — CONFIRMATION HANDLERS (SENDER / TRAVELER)
// ================================================================

bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  try {
    // -----------------------------
    // CANCEL FLOW
    // -----------------------------
    if (data === "cancel_flow") {
      delete userSessions[chatId];
      await bot.sendMessage(chatId, "❌ Process cancelled.\n/start to begin again.");
      return bot.answerCallbackQuery(query.id);
    }

    // -----------------------------
    // CONFIRM SENDER
    // -----------------------------
    if (data.startsWith("confirm_sender_")) {
      const requestId = data.replace("confirm_sender_", "");
      const sess = userSessions[chatId];
      if (!sess) return;

      const doc = {
        ...sess.data,
        userId,
        role: "sender",
        requestId,
        createdAt: new Date()
      };

      await sendersCol.insertOne(doc);
      await backupSenderJSON(doc);

      await bot.sendMessage(
        chatId,
        `🎉 <b>Your package request is submitted!</b>\nRequest ID: <code>${requestId}</code>\nWe are matching you with travelers.`,
        { parse_mode: "HTML" }
      );

      // Notify admin
      await bot.sendMessage(
        ADMIN_GROUP_ID,
        `📦 <b>New Sender Request</b>\nID: <code>${requestId}</code>\nUser: <code>${userId}</code>`,
        { parse_mode: "HTML" }
      );

      // Auto-match attempt
      await attemptAutoMatchSender(doc);

      delete userSessions[chatId];
      return bot.answerCallbackQuery(query.id);
    }

    // -----------------------------
    // CONFIRM TRAVELER
    // -----------------------------
    if (data.startsWith("confirm_traveler_")) {
      const requestId = data.replace("confirm_traveler_", "");
      const sess = userSessions[chatId];
      if (!sess) return;

      const doc = {
        ...sess.data,
        userId,
        role: "traveler",
        requestId,
        createdAt: new Date()
      };

      await travelersCol.insertOne(doc);
      await backupTravelerJSON(doc);

      await bot.sendMessage(
        chatId,
        `🧳 <b>Your travel details are submitted!</b>\nRequest ID: <code>${requestId}</code>\nWe will match you with senders.`,
        { parse_mode: "HTML" }
      );

      // Notify admin
      await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🧳 <b>New Traveler</b>\nID: <code>${requestId}</code>\nUser: <code>${userId}</code>`,
        { parse_mode: "HTML" }
      );

      // Auto-match attempt
      await attemptAutoMatchTraveler(doc);

      delete userSessions[chatId];
      return bot.answerCallbackQuery(query.id);
    }

    // -----------------------------
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error("Error in confirmation handler:", err);
  }
});


// ================================================================
// CHUNK 14 — ACTIVE MATCH CHAT ROUTING SYSTEM
// ================================================================
// This allows matched Sender & Traveler to chat safely with hidden personal data.

async function getActiveMatch(userId) {
  const s = await sendersCol.findOne({ userId: String(userId), matchLocked: true });
  if (s) return s;
  const t = await travelersCol.findOne({ userId: String(userId), matchLocked: true });
  return t || null;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  // Ignore admin group & /start handled above
  if (String(chatId) === String(ADMIN_GROUP_ID)) return;
  if (text.startsWith("/start")) return;

  // Check suspended or terminated
  if (await isUserSuspended(userId)) {
    return bot.sendMessage(
      chatId,
      `⛔ You are suspended.\nContact support@airdlivers.com`,
      { parse_mode: "HTML" }
    );
  }
  if (await isChatTerminated(userId)) {
    return bot.sendMessage(
      chatId,
      `🔴 Chat terminated.\nUse /start to continue.`,
      { parse_mode: "HTML" }
    );
  }

  // -----------------------------
  // If user is in a MATCHED chat
  // -----------------------------
  const myDoc = await getActiveMatch(userId);
  if (!myDoc) return; // Not matched yet

  const otherCol = myDoc.role === "sender" ? travelersCol : sendersCol;
  const otherDoc = await otherCol.findOne({ requestId: myDoc.matchedWith });

  if (!otherDoc) return;

  // Forward text/photo to matched user
  if (msg.text) {
    await bot.sendMessage(otherDoc.userId, `💬 ${text}`);
  }
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await bot.sendPhoto(otherDoc.userId, fileId);
  }
});


// ================================================================
// CHUNK 15 — RECEIVE MATCH CONFIRMATIONS
// ================================================================

bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  try {
    if (data.startsWith("accept_match_")) {
      const requestId = data.replace("accept_match_", "");
      const isSender = requestId.startsWith("snd");

      const myCol = isSender ? sendersCol : travelersCol;
      const otherCol = isSender ? travelersCol : sendersCol;

      const myDoc = await myCol.findOne({ requestId });
      if (!myDoc) return;

      const otherDoc = await otherCol.findOne({ requestId: myDoc.pendingMatchWith });
      if (!otherDoc) return;

      await myCol.updateOne({ requestId }, { $set: { matchLocked: true, matchedWith: otherDoc.requestId } });
      await otherCol.updateOne({ requestId: otherDoc.requestId }, { $set: { matchLocked: true, matchedWith: myDoc.requestId } });

      await bot.sendMessage(
        userId,
        `✅ <b>Match Confirmed!</b>\nYou can now chat directly.`,
        { parse_mode: "HTML" }
      );

      await bot.sendMessage(
        otherDoc.userId,
        `🔔 Your match confirmed! You can chat now.`,
        { parse_mode: "HTML" }
      );

      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("reject_match_")) {
      const requestId = data.replace("reject_match_", "");
      const isSender = requestId.startsWith("snd");

      const myCol = isSender ? sendersCol : travelersCol;
      const otherCol = isSender ? travelersCol : sendersCol;

      const myDoc = await myCol.findOne({ requestId });
      const otherDoc = await otherCol.findOne({ requestId: myDoc.pendingMatchWith });

      if (myDoc)
        await myCol.updateOne({ requestId }, { $unset: { pendingMatchWith: "" } });
      if (otherDoc)
        await otherCol.updateOne({ requestId: otherDoc.requestId }, { $unset: { pendingMatchWith: "" } });

      await bot.sendMessage(chatId, "❌ Match rejected.");
      await bot.answerCallbackQuery(query.id);

      if (otherDoc) {
        await bot.sendMessage(otherDoc.userId, "⚠️ Your match was rejected. Searching again...");
      }

      return;
    }

  } catch (err) {
    console.error("Match decision error:", err);
  }
});


// ================================================================
// CHUNK 16 — WEBHOOK READY
// ================================================================
console.log("🚀 AirDlivers Bot fully loaded & running via Webhook!");
