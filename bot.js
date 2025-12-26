// bot.js - AirDlivers production bot (full version, unified & corrected)

// ============ IMPORTS ============
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import moment from 'moment';
import express from 'express';
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ============ PATH SETUP ============
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============ ENV ============
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || '';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'airdlivers';
const RAILWAY_URL = process.env.RAILWAY_URL;

if (!BOT_TOKEN) { console.error("❌ BOT_TOKEN missing"); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error("❌ ADMIN_GROUP_ID missing"); process.exit(1); }
if (!ADMIN_PIN) { console.error("❌ ADMIN_PIN missing"); process.exit(1); }
if (!MONGO_URI) { console.error("❌ MONGO_URI missing"); process.exit(1); }

// ============ JSON BACKUP FILES ============
const SENDERS_JSON = join(__dirname, "senders.json");
const TRAVELERS_JSON = join(__dirname, "travelers.json");
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// ============ MONGODB ============
let mongoClient = new MongoClient(MONGO_URI);
await mongoClient.connect();
const db = mongoClient.db(MONGO_DB_NAME);

const sendersCol = db.collection("senders");
const travelersCol = db.collection("travelers");
const trackingCol = db.collection("trackingRequests");
const suspendedCol = db.collection("suspendedUsers");

console.log("✅ MongoDB connected");

// ============ WEBHOOK BOT ============
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${RAILWAY_URL}${WEBHOOK_PATH}`;

await bot.setWebHook(WEBHOOK_URL).catch(e =>
  console.error("Webhook error:", e)
);

console.log("🌍 Webhook set to:", WEBHOOK_URL);

// ============ EXPRESS SERVER ============
const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => {
  res.send("🌍 AirDlivers Telegram bot is running (webhook mode).");
});

// webhook endpoint
app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// IMPORTANT FIX FOR RAILWAY (502 error fix)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌍 Server running on port ${PORT}`);
});

// ============ UTILITIES ============
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function nowYYMMDDHHMMSS() {
  return moment().format("YYMMDDHHmmss");
}

function makeRequestId(prefix) {
  return prefix + nowYYMMDDHHMMSS();
}

function isValidPhone(t) {
  return /^\+\d{8,15}$/.test(t);
}
function isValidEmail(t) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function parseDate_ddmmyyyy(s) {
  let m = moment(s, "DD-MM-YYYY", true);
  return m.isValid() ? m.toDate() : null;
}

function todayStart() {
  return moment().startOf("day").toDate();
}

function normalizeAirportName(str = "") {
  return String(str).trim().toUpperCase().replace(/\s+/g, " ");
}

function airportsMatch(a, b) {
  return normalizeAirportName(a) === normalizeAirportName(b);
}

function isWeightCompatible(a, b) {
  return Math.abs(a - b) <= 2;
}

function areDatesClose(s, t) {
  const sd = moment(s, "DD-MM-YYYY");
  const td = moment(t, "DD-MM-YY HH:mm");
  return Math.abs(td.diff(sd, "days")) <= 1;
}

// ============ BACKUP HELPERS ============
async function backupSenderToJSON(doc) {
  let arr = await fs.readJson(SENDERS_JSON).catch(() => []);
  arr.push(doc);
  await fs.writeJson(SENDERS_JSON, arr, { spaces: 2 });
}
async function backupTravelerToJSON(doc) {
  let arr = await fs.readJson(TRAVELERS_JSON).catch(() => []);
  arr.push(doc);
  await fs.writeJson(TRAVELERS_JSON, arr, { spaces: 2 });
}

// ============ SUSPENSION HELPERS ============
async function suspendUser(userId, reason) {
  await suspendedCol.updateOne(
    { userId },
    { $set: { userId, reason, suspendedAt: new Date() } },
    { upsert: true }
  );
}

async function unsuspendUser(userId) {
  await suspendedCol.deleteOne({ userId });
}

async function isUserSuspended(userId) {
  let doc = await suspendedCol.findOne({ userId });
  return !!doc;
}

// ============ IN-MEMORY SESSIONS ============
const userSessions = {};
const adminAuth = {}; // admin login state

// ============ KEYBOARDS ============
const mainMenuInline = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📦 Send a Package", callback_data: "flow_sender" }],
      [{ text: "🧳 Traveler (carry while travel)", callback_data: "flow_traveler" }],
      [{ text: "📍 Track Shipment", callback_data: "flow_tracking" }],
      [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
    ]
  }
};

const categoryKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📄 Documents", callback_data: "cat_Documents" },
       { text: "🥇 Gold (with bill)", callback_data: "cat_Gold" }],
      [{ text: "💊 Medicines", callback_data: "cat_Medicines" },
       { text: "👕 Clothes", callback_data: "cat_Clothes" }],
      [{ text: "🍱 Food (sealed)", callback_data: "cat_Food" },
       { text: "💻 Electronics", callback_data: "cat_Electronics" }],
      [{ text: "🎁 Gifts", callback_data: "cat_Gifts" },
       { text: "⚠️ Prohibited items", callback_data: "cat_Prohibited" }]
    ]
  }
};

function confirmKeyboard(role, requestId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Confirm & Submit", callback_data: `confirm_yes_${role}_${requestId}` }],
        [{ text: "❌ Cancel", callback_data: `confirm_no_${role}_${requestId}` }]
      ]
    }
  };
}

// ============ START FLOW ============
bot.onText(/\/start/, async msg => {
  const chatId = msg.chat.id;

  if (await isUserSuspended(chatId)) {
    return bot.sendMessage(chatId, "🚫 Your account is suspended.\nContact support@airdlivers.com");
  }

  userSessions[chatId] = null;

  await bot.sendMessage(
    chatId,
    "<b>👋 Welcome to AirDlivers!</b>\nChoose an option below.",
    { parse_mode: "HTML", ...mainMenuInline }
  );
});

// ID command
bot.onText(/\/id/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `Chat ID: <code>${msg.chat.id}</code>`,
    { parse_mode: "HTML" }
  );
});

// help command
bot.onText(/\/help|\/privacy/, msg => showHelpMenu(msg.chat.id));
// 🚨 Guard: expecting photo but user sent text
if (session?.expectingPhoto && msg.text) {
  return bot.sendMessage(
    chatId,
    '📸 Please upload a PHOTO to continue. Text is not accepted for this step.'
  );
}
// ==============================================
// ============ START SENDER FLOW ===============
// ==============================================
function startSenderFlow(chatId) {
  userSessions[chatId] = {
    type: "sender",
    step: "sender_name",
    data: {},
    expectingPhoto: null
  };
  bot.sendMessage(chatId, "👤 Enter your Full Name:");
}

// ==============================================
// ============ START TRAVELER FLOW =============
// ==============================================
function startTravelerFlow(chatId) {
  userSessions[chatId] = {
    type: "traveler",
    step: "traveler_name",
    data: {},
    expectingPhoto: null
  };
  bot.sendMessage(chatId, "👤 Enter your Full Name:");
}

// ==============================================
// ============ HELP MENU =======================
// ==============================================
function showHelpMenu(chatId) {
  const text = `
<b>ℹ️ Help</b>

<b>How to Use:</b>
• Sender → Send a package  
• Traveler → Carry a package while traveling  
• Admin verifies ID & documents  
• Matching connects sender & traveler  
• Chat inside the bot safely

<b>Support:</b>
support@airdlivers.com
`;

  bot.sendMessage(chatId, text, { parse_mode: "HTML" });
}
// ==============================================
// ============ PHOTO HANDLER ===================
// ==============================================
bot.on("photo", async msg => {
  try {
    const chatId = msg.chat.id;

    if (await isUserSuspended(chatId)) {
      return bot.sendMessage(chatId, "🚫 Your account is suspended.");
    }

    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const session = userSessions[chatId];
    if (!session) return;

    const data = session.data;

    // Sender
    if (session.type === "sender") {
      if (session.expectingPhoto === "package_photo") {
        data.packagePhoto = fileId;
        session.expectingPhoto = null;
        session.step = "send_date";
        return bot.sendMessage(chatId, "📅 Enter Send Date (DD-MM-YYYY):");
      }

      if (session.expectingPhoto === "selfie_id") {
        data.selfieId = fileId;
        session.expectingPhoto = null;
        session.step = "optional_notes";
        return bot.sendMessage(chatId, "📝 Add optional notes or type 'None':");
      }
    }

    // Traveler
    if (session.type === "traveler") {
      if (session.expectingPhoto === "passport_selfie") {
        data.passportSelfie = fileId;
        session.expectingPhoto = "itinerary_photo";
        session.step = "itinerary_photo";
        return bot.sendMessage(chatId, "📄 Upload Itinerary Photo:");
      }

      if (session.expectingPhoto === "itinerary_photo") {
        data.itineraryPhoto = fileId;
        session.expectingPhoto = null;
        session.step = "optional_notes";
        return bot.sendMessage(chatId, "📝 Add optional notes or type 'None':");
      }

      if (session.expectingPhoto === "visa_photo") {
        data.visaPhoto = fileId;
        await travelersCol.updateOne(
          { userId: chatId, status: "VisaRequested" },
          {
            $set: { "data.visaPhoto": fileId, status: "VisaUploaded" }
          }
        );
        return bot.sendMessage(chatId, "🛂 Visa received. Admin will verify.");
      }
    }

  } catch (e) {
    console.error("photo handler error:", e);
  }
}
      console.log('PHOTO RECEIVED', {
  chatId,
  expecting: session?.expectingPhoto,
  step: session?.step
}););

// ==============================================
// ============ TEXT FLOW — SENDER ==============
// ==============================================
async function handleSenderTextStep(chatId, text) {
  const s = userSessions[chatId];
  if (!s || s.type !== "sender") return;
  const data = s.data;

  switch (s.step) {
    case "sender_name":
      data.name = text;
      s.step = "sender_phone";
      return bot.sendMessage(chatId, "📞 Enter Phone Number (+911234567890):");

    case "sender_phone":
      if (!isValidPhone(text)) return bot.sendMessage(chatId, "❌ Invalid phone.");
      data.phone = text;
      s.step = "sender_email";
      return bot.sendMessage(chatId, "📧 Enter Email Address:");

    case "sender_email":
      if (!isValidEmail(text)) return bot.sendMessage(chatId, "❌ Invalid email.");
      data.email = text;
      s.step = "pickup";
      return bot.sendMessage(chatId, "📍 Enter Pickup Airport:");

    case "pickup":
      data.pickup = text;
      s.step = "destination";
      return bot.sendMessage(chatId, "🎯 Enter Destination Airport:");

    case "destination":
      data.destination = text;
      s.step = "weight";
      return bot.sendMessage(chatId, "⚖️ Enter Package Weight (kg):");

    case "weight":
      const w = parseFloat(text);
      if (isNaN(w) || w <= 0 || w > 10) {
        return bot.sendMessage(chatId, "❌ Invalid weight (1–10kg allowed).");
      }
      data.weight = w;
      s.step = "package_category";
      return bot.sendMessage(chatId, "📦 Select package category:", categoryKeyboard);

    case "send_date":
      if (!parseDate_ddmmyyyy(text))
        return bot.sendMessage(chatId, "❌ Invalid date format (DD-MM-YYYY).");

      data.sendDate = text;
      s.step = "arrival_date";
      return bot.sendMessage(chatId, "📅 Enter Expected Arrival Date (DD-MM-YYYY):");

    case "arrival_date":
      if (!parseDate_ddmmyyyy(text))
        return bot.sendMessage(chatId, "❌ Invalid date format.");

      data.arrivalDate = text;
      s.step = "selfie_id";
      s.expectingPhoto = "selfie_id";
      return bot.sendMessage(chatId, "📸 Upload selfie holding your ID:");

    case "optional_notes":
      data.notes = text === "None" ? "" : text;
      s.requestId = makeRequestId("snd");

      const summary = `
<b>📦 Sender Summary</b>
<b>Request ID:</b> <code>${s.requestId}</code>
<b>Name:</b> ${escapeHtml(data.name)}
<b>Phone:</b> ${escapeHtml(data.phone)}
<b>Email:</b> ${escapeHtml(data.email)}
<b>Route:</b> ${escapeHtml(data.pickup)} → ${escapeHtml(data.destination)}
<b>Weight:</b> ${data.weight}kg
<b>Send Date:</b> ${escapeHtml(data.sendDate)}
<b>Arrival Date:</b> ${escapeHtml(data.arrivalDate)}
<b>Notes:</b> ${escapeHtml(data.notes)}
      `;

      return bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("sender", s.requestId)
      });

    default:
      return;
  }
}

// ==============================================
// ============ TEXT FLOW — TRAVELER ============
// ==============================================
async function handleTravelerTextStep(chatId, text) {
  const s = userSessions[chatId];
  if (!s || s.type !== "traveler") return;
  const data = s.data;

  switch (s.step) {
    case "traveler_name":
      data.name = text;
      s.step = "traveler_phone";
      return bot.sendMessage(chatId, "📞 Enter Phone Number:");

    case "traveler_phone":
      if (!isValidPhone(text)) return bot.sendMessage(chatId, "❌ Invalid phone.");
      data.phone = text;
      s.step = "traveler_email";
      return bot.sendMessage(chatId, "📧 Enter Email:");

    case "traveler_email":
      if (!isValidEmail(text)) return bot.sendMessage(chatId, "❌ Invalid email.");
      data.email = text;
      s.step = "departure_airport";
      return bot.sendMessage(chatId, "🛫 Departure Airport:");

    case "departure_airport":
      data.departure = text;
      s.step = "departure_country";
      return bot.sendMessage(chatId, "🌍 Departure Country:");

    case "departure_country":
      data.departureCountry = text;
      s.step = "destination_airport";
      return bot.sendMessage(chatId, "🛬 Destination Airport:");

    case "destination_airport":
      data.destination = text;
      s.step = "arrival_country";
      return bot.sendMessage(chatId, "🌍 Arrival Country:");

    case "arrival_country":
      data.arrivalCountry = text;
      s.step = "dep_time";
      return bot.sendMessage(chatId, "⏰ Enter Departure Date & Time (DD-MM-YY HH:mm):");

    case "dep_time": {
      const m = moment(text, "DD-MM-YY HH:mm", true);
      if (!m.isValid()) return bot.sendMessage(chatId, "❌ Invalid format.");
      data.departureTime = text;
      s.step = "arr_time";
      return bot.sendMessage(chatId, "⏰ Enter Arrival Date & Time (DD-MM-YY HH:mm):");
    }

    case "arr_time": {
      const m = moment(text, "DD-MM-YY HH:mm", true);
      if (!m.isValid()) return bot.sendMessage(chatId, "❌ Invalid format.");
      data.arrivalTime = text;
      s.step = "weight";
      return bot.sendMessage(chatId, "⚖️ Available Weight (kg):");
    }

    case "weight": {
      const w = parseFloat(text);
      if (isNaN(w) || w <= 0 || w > 10) return bot.sendMessage(chatId, "❌ Invalid weight (max 10kg).");
      data.availableWeight = w;
      s.step = "passport_number";
      return bot.sendMessage(chatId, "🛂 Passport Number:");
    }

    case "passport_number":
      data.passportNumber = text;
      s.expectingPhoto = "passport_selfie";
      s.step = "passport_selfie";
      return bot.sendMessage(chatId, "📸 Upload a selfie holding your passport:");

    case "optional_notes":
      data.notes = text === "None" ? "" : text;
      s.requestId = makeRequestId("trv");

      let summary = `
<b>🧳 Traveler Summary</b>
<b>Request ID:</b> <code>${s.requestId}</code>
<b>Name:</b> ${escapeHtml(data.name)}
<b>Phone:</b> ${escapeHtml(data.phone)}
<b>Email:</b> ${escapeHtml(data.email)}
<b>Route:</b> ${escapeHtml(data.departure)} → ${escapeHtml(data.destination)}
<b>Departure:</b> ${escapeHtml(data.departureTime)}
<b>Arrival:</b> ${escapeHtml(data.arrivalTime)}
<b>Available Weight:</b> ${escapeHtml(String(data.availableWeight))}kg
<b>Notes:</b> ${escapeHtml(data.notes)}
      `;

      return bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("traveler", s.requestId)
      });

    default:
      return;
  }
}

// ==============================================
// ============ FINAL SUBMIT (SENDER) ===========
// ==============================================
async function handleFinalSenderSubmit(chatId, session) {
  const doc = {
    requestId: session.requestId,
    userId: chatId,
    role: "sender",
    data: session.data,
    status: "Pending",
    createdAt: new Date()
  };

  await sendersCol.insertOne(doc);
  await backupSenderToJSON(doc);

  bot.sendMessage(chatId, `✅ Request submitted.\nRequest ID: <code>${session.requestId}</code>`, {
    parse_mode: "HTML"
  });

  bot.sendMessage(
    ADMIN_GROUP_ID,
    `<b>📦 New Sender Request</b>\nID: <code>${session.requestId}</code>`,
    { parse_mode: "HTML" }
  );

  userSessions[chatId] = null;
}

// ==============================================
// ============ FINAL SUBMIT (TRAVELER) =========
// ==============================================
async function handleFinalTravelerSubmit(chatId, session) {
  const doc = {
    requestId: session.requestId,
    userId: chatId,
    role: "traveler",
    data: session.data,
    status: "Pending",
    createdAt: new Date()
  };

  await travelersCol.insertOne(doc);
  await backupTravelerToJSON(doc);

  bot.sendMessage(chatId, `✅ Request submitted.\nRequest ID: <code>${session.requestId}</code>`, {
    parse_mode: "HTML"
  });

  bot.sendMessage(
    ADMIN_GROUP_ID,
    `<b>🧳 New Traveler Request</b>\nID: <code>${session.requestId}</code>`,
    { parse_mode: "HTML" }
  );

  userSessions[chatId] = null;
}

// ==============================================
// ============ CONFIRMATION CALLBACKS =========
// ==============================================
bot.on("callback_query", async q => {
  const data = q.data;
  const chatId = q.message.chat.id;

  if (await isUserSuspended(chatId)) {
    return bot.answerCallbackQuery(q.id, { text: "🚫 Suspended." });
  }

  if (data === "flow_sender") return startSenderFlow(chatId);
  if (data === "flow_traveler") return startTravelerFlow(chatId);
  if (data === "flow_help") return showHelpMenu(chatId);

  // confirm_yes_sender_xxx
  if (data.startsWith("confirm_yes_sender")) {
    const reqId = data.split("_").pop();
    const s = userSessions[chatId];
    if (s && s.requestId === reqId) {
      await handleFinalSenderSubmit(chatId, s);
    }
    return;
  }

  if (data.startsWith("confirm_yes_traveler")) {
    const reqId = data.split("_").pop();
    const s = userSessions[chatId];
    if (s && s.requestId === reqId) {
      await handleFinalTravelerSubmit(chatId, s);
    }
    return;
  }

  if (data.startsWith("confirm_no_")) {
    userSessions[chatId] = null;
    return bot.sendMessage(chatId, "❌ Cancelled.");
  }

  bot.answerCallbackQuery(q.id);
});

// ==============================================
// ============ GLOBAL MESSAGE HANDLER =========
// ==============================================
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  if (await isUserSuspended(chatId)) {
    return bot.sendMessage(chatId, "🚫 Your account is suspended.");
  }

  const session = userSessions[chatId];
  if (session?.type === "sender") return handleSenderTextStep(chatId, text);
  if (session?.type === "traveler") return handleTravelerTextStep(chatId, text);
});

// ==============================================
// ============ SHUTDOWN HANDLER ===============
// ==============================================
process.on("SIGINT", () => {
  console.log("🛑 Shutting down...");
  mongoClient.close();
  process.exit(0);
});

console.log("🚀 AirDlivers Bot Loaded Successfully!");
