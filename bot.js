// ================================================================
//  AirDlivers Telegram Bot (Webhook + Admin + Matching + Chat)
//  CHUNK 1/8 — Imports, ENV, MongoDB, Webhook, Express Server
// ================================================================

import 'dotenv/config';
import TelegramBot from "node-telegram-bot-api";
import express from "express";
import moment from "moment";
import fs from "fs-extra";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ---------------------- __dirname (ESM) ----------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ================================================================
// ENVIRONMENT VARIABLES
// ================================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || "";
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "airdlivers";
const BASE_URL = process.env.RAILWAY_URL || "https://airdlivers-bot-production.up.railway.app";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing in .env");
if (!ADMIN_GROUP_ID) throw new Error("ADMIN_GROUP_ID missing in .env");
if (!ADMIN_PIN) throw new Error("ADMIN_PIN missing in .env");
if (!MONGO_URI) throw new Error("MONGO_URI missing in .env");

// ================================================================
// JSON BACKUP STORAGE (ALWAYS AVAILABLE EVEN IF MONGO FAILS)
// ================================================================
const SENDERS_JSON = join(__dirname, "senders.json");
const TRAVELERS_JSON = join(__dirname, "travelers.json");
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// ================================================================
// MONGO SETUP
// ================================================================
let mongoClient, db, sendersCol, travelersCol;

try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);

    sendersCol = db.collection("senders");
    travelersCol = db.collection("travelers");

    console.log("✅ MongoDB connected successfully");
} catch (err) {
    console.error("❌ MONGO ERROR:", err);
    process.exit(1);
}

// ================================================================
// TELEGRAM BOT (Webhook Only)
// ================================================================
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${BASE_URL}${WEBHOOK_PATH}`;

// Initial webhook set
try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("🔗 Webhook set to:", WEBHOOK_URL);
} catch (err) {
    console.error("❌ Failed to set webhook:", err.message);
}

// ================================================================
// AUTO-RECOVER WEBHOOK (RAILWAY SLEEP FIX)
// ================================================================
async function autoFixWebhook() {
    try {
        const info = await bot.getWebHookInfo();
        if (!info || info.url !== WEBHOOK_URL) {
            console.log("♻️ Webhook mismatch — fixing...");
            await bot.setWebHook(WEBHOOK_URL);
        }
    } catch (err) {
        console.error("Webhook auto-recovery error:", err);
    }
}
setInterval(autoFixWebhook, 15 * 60 * 1000);

// ================================================================
// EXPRESS SERVER — REQUIRED FOR WEBHOOK
// ================================================================
const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => {
    res.send("🌍 AirDlivers Bot is live via webhook.");
});

// Telegram webhook receiver
app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🌍 HTTP server running on port", PORT);
});

// ================================================================
// IN-MEMORY SESSIONS
// ================================================================
export const userSessions = {}; // chatId -> session object
export const adminAuth = {};    // admin login states

// Continue to CHUNK 2…
// ================================================================
// =====================================================================
// CHUNK 2/8 — Utilities, Validators, Suspension System
// =====================================================================

// ------------------------- Basic Helpers -------------------------
function escapeHtml(str = "") {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function nowTimeId() {
    return moment().format("YYMMDDHHmmss");
}

function makeReqId(prefix = "snd") {
    return prefix + nowTimeId();
}

// ------------------------- Validators -------------------------
export function isValidEmail(txt) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(txt || "").trim());
}

export function isValidPhone(txt) {
    return /^\+\d{7,15}$/.test(String(txt || "").trim());
}

export function parseDate_DDMMYYYY(txt) {
    const m = moment(txt, "DD-MM-YYYY", true);
    return m.isValid() ? m.toDate() : null;
}

export function parseDate_DDMMYY_HHMM(txt) {
    const m = moment(txt, "DD-MM-YY HH:mm", true);
    return m.isValid() ? m.toDate() : null;
}

// ------------------------- Airport Matching -------------------------
function normalizeAirport(a = "") {
    return a
        .toUpperCase()
        .trim()
        .replace(/\s+INTERNATIONAL\b/, "")
        .replace(/\s+INTL\b/, "")
        .replace(/\s+AIRPORT\b/, "")
        .replace(/\s+/g, " ");
}

function airportsMatch(a, b) {
    const A = normalizeAirport(a);
    const B = normalizeAirport(b);
    if (!A || !B) return false;
    return A === B;
}

function weightCompatible(senderKG, travelerKG) {
    const diff = Math.abs(Number(senderKG) - Number(travelerKG));
    return diff <= 2;
}

function datesClose(senderDateStr, travelerDepStr) {
    const s = moment(senderDateStr, "DD-MM-YYYY", true);
    const t = moment(travelerDepStr, "DD-MM-YY HH:mm", true);
    if (!s.isValid() || !t.isValid()) return false;
    const d = Math.abs(t.startOf("day").diff(s.startOf("day"), "days"));
    return d <= 1;
}

// ------------------------- JSON Backup -------------------------
async function backupSender(doc) {
    const arr = (await fs.readJson(SENDERS_JSON).catch(() => [])) || [];
    arr.push(doc);
    await fs.writeJson(SENDERS_JSON, arr, { spaces: 2 });
}

async function backupTraveler(doc) {
    const arr = (await fs.readJson(TRAVELERS_JSON).catch(() => [])) || [];
    arr.push(doc);
    await fs.writeJson(TRAVELERS_JSON, arr, { spaces: 2 });
}

// =====================================================================
//  🔥 USER SUSPENSION SYSTEM (NEW FEATURE)
// =====================================================================

// Mongo collection for suspended users
const suspendedCol = db.collection("suspendedUsers");

/*
    Suspension Flow:
    - User cannot use ANY bot function except:
        • /help
        • /privacy
        • Contact support email
    - They CANNOT:
        • Start flows
        • Use inline buttons
        • Send photos
        • Submit requests
    - They CAN:
        • Receive explanation message
        • Read instructions
*/

// Add user to suspension list
export async function suspendUser(userId, reason = "No reason") {
    await suspendedCol.updateOne(
        { userId },
        {
            $set: {
                userId,
                reason,
                suspendedAt: new Date(),
                active: true
            }
        },
        { upsert: true }
    );
}

// Remove user from suspension list
export async function unsuspendUser(userId) {
    await suspendedCol.updateOne(
        { userId },
        { $set: { active: false, unsuspendedAt: new Date() } }
    );
}

// Check if user is suspended
export async function isSuspended(userId) {
    const doc = await suspendedCol.findOne({ userId, active: true });
    return !!doc;
}

// Automatic blocker
export async function blockIfSuspended(bot, msg) {
    const chatId = msg.chat.id;
    const suspended = await isSuspended(chatId);

    if (!suspended) return false;

    // Only allow Help/Support
    if (msg.text && msg.text.startsWith("/help")) return false;
    if (msg.text && msg.text.startsWith("/privacy")) return false;

    await bot.sendMessage(
        chatId,
        `🚫 <b>Your access is suspended</b>\nReason: ${escapeHtml(suspended.reason)}\n\n` +
        `You may contact support at: <b>Hrmailsinfo@gmail.com</b>`,
        { parse_mode: "HTML" }
    );

    return true;
}
// =====================================================================
// CHUNK 3/8 — Keyboards, Help System, Session Storage
// =====================================================================

// -------------------------------
// Inline Keyboards
// -------------------------------

// Sender categories
const categoryKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: "📄 Documents", callback_data: "cat_Documents" },
                { text: "🥇 Gold (with bill)", callback_data: "cat_Gold" }
            ],
            [
                { text: "💊 Medicines (Rx)", callback_data: "cat_Medicines" },
                { text: "👕 Clothes", callback_data: "cat_Clothes" }
            ],
            [
                { text: "🍱 Food (sealed)", callback_data: "cat_Food" },
                { text: "💻 Electronics (with bill)", callback_data: "cat_Electronics" }
            ],
            [
                { text: "🎁 Gifts", callback_data: "cat_Gifts" },
                { text: "⚠️ Prohibited", callback_data: "cat_Prohibited" }
            ]
        ]
    }
};

// Confirm keyboard
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

// Main menu
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📦 Send a Package", callback_data: "flow_sender" }],
            [{ text: "🧳 Traveler (carry while travel)", callback_data: "flow_traveler" }],
            [{ text: "📍 Track Shipment", callback_data: "flow_tracking" }],
            [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
        ]
    }
};

// -------------------------------
// Help & Support System
// -------------------------------
function sendHelp(chatId) {
    const text =
        `<b>📘 How to Use AirDlivers Bot</b>\n\n` +
        `<b>1. Sending Package</b>\n` +
        `• Choose <i>Send a Package</i>\n` +
        `• Fill all details (name, phone, email, airports, dates)\n` +
        `• Upload package photo & ID verification\n\n` +

        `<b>2. Becoming a Traveler</b>\n` +
        `• Choose <i>Traveler</i>\n` +
        `• Fill travel details (flight, airports, passport)\n` +
        `• Upload documents (passport selfie, itinerary)\n\n` +

        `<b>3. Tracking Shipment</b>\n` +
        `• Choose <i>Track Shipment</i>\n` +
        `• Enter the phone number used during registration\n\n` +

        `<b>4. Support</b>\n` +
        `If you already started a service (Sender/Traveler), you may contact admin.\n\n` +

        `<b>📨 Email Support:</b> Hrmailsinfo@gmail.com\n` +
        `<b>🔐 Privacy:</b> We store only necessary details for verification and matching.\n\n` +
        `<b>Use /start anytime to return to the main menu.</b>`;

    bot.sendMessage(chatId, text, { parse_mode: "HTML" });
}

// -------------------------------
// User Sessions
// -------------------------------
/*
session = {
    type: "sender" | "traveler" | "tracking",
    step: "...",
    data: {},
    requestId: "...",
    expectingPhoto: null | "package_photo" | "passport_selfie" | "selfie_id" | "itinerary" | "visa"
}
*/

const userSessions = {}; // Store temporary flows

// Reset user session
function resetSession(chatId) {
    userSessions[chatId] = null;
}

// -------------------------------
// Start Menu Handler
// -------------------------------
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Suspended user check
    if (await blockIfSuspended(bot, msg)) return;

    resetSession(chatId);

    const text =
        `<b>👋 Welcome to AirDlivers!</b>\n\n` +
        `Fast next-day international delivery using passenger luggage space.\nSelect an option below:\n`;

    await bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        ...mainMenu
    });
});

// -------------------------------
// Basic Commands
// -------------------------------
bot.onText(/\/help/, async (msg) => {
    if (await blockIfSuspended(bot, msg)) return;
    sendHelp(msg.chat.id);
});

bot.onText(/\/privacy/, async (msg) => {
    if (await blockIfSuspended(bot, msg)) return;
    bot.sendMessage(
        msg.chat.id,
        `<b>🔐 Privacy Policy</b>\nYour data is used only for verification and matching.\nWe never share or sell your data.\nSupport: Hrmailsinfo@gmail.com`,
        { parse_mode: "HTML" }
    );
});

bot.onText(/\/id/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `🆔 Your Telegram ID: <code>${msg.chat.id}</code>`,
        { parse_mode: "HTML" }
    );
});
// =====================================================================
//  END OF CHUNK 3/8
// =====================================================================
// ================================================================
// CHUNK 4 — CALLBACKS (MAIN MENU, CATEGORY SELECTION, CONFIRMATION)
// ================================================================

bot.on("callback_query", async (query) => {
  try {
    const chatId = query.message.chat.id;
    const data = query.data;

    // ---------------------------
    // 1) MAIN MENU FLOWS
    // ---------------------------
    if (data === "flow_sender") {
      return startSenderFlow(chatId);
    }

    if (data === "flow_traveler") {
      return startTravelerFlow(chatId);
    }

    if (data === "flow_tracking") {
      userSessions[chatId] = { type: "tracking", step: "tracking_phone", data: {} };
      return bot.sendMessage(
        chatId,
        "📍 Enter the phone number used for your shipment (Format: +911234567890):",
        { parse_mode: "HTML" }
      );
    }

    if (data === "flow_help") {
      return showHelpMenu(chatId);
    }

    // ---------------------------
    // 2) CATEGORY SELECTION
    // ---------------------------
    if (data.startsWith("cat_")) {
      const session = userSessions[chatId];

      if (!session || session.type !== "sender" || session.step !== "package_category") {
        return bot.answerCallbackQuery(query.id, {
          text: "❌ Category not expected right now."
        });
      }

      const category = data.replace("cat_", "");

      if (category === "Prohibited") {
        await bot.sendMessage(
          chatId,
          "⚠️ Prohibited items are not allowed.\nChoose a valid category.",
        );
        return bot.sendMessage(chatId, "📦 Select a valid category:", categoryKeyboard);
      }

      session.data.category = category;
      session.step = "package_photo";
      session.expectingPhoto = "package_photo";

      await bot.sendMessage(chatId, "📸 Upload Package Photo (mandatory):");

      return bot.answerCallbackQuery(query.id);
    }

    // ---------------------------
    // 3) CONFIRMATION HANDLERS
    // ---------------------------
    if (data.startsWith("confirm_")) {
      const parts = data.split("_"); // confirm_yes_sender_ID
      const decision = parts[1];
      const role = parts[2];
      const requestId = parts.slice(3).join("_");

      const session = userSessions[chatId];

      if (!session || session.requestId !== requestId) {
        return bot.answerCallbackQuery(query.id, {
          text: "❌ Session expired. Please restart."
        });
      }

      if (decision === "no") {
        userSessions[chatId] = null;

        await bot.sendMessage(chatId, "❌ Submission cancelled. Use /start to begin again.");

        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
          }
        ).catch(() => {});

        return;
      }

      if (decision === "yes") {
        if (role === "sender") {
          return handleFinalSenderSubmit(chatId, session);
        }
        if (role === "traveler") {
          return handleFinalTravelerSubmit(chatId, session);
        }
        return bot.answerCallbackQuery(query.id, { text: "Unknown role." });
      }
    }

    // ---------------------------
    // 4) MATCHING CALLBACKS (SKIP / CONFIRM)
    // ---------------------------
    if (data.startsWith("m_")) {
      return handleMatchCallback(query);
    }

    // ---------------------------
    // 5) ADMIN PANEL CALLBACKS
    // ---------------------------
    if (
      data.startsWith("approve_") ||
      data.startsWith("reject_") ||
      data.startsWith("reason_") ||
      data.startsWith("requestvisa_") ||
      data.startsWith("adm_suspend_") ||
      data.startsWith("adm_unsuspend_") ||
      data.startsWith("adm_terminate_")
    ) {
      return handleAdminActionCallback(query);
    }

    await bot.answerCallbackQuery(query.id, { text: "Received." });
  } catch (err) {
    console.error("callback_query error:", err);
    try {
      await bot.answerCallbackQuery(query.id, { text: "Internal error." });
    } catch (e) {}
  }
});
// ================================================================
// CHUNK 5 — PHOTO HANDLER + TEXT FLOW (Sender & Traveler)
// ================================================================

// ---------------------- PHOTO HANDLER ----------------------
bot.on("photo", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];
    const fileId = msg.photo[msg.photo.length - 1].file_id;

    if (session) {
      // ---------------- SENDER PHOTOS ----------------
      if (session.type === "sender") {
        if (session.expectingPhoto === "package_photo") {
          session.data.packagePhoto = fileId;
          session.expectingPhoto = null;
          session.step = "selfie_id";
          return bot.sendMessage(
            chatId,
            "📸 Upload a selfie holding your ID (passport / license):",
            { parse_mode: "HTML" }
          );
        }
        if (session.expectingPhoto === "selfie_id") {
          session.data.selfieId = fileId;
          session.expectingPhoto = null;
          session.step = "optional_notes";
          return bot.sendMessage(chatId, "📝 Add notes (or type 'None'):");
        }
      }

      // ---------------- TRAVELER PHOTOS ----------------
      if (session.type === "traveler") {
        if (session.expectingPhoto === "passport_selfie") {
          session.data.passportSelfie = fileId;
          session.expectingPhoto = "itinerary_photo";
          session.step = "itinerary_photo";
          return bot.sendMessage(chatId, "📄 Upload your flight itinerary / ticket:");
        }
        if (session.expectingPhoto === "itinerary_photo") {
          session.data.itineraryPhoto = fileId;
          session.expectingPhoto = null;
          session.step = "optional_notes";
          return bot.sendMessage(chatId, "📝 Add notes (or type 'None'):");
        }
        if (session.expectingPhoto === "visa_photo") {
          session.data.visaPhoto = fileId;
          session.expectingPhoto = null;
          session.step = "optional_notes";
          return bot.sendMessage(chatId, "📝 Add notes (or type 'None'):");
        }
      }
    }

    // ---- VISA UPLOAD after admin requests visa ----
    const pendingVisa = await travelersCol.findOne({
      userId: chatId,
      status: "VisaRequested",
    });

    if (pendingVisa) {
      await travelersCol.updateOne(
        { requestId: pendingVisa.requestId },
        {
          $set: {
            "data.visaPhoto": fileId,
            status: "VisaUploaded",
            updatedAt: new Date(),
          },
        }
      );

      await bot.sendPhoto(String(ADMIN_GROUP_ID), fileId, {
        caption: `🛂 Visa uploaded for ${pendingVisa.requestId}`,
      });

      await bot.sendMessage(
        String(ADMIN_GROUP_ID),
        `Admin actions for <code>${pendingVisa.requestId}</code>:`,
        {
          parse_mode: "HTML",
          ...adminActionKeyboardForDoc({
            requestId: pendingVisa.requestId,
            role: "traveler",
            status: "VisaUploaded",
          }),
        }
      );

      return bot.sendMessage(
        chatId,
        "✅ Visa uploaded successfully. Admin will verify.",
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("PHOTO handler error:", err);
  }
});


// ================================================================
// TEXT STEP HANDLERS — SENDER + TRAVELER
// ================================================================

// ---------------------- SENDER FLOW ----------------------
async function handleSenderTextStep(chatId, text) {
  const sess = userSessions[chatId];
  if (!sess) return;
  const data = sess.data;

  switch (sess.step) {
    case "sender_name":
      if (text.length < 2)
        return bot.sendMessage(chatId, "Enter a valid name.");
      data.name = text;
      sess.step = "sender_phone";
      return bot.sendMessage(chatId, "📞 Enter Phone Number (+91xxxx):");

    case "sender_phone":
      if (!isValidPhone(text))
        return bot.sendMessage(chatId, "❌ Invalid phone number.");
      data.phone = text;
      sess.step = "sender_email";
      return bot.sendMessage(chatId, "📧 Enter Email ID:");

    case "sender_email":
      if (!isValidEmail(text))
        return bot.sendMessage(chatId, "❌ Invalid email.");
      data.email = text;
      sess.step = "pickup_airport";
      return bot.sendMessage(chatId, "🛫 Enter Pickup Airport:");

    case "pickup_airport":
      data.pickup = text;
      sess.step = "destination_airport";
      return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

    case "destination_airport":
      data.destination = text;
      sess.step = "package_weight";
      return bot.sendMessage(chatId, "⚖️ Enter Package Weight (Max 10kg):");

    case "package_weight": {
      const w = parseFloat(text);
      if (isNaN(w) || w <= 0 || w > 10)
        return bot.sendMessage(chatId, "⚖️ Weight must be 0.1–10 kg.");
      data.weight = w;
      sess.step = "package_category";
      return bot.sendMessage(chatId, "📦 Select package category:", categoryKeyboard);
    }

    case "send_date": {
      const d = parseDate_ddmmyyyy(text);
      if (!d) return bot.sendMessage(chatId, "❌ Invalid date format.");
      data.sendDate = moment(d).format("DD-MM-YYYY");
      sess.step = "arrival_date";
      return bot.sendMessage(chatId, "📅 Enter Arrival Date (DD-MM-YYYY):");
    }

    case "arrival_date": {
      const d = parseDate_ddmmyyyy(text);
      if (!d) return bot.sendMessage(chatId, "❌ Invalid date format.");
      data.arrivalDate = moment(d).format("DD-MM-YYYY");
      sess.step = "selfie_id";
      sess.expectingPhoto = "selfie_id";
      return bot.sendMessage(chatId, "📸 Upload Selfie holding your ID:");
    }

    case "optional_notes":
      data.notes = text === "None" ? "" : text;
      sess.requestId = makeRequestId("snd");
      sess.step = "confirm_sender";

      const summary =
        `<b>📦 Sender Summary</b>\n\n` +
        `<b>ID:</b> <code>${sess.requestId}</code>\n` +
        `<b>Name:</b> ${escapeHtml(data.name)}\n` +
        `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
        `<b>Email:</b> ${escapeHtml(data.email)}\n` +
        `<b>From:</b> ${escapeHtml(data.pickup)}\n` +
        `<b>To:</b> ${escapeHtml(data.destination)}\n` +
        `<b>Weight:</b> ${data.weight} kg\n` +
        `<b>Send:</b> ${data.sendDate}\n` +
        `<b>Arrival:</b> ${data.arrivalDate}\n` +
        (data.notes ? `<b>Notes:</b> ${escapeHtml(data.notes)}` : "");

      return bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("sender", sess.requestId),
      });
  }
}


// ---------------------- TRAVELER FLOW ----------------------
async function handleTravelerTextStep(chatId, text) {
  const sess = userSessions[chatId];
  if (!sess) return;

  const data = sess.data;

  switch (sess.step) {
    case "traveler_name":
      if (text.length < 2)
        return bot.sendMessage(chatId, "Enter valid full name.");
      data.name = text;
      sess.step = "traveler_phone";
      return bot.sendMessage(chatId, "📞 Enter Phone Number (+91xxxx):");

    case "traveler_phone":
      if (!isValidPhone(text))
        return bot.sendMessage(chatId, "❌ Invalid phone number.");
      data.phone = text;
      sess.step = "traveler_email";
      return bot.sendMessage(chatId, "📧 Enter Email ID:");

    case "traveler_email":
      if (!isValidEmail(text))
        return bot.sendMessage(chatId, "❌ Invalid email.");
      data.email = text;
      sess.step = "departure_airport";
      return bot.sendMessage(chatId, "🛫 Enter Departure Airport:");

    case "departure_airport":
      data.departure = text;
      sess.step = "departure_country";
      return bot.sendMessage(chatId, "🌍 Enter Departure Country:");

    case "departure_country":
      data.departureCountry = text;
      sess.step = "destination_airport";
      return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

    case "destination_airport":
      data.destination = text;
      sess.step = "arrival_country";
      return bot.sendMessage(chatId, "🌍 Enter Arrival Country:");

    case "arrival_country":
      data.arrivalCountry = text;
      sess.step = "departure_time";
      return bot.sendMessage(chatId, "⏰ Enter Departure Time (DD-MM-YY HH:mm):");

    case "departure_time": {
      const d = parseDate_ddmmyy_hhmm(text);
      if (!d) return bot.sendMessage(chatId, "❌ Invalid time format.");
      data.departureTime = moment(d).format("DD-MM-YY HH:mm");
      sess.step = "arrival_time";
      return bot.sendMessage(chatId, "⏰ Enter Arrival Time (DD-MM-YY HH:mm):");
    }

    case "arrival_time": {
      const d = parseDate_ddmmyy_hhmm(text);
      if (!d) return bot.sendMessage(chatId, "❌ Invalid time format.");
      data.arrivalTime = moment(d).format("DD-MM-YY HH:mm");
      sess.step = "available_weight";
      return bot.sendMessage(chatId, "⚖️ Enter Available Weight (Max 10kg):");
    }

    case "available_weight": {
      const w = parseFloat(text);
      if (isNaN(w) || w <= 0 || w > 10)
        return bot.sendMessage(chatId, "Enter 0.1–10 kg weight.");
      data.availableWeight = w;
      sess.step = "passport_number";
      return bot.sendMessage(chatId, "🛂 Enter Passport Number:");
    }

    case "passport_number":
      data.passportNumber = text;
      sess.expectingPhoto = "passport_selfie";
      sess.step = "passport_selfie";
      return bot.sendMessage(chatId, "📸 Upload Passport Selfie:");

    case "optional_notes":
      data.notes = text === "None" ? "" : text;
      sess.requestId = makeRequestId("trv");
      sess.step = "confirm_traveler";

      const summary =
        `<b>🧳 Traveler Summary</b>\n\n` +
        `<b>ID:</b> <code>${sess.requestId}</code>\n` +
        `<b>Name:</b> ${escapeHtml(data.name)}\n` +
        `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
        `<b>Email:</b> ${escapeHtml(data.email)}\n` +
        `<b>From:</b> ${escapeHtml(data.departure)} (${escapeHtml(data.departureCountry)})\n` +
        `<b>To:</b> ${escapeHtml(data.destination)} (${escapeHtml(data.arrivalCountry)})\n` +
        `<b>Weight:</b> ${data.availableWeight} kg\n` +
        `<b>Passport:</b> ${escapeHtml(data.passportNumber)}\n` +
        (data.notes ? `<b>Notes:</b> ${escapeHtml(data.notes)}` : "");

      return bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("traveler", sess.requestId),
      });
  }
}
// ==================================================================
// CHUNK 6 — TRAVELER: FINAL SUMMARY + CONFIRMATION & SUBMIT
// ==================================================================

/**
 * After traveler completes all steps (including passport selfie & itinerary),
 * we build a clean summary and show Confirm / Cancel buttons.
 */
async function sendTravelerFinalSummary(chatId, session) {
    const d = session.data;
    const reqId = session.requestId;

    let summary =
        `<b>🧳 Traveler Summary</b>\n\n` +
        `<b>Request ID:</b> <code>${reqId}</code>\n` +
        `<b>Name:</b> ${escapeHtml(d.name)}\n` +
        `<b>Phone:</b> ${escapeHtml(d.phone)}\n` +
        `<b>Email:</b> ${escapeHtml(d.email)}\n\n` +

        `<b>From:</b> ${escapeHtml(d.departure)} (${escapeHtml(d.departureCountry)})\n` +
        `<b>To:</b> ${escapeHtml(d.destination)} (${escapeHtml(d.arrivalCountry)})\n\n` +

        `<b>Departure:</b> ${escapeHtml(d.departureTime)}\n` +
        `<b>Arrival:</b> ${escapeHtml(d.arrivalTime)}\n\n` +

        `<b>Available Weight:</b> ${escapeHtml(String(d.availableWeight))} kg\n` +
        `<b>Passport No:</b> ${escapeHtml(d.passportNumber)}\n`;

    if (d.notes) {
        summary += `<b>Notes:</b> ${escapeHtml(d.notes)}\n`;
    }

    await bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("traveler", reqId)
    });
}


/**
 * When a traveler presses “Confirm & Submit”
 */
async function handleFinalTravelerSubmit(chatId, session) {
    try {
        const requestId = session.requestId;
        const doc = {
            requestId,
            userId: chatId,
            role: "traveler",
            data: session.data,
            status: "Pending",
            adminNote: "",
            createdAt: new Date(),
            pendingMatchWith: null,
            matchLocked: false,
            matchedWith: null
        };

        await travelersCol.insertOne(doc);

        // JSON backup
        await backupTravelerToJSON(doc);

        await bot.sendMessage(
            chatId,
            `✅ Your travel details have been submitted for admin approval.\n` +
            `Request ID: <code>${escapeHtml(requestId)}</code>`,
            { parse_mode: "HTML" }
        );

        // Send to admin
        let adminText =
            `<b>🧳 New Traveler Request</b>\n` +
            `<b>ID:</b> <code>${requestId}</code>\n` +
            `<b>Name:</b> ${escapeHtml(session.data.name)}\n` +
            `<b>Phone:</b> ${escapeHtml(session.data.phone)}\n` +
            `<b>Email:</b> ${escapeHtml(session.data.email)}\n` +
            `<b>Route:</b> ${escapeHtml(session.data.departure)} → ${escapeHtml(session.data.destination)}\n` +
            `<b>Weight Available:</b> ${escapeHtml(String(session.data.availableWeight))} kg\n` +
            `<b>Passport:</b> ${escapeHtml(session.data.passportNumber)}\n`;

        if (session.data.notes) adminText += `<b>Notes:</b> ${escapeHtml(session.data.notes)}\n`;

        await bot.sendMessage(ADMIN_GROUP_ID, adminText, { parse_mode: "HTML" });

        // Send photos to admin
        if (session.data.passportSelfie) {
            await bot.sendPhoto(ADMIN_GROUP_ID, session.data.passportSelfie, {
                caption: `🪪 Passport Selfie — ${requestId}`
            });
        }
        if (session.data.itinerary) {
            await bot.sendPhoto(ADMIN_GROUP_ID, session.data.itinerary, {
                caption: `📄 Itinerary Photo — ${requestId}`
            });
        }

        // Add action buttons
        await bot.sendMessage(
            ADMIN_GROUP_ID,
            `Admin actions for <code>${requestId}</code>:`,
            { parse_mode: "HTML", ...adminActionKeyboardForDoc(doc) }
        );

        // Clear session
        userSessions[chatId] = null;

    } catch (err) {
        console.error("handleFinalTravelerSubmit error", err);
        await bot.sendMessage(chatId, "❌ Error submitting traveler request. Please try again.", {
            parse_mode: "HTML"
        });
    }
}
// ==================================================================
// CHUNK 7 — MATCHING ENGINE + ADMIN CALLBACKS
// ==================================================================

// -------------------------------------------------------------
// Helper: Build Sender Snapshot
// -------------------------------------------------------------
function buildSenderSnapshot(doc) {
  const d = doc.data || {};
  return {
    requestId: doc.requestId,
    pickup: d.pickup,
    destination: d.destination,
    weight: d.weight,
    sendDate: d.sendDate,
    status: doc.status,
    matchLocked: doc.matchLocked,
    pendingMatchWith: doc.pendingMatchWith || null
  };
}

// -------------------------------------------------------------
// Helper: Build Traveler Snapshot
// -------------------------------------------------------------
function buildTravelerSnapshot(doc) {
  const d = doc.data || {};
  return {
    requestId: doc.requestId,
    departure: d.departure,
    destination: d.destination,
    departureTime: d.departureTime,
    arrivalTime: d.arrivalTime,
    availableWeight: d.availableWeight,
    status: doc.status,
    matchLocked: doc.matchLocked,
    pendingMatchWith: doc.pendingMatchWith || null
  };
}

// -------------------------------------------------------------
// Compatibility Rules
// -------------------------------------------------------------
function compatible(senderSnap, travelerSnap) {
  if (!airportsMatch(senderSnap.pickup, travelerSnap.departure)) return false;
  if (!airportsMatch(senderSnap.destination, travelerSnap.destination)) return false;
  if (!weightCompatible(senderSnap.weight, travelerSnap.availableWeight)) return false;
  if (!datesClose(senderSnap.sendDate, travelerSnap.departureTime)) return false;
  if (senderSnap.matchLocked || travelerSnap.matchLocked) return false;
  return true;
}

// -------------------------------------------------------------
// Send Match Card to Sender
// -------------------------------------------------------------
async function sendMatchCardToSender(senderDoc, travelerDoc) {
  const s = buildSenderSnapshot(senderDoc);
  const t = buildTravelerSnapshot(travelerDoc);
  if (!compatible(s, t)) return;

  const text =
    `<b>🔍 Possible Traveler Match</b>\n\n` +
    `<b>Your Request:</b> <code>${s.requestId}</code>\n` +
    `<b>Route:</b> ${escapeHtml(s.pickup)} → ${escapeHtml(s.destination)}\n` +
    `<b>Package:</b> ${s.weight} kg (${escapeHtml(senderDoc.data.category)})\n` +
    `<b>Send Date:</b> ${s.sendDate}\n\n` +
    `<b>Traveler:</b> <code>${t.requestId}</code>\n` +
    `<b>Route:</b> ${escapeHtml(t.departure)} → ${escapeHtml(t.destination)}\n` +
    `<b>Departure:</b> ${escapeHtml(t.departureTime)}\n` +
    `<b>Available Weight:</b> ${t.availableWeight} kg\n\n` +
    `Confirm if you want to match with this traveler.`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Confirm match", callback_data: `m_s_conf_${s.requestId}_${t.requestId}` },
        ],
        [
          { text: "➡ Skip", callback_data: `m_s_skip_${s.requestId}_${t.requestId}` }
        ]
      ]
    },
    parse_mode: "HTML"
  };

  await bot.sendMessage(senderDoc.userId, text, keyboard);
}


// -------------------------------------------------------------
// Send Match Card to Traveler
// -------------------------------------------------------------
async function sendMatchCardToTraveler(travelerDoc, senderDoc) {
  const t = buildTravelerSnapshot(travelerDoc);
  const s = buildSenderSnapshot(senderDoc);
  if (!compatible(s, t)) return;

  const text =
    `<b>🔍 Possible Sender Match</b>\n\n` +
    `<b>Your Request:</b> <code>${t.requestId}</code>\n` +
    `<b>Route:</b> ${escapeHtml(t.departure)} → ${escapeHtml(t.destination)}\n` +
    `<b>Weight Available:</b> ${t.availableWeight} kg\n\n` +
    `<b>Sender:</b> <code>${s.requestId}</code>\n` +
    `<b>Package:</b> ${s.weight} kg (${escapeHtml(senderDoc.data.category)})\n` +
    `<b>Send Date:</b> ${s.sendDate}\n\n` +
    `Confirm if you want to match with this sender.`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Confirm match", callback_data: `m_t_conf_${t.requestId}_${s.requestId}` }
        ],
        [
          { text: "➡ Skip", callback_data: `m_t_skip_${t.requestId}_${s.requestId}` }
        ]
      ]
    },
    parse_mode: "HTML"
  };

  await bot.sendMessage(travelerDoc.userId, text, keyboard);
}


// -------------------------------------------------------------
// MATCH CONFIRM / SKIP HANDLING
// -------------------------------------------------------------
async function handleMatchCallback(query) {
  const data = query.data; // m_s_conf_A_B
  const parts = data.split("_");

  const side = parts[1];  // 's' | 't'
  const action = parts[2]; // conf | skip
  const reqA = parts[3];
  const reqB = parts[4];

  if (action === "skip") {
    await bot.answerCallbackQuery(query.id, { text: "Skipped." });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }).catch(()=>{});
    return;
  }

  // CONFIRM FLOW
  if (action === "conf") {
    return handleUserMatchConfirm(side, reqA, reqB, query);
  }
}


// -------------------------------------------------------------
// USER MATCH CONFIRMATION LOGIC
// -------------------------------------------------------------
async function handleUserMatchConfirm(side, reqA, reqB, query) {
  const userId = query.from.id;

  const myRole = side === "s" ? "sender" : "traveler";
  const myCol = myRole === "sender" ? sendersCol : travelersCol;
  const otherCol = myRole === "sender" ? travelersCol : sendersCol;

  const myDoc = await myCol.findOne({ requestId: reqA });
  const otherDoc = await otherCol.findOne({ requestId: reqB });

  if (!myDoc || !otherDoc)
    return bot.answerCallbackQuery(query.id, { text: "Match not found." });

  if (String(myDoc.userId) !== String(userId))
    return bot.answerCallbackQuery(query.id, { text: "Not your match card." });

  if (myDoc.matchLocked || otherDoc.matchLocked)
    return bot.answerCallbackQuery(query.id, { text: "Already matched." });

  // FIRST confirmation
  if (!myDoc.pendingMatchWith && !otherDoc.pendingMatchWith) {
    await myCol.updateOne({ requestId: reqA }, { $set: { pendingMatchWith: reqB } });

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }).catch(()=>{});

    await bot.answerCallbackQuery(query.id, { text: "Waiting for other user…" });

    // notify the other user
    if (myRole === "sender")
      await sendMatchCardToTraveler(otherDoc, myDoc);
    else
      await sendMatchCardToSender(otherDoc, myDoc);

    return;
  }

  // SECOND confirmation (Final Match)
  if (otherDoc.pendingMatchWith === reqA) {
    await myCol.updateOne(
      { requestId: reqA },
      { $set: { matchLocked: true, matchedWith: reqB }, $unset: { pendingMatchWith: "" } }
    );
    await otherCol.updateOne(
      { requestId: reqB },
      { $set: { matchLocked: true, matchedWith: reqA }, $unset: { pendingMatchWith: "" } }
    );

    await bot.sendMessage(
      myDoc.userId,
      `🤝 <b>Match Confirmed!</b>\nYou can now chat directly with your match.`,
      { parse_mode: "HTML" }
    );

    await bot.sendMessage(
      otherDoc.userId,
      `🤝 <b>Match Confirmed!</b>\nYou can now chat directly with your match.`,
      { parse_mode: "HTML" }
    );

    await bot.sendMessage(
      ADMIN_GROUP_ID,
      `🤝 Match Finalized\nSender <code>${side === "s" ? reqA : reqB}</code>\nTraveler <code>${side === "s" ? reqB : reqA}</code>`,
      { parse_mode: "HTML" }
    );

    await bot.answerCallbackQuery(query.id, { text: "Match confirmed!" });

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }).catch(()=>{});

    return;
  }

  await bot.answerCallbackQuery(query.id, { text: "Already waiting for match…" });
}


// -------------------------------------------------------------
// ADMIN CALLBACK (APPROVE, REJECT, VISA, SUSPEND,...)
// -------------------------------------------------------------
async function handleAdminActionCallback(query) {
  const data = query.data;
  const adminId = query.from.id;

  const auth = adminAuth[adminId];
  const isSuperAdmin = String(adminId) === String(SUPER_ADMIN_ID);

  if (!isSuperAdmin && !auth?.loggedIn) {
    return bot.answerCallbackQuery(query.id, { text: "Not authorized." });
  }

  if (data.startsWith("approve_")) {
    const reqId = data.replace("approve_", "");
    return processApprove(reqId, adminId, query);
  }

  if (data.startsWith("reject_")) {
    const reqId = data.replace("reject_", "");
    return askRejectReason(reqId, query);
  }

  if (data.startsWith("reason_")) {
    const parts = data.split("_");
    const reasonType = parts[1];
    const reqId = parts.slice(2).join("_");
    return processRejectReasonSubmit(reqId, reasonType, adminId, query);
  }

  if (data.startsWith("requestvisa_")) {
    const reqId = data.replace("requestvisa_", "");
    return processRequestVisa(reqId, adminId, query);
  }

  if (data.startsWith("adm_suspend_")) {
    const userId = Number(data.replace("adm_suspend_", ""));
    await suspendUser(userId, "Violation of rules");
    bot.answerCallbackQuery(query.id, { text: "User suspended." });
    return bot.sendMessage(
      ADMIN_GROUP_ID,
      `🚫 Suspended user <code>${userId}</code>`,
      { parse_mode: "HTML" }
    );
  }

  if (data.startsWith("adm_unsuspend_")) {
    const userId = Number(data.replace("adm_unsuspend_", ""));
    await unsuspendUser(userId);
    bot.answerCallbackQuery(query.id, { text: "User unsuspended." });
    return bot.sendMessage(
      ADMIN_GROUP_ID,
      `🔓 Unsuspended user <code>${userId}</code>`,
      { parse_mode: "HTML" }
    );
  }

  if (data.startsWith("adm_terminate_")) {
    const reqId = data.replace("adm_terminate_", "");
    return processTerminate(reqId, query);
  }
}

// ==================================================================
// END OF CHUNK 7
// ==================================================================
// ==========================================================================
// CHUNK 8/8 — ADMIN ACTIONS + MATCH ENGINE + PRIVATE CHAT + TERMINATION
// ==========================================================================


// ---------------------------------------------------------------
//  ADMIN ACTION CALLBACK ROUTER
// ---------------------------------------------------------------
async function handleAdminActionCallback(query) {
    const fromId = query.from.id;
    const data = query.data;

    // Only SUPER ADMIN or logged-in admin can perform actions
    const isSuper = String(fromId) === String(SUPER_ADMIN_ID);
    const isAdmin = adminAuth[fromId]?.loggedIn;

    if (!isSuper && !isAdmin) {
        return bot.answerCallbackQuery(query.id, { text: "🔐 Not authorized" });
    }

    // ----------- Suspend ----------
    if (data.startsWith("adm_suspend_")) {
        const userId = data.replace("adm_suspend_", "");
        await suspendUser(Number(userId));
        await bot.sendMessage(userId, "🚫 Your access to AirDlivers has been suspended by admin.\nContact support: Hrmailsinfo@gmail.com", { parse_mode: "HTML" });

        await bot.sendMessage(ADMIN_GROUP_ID, `🔨 Suspended user <code>${userId}</code>`, { parse_mode: "HTML" });
        return bot.answerCallbackQuery(query.id, { text: "User suspended" });
    }

    // ----------- Unsuspend ----------
    if (data.startsWith("adm_unsuspend_")) {
        const userId = data.replace("adm_unsuspend_", "");
        await unsuspendUser(Number(userId));
        await bot.sendMessage(userId, "✅ Your access has been restored.\nUse /start to continue.", { parse_mode: "HTML" });

        await bot.sendMessage(ADMIN_GROUP_ID, `♻️ Unsuspended user <code>${userId}</code>`, { parse_mode: "HTML" });
        return bot.answerCallbackQuery(query.id, { text: "User unsuspended" });
    }

    // ----------- Terminate Chat ----------
    if (data.startsWith("adm_terminate_")) {
        const reqId = data.replace("adm_terminate_", "");
        await terminateChat(reqId, fromId, query);
        return;
    }

    // ----------- Approve / Reject / Visa ----------
    if (data.startsWith("approve_")) {
        const reqId = data.replace("approve_", "");
        return processApprove(reqId, fromId, query);
    }

    if (data.startsWith("reject_")) {
        const reqId = data.replace("reject_", "");
        await bot.sendMessage(ADMIN_GROUP_ID, "📝 Send rejection reason (one message):");
        adminAuth[fromId].awaitingCustomReasonFor = reqId;
        return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("requestvisa_")) {
        const reqId = data.replace("requestvisa_", "");
        return processRequestVisa(reqId, fromId, query);
    }

    return bot.answerCallbackQuery(query.id, { text: "Unhandled admin action" });
}


// ==========================================================================
// TERMINATION SYSTEM — ADMIN CAN TERMINATE A MATCHED CHAT
// ==========================================================================
async function terminateChat(reqId, invokedBy, query) {
    let doc = await sendersCol.findOne({ requestId: reqId }) ||
              await travelersCol.findOne({ requestId: reqId });

    if (!doc || !doc.matchedWith) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Not matched" });
    }

    const myCol = doc.role === "sender" ? sendersCol : travelersCol;
    const otherCol = doc.role === "sender" ? travelersCol : sendersCol;

    const otherDoc = await otherCol.findOne({ requestId: doc.matchedWith });

    if (!otherDoc) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Other user missing" });
    }

    // Unlock both
    await myCol.updateOne({ requestId: doc.requestId }, {
        $unset: { matchedWith: "", pendingMatchWith: "", matchLocked: "" },
        $set: { status: "Terminated" }
    });

    await otherCol.updateOne({ requestId: otherDoc.requestId }, {
        $unset: { matchedWith: "", pendingMatchWith: "", matchLocked: "" },
        $set: { status: "Terminated" }
    });

    // Notify users
    await bot.sendMessage(doc.userId,
        "⚠️ Your chat has been terminated by admin.\nIf due to suspicious activity, please restart the service using /start.",
        { parse_mode: "HTML" }
    );

    await bot.sendMessage(otherDoc.userId,
        "⚠️ Your chat has been terminated by admin.\nIf delivery is completed, thank you for using AirDlivers!",
        { parse_mode: "HTML" }
    );

    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🛑 Chat terminated between:\n• <code>${doc.requestId}</code>\n• <code>${otherDoc.requestId}</code>`,
        { parse_mode: "HTML" }
    );

    await bot.answerCallbackQuery(query.id, { text: "Chat terminated" });
}



// ==========================================================================
// MATCHING ENGINE — SEND MATCH CARDS TO BOTH USERS
// ==========================================================================

// Called when admin approves a request
async function triggerMatchingForRequest(role, requestId) {
    try {
        let myDoc =
            role === "sender"
                ? await sendersCol.findOne({ requestId })
                : await travelersCol.findOne({ requestId });

        if (!myDoc || myDoc.status !== "Approved" || myDoc.matchLocked) return;

        // Build snapshot
        const snapSelf = buildSnapshot(myDoc);

        // Opposite type
        const otherCol = role === "sender" ? travelersCol : sendersCol;
        const others = await otherCol.find({ status: "Approved", matchLocked: false }).toArray();

        for (let other of others) {
            const snapOther = buildSnapshot(other);
            if (isCompatible(snapSelf, snapOther)) {
                if (role === "sender") {
                    await sendMatchCardToSender(myDoc, other);
                } else {
                    await sendMatchCardToTraveler(myDoc, other);
                }
            }
        }
    } catch (err) {
        console.error("triggerMatchingForRequest error:", err);
    }
}


// Build minimal snapshot for matching
function buildSnapshot(doc) {
    const d = doc.data;

    return {
        role: doc.role,
        pickup: d.pickup || d.departure,
        destination: d.destination,
        weight: d.weight || d.availableWeight,
        sendDate: d.sendDate,
        departureTime: d.departureTime
    };
}


// Compatibility logic
function isCompatible(a, b) {
    if (!airportsMatch(a.pickup, b.pickup)) return false;
    if (!airportsMatch(a.destination, b.destination)) return false;

    if (!weightCompatible(a.weight, b.weight)) return false;

    if (!datesClose(a.sendDate, b.departureTime)) return false;

    return true;
}


// ==========================================================================
// MATCH CARD BUILDERS (Sender View & Traveler View)
// ==========================================================================
async function sendMatchCardToSender(senderDoc, travelerDoc) {
    const t = travelerDoc.data;

    let text =
        `<b>🔍 Possible Traveler Match</b>\n\n` +
        `<b>Traveler Request:</b> <code>${travelerDoc.requestId}</code>\n` +
        `<b>Route:</b> ${escapeHtml(t.departure)} → ${escapeHtml(t.destination)}\n` +
        `<b>Departure:</b> ${escapeHtml(t.departureTime)}\n` +
        `<b>Capacity:</b> ${escapeHtml(t.availableWeight)} kg\n`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Confirm", callback_data: `m_s_conf_${senderDoc.requestId}_${travelerDoc.requestId}` }],
                [{ text: "➡ Skip", callback_data: `m_s_skip_${senderDoc.requestId}_${travelerDoc.requestId}` }]
            ]
        },
        parse_mode: "HTML"
    };

    await bot.sendMessage(senderDoc.userId, text, keyboard);
}

async function sendMatchCardToTraveler(travelerDoc, senderDoc) {
    const s = senderDoc.data;

    let text =
        `<b>📦 Possible Package Match</b>\n\n` +
        `<b>Sender Request:</b> <code>${senderDoc.requestId}</code>\n` +
        `<b>Route:</b> ${escapeHtml(s.pickup)} → ${escapeHtml(s.destination)}\n` +
        `<b>Weight:</b> ${escapeHtml(s.weight)} kg\n` +
        `<b>Send Date:</b> ${escapeHtml(s.sendDate)}\n`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Confirm", callback_data: `m_t_conf_${travelerDoc.requestId}_${senderDoc.requestId}` }],
                [{ text: "➡ Skip", callback_data: `m_t_skip_${travelerDoc.requestId}_${senderDoc.requestId}` }]
            ]
        },
        parse_mode: "HTML"
    };

    await bot.sendMessage(travelerDoc.userId, text, keyboard);
}



// ==========================================================================
// MATCH CONFIRMATION & LOCKING
// ==========================================================================
async function handleMatchCallback(query) {
    const data = query.data;
    const parts = data.split("_"); // m_s_conf_sender_traveler
    const side = parts[1];         // s / t
    const action = parts[2];       // conf / skip
    const myReqId = parts[3];
    const otherReqId = parts[4];
    const tgId = query.from.id;

    if (action === "skip") {
        bot.answerCallbackQuery(query.id, { text: "Skipped" });
        return;
    }

    const myCol = side === "s" ? sendersCol : travelersCol;
    const otherCol = side === "s" ? travelersCol : sendersCol;

    const me = await myCol.findOne({ requestId: myReqId });
    const other = await otherCol.findOne({ requestId: otherReqId });

    // Safety checks
    if (!me || !other) return bot.answerCallbackQuery(query.id, { text: "❌ No longer available" });
    if (String(me.userId) !== String(tgId)) return bot.answerCallbackQuery(query.id, { text: "❌ Not your card" });

    // Second user confirming
    if (other.pendingMatchWith === myReqId) {
        // Lock match
        await myCol.updateOne({ requestId: myReqId }, {
            $set: { matchLocked: true, matchedWith: otherReqId }
        });
        await otherCol.updateOne({ requestId: otherReqId }, {
            $set: { matchLocked: true, matchedWith: myReqId }
        });

        // Notify both
        await bot.sendMessage(me.userId, "🤝 <b>Match Confirmed!</b>\nYou may now chat securely.", { parse_mode: "HTML" });
        await bot.sendMessage(other.userId, "🤝 <b>Match Confirmed!</b>\nYou may now chat securely.", { parse_mode: "HTML" });

        return bot.answerCallbackQuery(query.id, { text: "Matched!" });
    }

    // First confirmation
    await myCol.updateOne({ requestId: myReqId }, { $set: { pendingMatchWith: otherReqId } });

    return bot.answerCallbackQuery(query.id, { text: "Waiting for other user…" });
}



// ==========================================================================
// PRIVATE CHAT ENGINE — Forwarding Messages Between Matched Users
// ==========================================================================
async function tryForwardChatMessage(chatId, text) {
    // Ignore admin group
    if (String(chatId) === String(ADMIN_GROUP_ID)) return false;

    // Find if this user has a locked match
    let me = await sendersCol.findOne({ userId: chatId, matchLocked: true }) ||
             await travelersCol.findOne({ userId: chatId, matchLocked: true });

    if (!me || !me.matchedWith) return false;

    // Find partner
    const otherCol = me.role === "sender" ? travelersCol : sendersCol;
    const other = await otherCol.findOne({ requestId: me.matchedWith });

    if (!other) return false;

    // Forward message to partner
    await bot.sendMessage(
        other.userId,
        `💬 Message from your match:\n${escapeHtml(text)}`,
        { parse_mode: "HTML" }
    );

    // Also forward to admin
    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `👀 <b>Chat Log</b>\n${me.requestId} → ${other.requestId}\n\n${escapeHtml(text)}`,
        { parse_mode: "HTML" }
    );

    return true;
}



// ==========================================================================
// MESSAGE HANDLER — MUST BE LAST
// ==========================================================================
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    // Block suspended users
    if (await isSuspended(chatId)) {
        if (!["/help", "/privacy"].includes(msg.text)) {
            return bot.sendMessage(chatId, "🚫 You are suspended.\nSupport: Hrmailsinfo@gmail.com", { parse_mode: "HTML" });
        }
    }

    // Handle matched chat
    if (!msg.text?.startsWith("/") && !userSessions[chatId]) {
        const forwarded = await tryForwardChatMessage(chatId, msg.text || "");
        if (forwarded) return;
    }

    // Continue session flows
    const sess = userSessions[chatId];
    if (!sess) return;

    if (sess.type === "sender") return handleSenderTextStep(chatId, msg.text);
    if (sess.type === "traveler") return handleTravelerTextStep(chatId, msg.text);

    if (sess.type === "tracking") {
        const phone = msg.text.trim();
        const doc = await sendersCol.findOne({ "data.phone": phone }) ||
                    await travelersCol.findOne({ "data.phone": phone });

        if (!doc) return bot.sendMessage(chatId, "❌ No record found.");
        return bot.sendMessage(chatId, `📦 Status: <b>${doc.status}</b>`, { parse_mode: "HTML" });
    }
});


// ==========================================================================
// SHUTDOWN HANDLER
// ==========================================================================
process.on("SIGINT", async () => {
    console.log("Shutting down bot…");
    try { await mongoClient.close(); } catch {}
    process.exit(0);
});


console.log("✅ AirDlivers Bot Fully Loaded + CHUNK 8/8");
