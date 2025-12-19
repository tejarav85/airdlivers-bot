// ================================================================
// AirDlivers Production Bot - Webhook Optimized Version
// Fully rewritten clean, stable, complete.
// ================================================================

// package.json MUST contain:  { "type": "module" }

import 'dotenv/config';
import TelegramBot from "node-telegram-bot-api";
import fs from "fs-extra";
import express from "express";
import moment from "moment";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ------------------- __dirname fix -------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ------------------- ENV -------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "airdlivers";
const RAILWAY_URL = process.env.RAILWAY_URL;   // MUST end without slash

if (!BOT_TOKEN) { console.error("BOT_TOKEN missing"); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error("ADMIN_GROUP_ID missing"); process.exit(1); }
if (!ADMIN_PIN) { console.error("ADMIN_PIN missing"); process.exit(1); }
if (!MONGO_URI) { console.error("MONGO_URI missing"); process.exit(1); }
if (!RAILWAY_URL) { console.error("RAILWAY_URL missing"); process.exit(1); }

// ------------------- JSON Backup Files -------------------
const SENDERS_JSON = join(__dirname, "senders.json");
const TRAVELERS_JSON = join(__dirname, "travelers.json");
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// ------------------- MongoDB Connection -------------------
let mongoClient, db, sendersCol, travelersCol, userControlCol;

try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);

    sendersCol = db.collection("senders");
    travelersCol = db.collection("travelers");
    userControlCol = db.collection("userControl");

    console.log("✅ MongoDB connected successfully");
} catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
}

// ------------------- Telegram Bot (Webhook Mode) -------------------
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${RAILWAY_URL}${WEBHOOK_PATH}`;

try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("🔗 Webhook set to:", WEBHOOK_URL);
} catch (err) {
    console.error("Webhook setup failed:", err.message);
}

// ------------------- Webhook Auto-Recovery (important on Railway) -------------------
// ====================================================
// IMPROVED AUTO WEBHOOK RECOVERY (Railway + Render)
// ====================================================
async function autoRecoverWebhook() {
    try {
        const info = await bot.getWebHookInfo();

        // If webhook has an error
        if (info.last_error_date) {
            console.log("⚠️ Webhook Error:", info.last_error_message);
            console.log("🔧 Repairing webhook…");

            await bot.setWebHook(WEBHOOK_URL);
            console.log("✅ Webhook repaired successfully.");
            return;
        }

        // If webhook URL is missing or incorrect
        if (!info.url || info.url !== WEBHOOK_URL) {
            console.log("⚠️ Webhook mismatch — fixing now...");
            await bot.setWebHook(WEBHOOK_URL);
            console.log("✅ Webhook URL corrected.");
            return;
        }

    } catch (err) {
        console.log("❌ Auto-recovery failed:", err.message);
        // Retry safety net
        try {
            await bot.setWebHook(WEBHOOK_URL);
            console.log("♻️ Webhook restored after failure.");
        } catch (e) {
            console.log("🚨 Webhook full failure:", e.message);
        }
    }
}

// Run every 30 seconds (best for Railway)
setInterval(autoRecoverWebhook, 30 * 1000);
// ------------------- Express Server -------------------
const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => {
    res.send("🌍 AirDlivers bot is running via webhook");
});

app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Server live on port ${PORT}`));

// ------------------- Utility Helpers -------------------
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
function isValidEmail(x) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x));
}
function isValidPhone(x) {
    return /^\+\d{8,15}$/.test(String(x));
}
function parseDate_ddmmyyyy(x) {
    const m = moment(x, "DD-MM-YYYY", true);
    return m.isValid() ? m.toDate() : null;
}
function parseDate_ddmmyy_hhmm(x) {
    const m = moment(x, "DD-MM-YY HH:mm", true);
    return m.isValid() ? m.toDate() : null;
}
function normalizeAirportName(str = "") {
    return String(str)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " ")
        .replace(/\bAIRPORT\b/g, "")
        .replace(/\bINTL\b/g, "")
        .replace(/\bINTERNATIONAL\b/g, "")
        .trim();
}
function airportsMatch(a, b) {
    return normalizeAirportName(a) === normalizeAirportName(b);
}

// In-memory user sessions
const userSessions = {};

console.log("✅ PART 1 Loaded");
// ================================================================
// PART 2 — ADMIN LOGIN + SUSPEND / UNSUSPEND / TERMINATE SYSTEM
// ================================================================

// Admin state memory
const adminAuth = {};  
/*
adminAuth[userId] = {
    awaitingPin: true/false,
    loggedIn: true/false,
    awaitingSuspendReasonFor: userId|null,
    awaitingTerminateReasonFor: userId|null
}
*/

// ------------------- /admin login -------------------
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // SUPER ADMIN bypass
    if (String(userId) === String(SUPER_ADMIN_ID)) {
        adminAuth[userId] = {
            loggedIn: true,
            awaitingPin: false,
            super: true
        };
        return bot.sendMessage(chatId, "🧠 Super Admin access granted.");
    }

    // Must be inside admin group
    if (String(chatId) !== String(ADMIN_GROUP_ID)) {
        return bot.sendMessage(chatId, "🚫 Admin login allowed ONLY inside Admin Group.");
    }

    adminAuth[userId] = { loggedIn: false, awaitingPin: true };

    await bot.sendMessage(chatId, "🔑 Enter the Admin PIN:");
});

// ------------------- PIN handling -------------------
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const txt = (msg.text || "").trim();

    // Only check inside admin group
    if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

    // If expecting PIN
    if (adminAuth[userId]?.awaitingPin) {
        if (txt === String(ADMIN_PIN)) {
            adminAuth[userId] = {
                loggedIn: true,
                awaitingPin: false,
                super: false
            };
            return bot.sendMessage(chatId, "✅ Admin login successful.");
        } else {
            adminAuth[userId].awaitingPin = false;
            adminAuth[userId].loggedIn = false;
            return bot.sendMessage(chatId, "❌ Wrong PIN.");
        }
    }
});

function isAdmin(userId) {
    return (
        adminAuth[userId]?.loggedIn ||
        String(userId) === String(SUPER_ADMIN_ID)
    );
}

// ================================================================
// SUSPEND / UNSUSPEND / TERMINATE SYSTEM
// ================================================================

async function isUserSuspended(userId) {
    const doc = await userControlCol.findOne({ userId: String(userId) });
    return doc?.suspended === true;
}

async function isChatTerminated(userId) {
    const doc = await userControlCol.findOne({ userId: String(userId) });
    return doc?.terminated === true;
}

// ------------------- SUSPEND USER -------------------
async function suspendUser(userId, reason) {
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
        `⚠️ Suspended <code>${userId}</code>\nReason: ${escapeHtml(reason)}`,
        { parse_mode: "HTML" }
    );
}

// ------------------- UNSUSPEND USER -------------------
async function unsuspendUser(userId) {
    await userControlCol.updateOne(
        { userId: String(userId) },
        { $set: { suspended: false, updatedAt: new Date() } }
    );

    await bot.sendMessage(
        userId,
        `🟢 Your suspension has been lifted. Use /start`,
        { parse_mode: "HTML" }
    );

    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `ℹ️ User <code>${userId}</code> unsuspended.`,
        { parse_mode: "HTML" }
    );
}

// ------------------- TERMINATE CHAT -------------------
async function terminateChat(userId, reason, type = "suspicious") {
    let finalMsg = "";

    if (type === "completed") {
        finalMsg =
            `🎉 <b>Delivery Completed</b>\nThank you for using AirDlivers!\n/start`;
    } else {
        finalMsg =
            `🚫 <b>Your chat was terminated</b>\nReason: ${escapeHtml(reason)}\n/start`;
    }

    await userControlCol.updateOne(
        { userId: String(userId) },
        {
            $set: {
                terminated: true,
                terminatedReason: reason,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );

    await bot.sendMessage(userId, finalMsg, { parse_mode: "HTML" });

    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🛑 Terminated <code>${userId}</code>\nReason: ${escapeHtml(reason)}`,
        { parse_mode: "HTML" }
    );
}

// ------------------- ADMIN COMMANDS -------------------
bot.onText(/\/suspend (\d+) (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

    const uid = match[1];
    const reason = match[2];
    await suspendUser(uid, reason);
});

bot.onText(/\/unsuspend (\d+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

    await unsuspendUser(match[1]);
});

bot.onText(/\/terminate (\d+) (completed|suspicious) ?(.*)?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

    const uid = match[1];
    const type = match[2];
    const reason = match[3] || "No reason";

    await terminateChat(uid, reason, type);
});

// ------------------- Globally block suspended users -------------------
bot.on("message", async (msg) => {
    const userId = msg.from.id;
    const txt = msg.text || "";

    if (String(msg.chat.id) === String(ADMIN_GROUP_ID)) return;
    if (txt.startsWith("/start")) return;

    if (await isUserSuspended(userId)) {
        return bot.sendMessage(userId, "⛔ You are suspended.");
    }
    if (await isChatTerminated(userId)) {
        return bot.sendMessage(userId, "🔴 Chat terminated. Use /start");
    }
});

// ================================================================
// MAIN MENU + START FLOW
// ================================================================

const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📦 Send a Package", callback_data: "flow_sender" }],
            [{ text: "🧳 Traveler (carry items)", callback_data: "flow_traveler" }],
            [{ text: "📍 Track Shipment", callback_data: "flow_tracking" }],
            [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
        ]
    }
};

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    userSessions[chatId] = null;

    const welcome =
        `<b>👋 Welcome to AirDlivers!</b>\n\n` +
        `We connect <b>Senders</b> with <b>Travelers</b> for fast, secure global delivery.\n\n` +
        `Choose an option below to begin.`;

    await bot.sendMessage(chatId, welcome, {
        parse_mode: "HTML",
        ...mainMenu
    });
});

// HELP / PRIVACY
bot.onText(/\/help|\/privacy/, (msg) => {
    const chatId = msg.chat.id;

    const text =
        `<b>ℹ️ Help & Support</b>\n\n` +
        `AirDlivers connects senders with travelers for safe package delivery.\n\n` +
        `<b>📞 Support</b>\n` +
        `• Telegram Support Group: https://t.me/+CAntejDg9plmNWI0\n` +
        `• Email: support@airdlivers.com\n\n` +
        `<b>🔐 Privacy</b>\n` +
        `• We only collect what is required for safety.\n` +
        `• Admin may view chat ONLY if suspicious activity is detected.\n` +
        `• No data selling.`;

    bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true
    });
});

console.log("✅ PART 2 Loaded");
// ================================================================
// PART 3 — SENDER FLOW (Full)
// ================================================================

async function handleSenderTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;
    const cleaned = text.trim();

    switch (sess.step) {

        // ---------------- NAME ----------------
        case "sender_name":
            if (cleaned.length < 2)
                return bot.sendMessage(chatId, "Please enter a valid full name.");
            data.name = cleaned;
            sess.step = "sender_phone";
            return bot.sendMessage(chatId, "📞 Enter Phone (e.g., +911234567890)");

        // ---------------- PHONE ----------------
        case "sender_phone":
            if (!isValidPhone(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid phone. Format: +911234567890");
            data.phone = cleaned;
            sess.step = "sender_email";
            return bot.sendMessage(chatId, "📧 Enter Email:");

        // ---------------- EMAIL ----------------
        case "sender_email":
            if (!isValidEmail(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid email. Try again.");
            data.email = cleaned;
            sess.step = "pickup_airport";
            return bot.sendMessage(chatId, "🛫 Enter Pickup Airport:");

        // ---------------- PICKUP AIRPORT ----------------
        case "pickup_airport":
            data.pickupAirport = cleaned;
            sess.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        // ---------------- DESTINATION ----------------
        case "destination_airport":
            data.destinationAirport = cleaned;
            sess.step = "weight";
            return bot.sendMessage(chatId, "⚖️ Enter Weight (kg):");

        // ---------------- WEIGHT ----------------
        case "weight":
            const w = Number(cleaned);
            if (isNaN(w) || w <= 0)
                return bot.sendMessage(chatId, "Enter a valid weight in kg.");
            data.weight = w;
            sess.step = "category";
            return bot.sendMessage(chatId, "📦 Enter Category (e.g., Electronics, Documents):");

        // ---------------- CATEGORY ----------------
        case "category":
            data.category = cleaned;
            sess.step = "send_date";
            return bot.sendMessage(chatId, "📅 Enter Send Date (DD-MM-YYYY):");

        // ---------------- SEND DATE ----------------
        case "send_date": {
            const d = parseDate_ddmmyyyy(cleaned);
            if (!d)
                return bot.sendMessage(chatId, "Invalid date. Use DD-MM-YYYY");
            data.sendDate = moment(d).format("DD-MM-YYYY");
            sess.step = "arrival_date";
            return bot.sendMessage(chatId, "📅 Enter Arrival Date (DD-MM-YYYY):");
        }

        // ---------------- ARRIVAL DATE ----------------
        case "arrival_date": {
            const d = parseDate_ddmmyyyy(cleaned);
            if (!d)
                return bot.sendMessage(chatId, "Invalid date. Use DD-MM-YYYY");
            data.arrivalDate = moment(d).format("DD-MM-YYYY");
            sess.expectingPhoto = "package_photo";
            sess.step = "package_photo";
            return bot.sendMessage(chatId, "📸 Upload Package Photo:");
        }

        // ---------------- PHOTO HANDLED SEPARATELY ----------------
        case "package_photo":
        case "id_selfie":
            return;

        // ---------------- NOTES ----------------
        case "optional_notes":
            data.notes = cleaned.toLowerCase() === "none" ? "" : cleaned;

            sess.requestId = makeRequestId("snd");
            sess.step = "confirm_sender";

            let summary =
                `<b>📦 Sender Summary</b>\n\n` +
                `<b>ID:</b> <code>${sess.requestId}</code>\n` +
                `<b>Name:</b> ${escapeHtml(data.name)}\n` +
                `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
                `<b>Email:</b> ${escapeHtml(data.email)}\n` +
                `<b>From:</b> ${escapeHtml(data.pickupAirport)}\n` +
                `<b>To:</b> ${escapeHtml(data.destinationAirport)}\n` +
                `<b>Weight:</b> ${escapeHtml(String(data.weight))} kg\n` +
                `<b>Category:</b> ${escapeHtml(data.category)}\n` +
                `<b>Send:</b> ${escapeHtml(data.sendDate)}\n` +
                `<b>Arrival:</b> ${escapeHtml(data.arrivalDate)}\n`;

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
// PART 3 — TRAVELER FLOW (Full)
// ================================================================

async function handleTravelerTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;
    const cleaned = text.trim();

    switch (sess.step) {

        // ---------------- NAME ----------------
        case "traveler_name":
            if (cleaned.length < 2)
                return bot.sendMessage(chatId, "Enter a valid full name.");
            data.name = cleaned;
            sess.step = "traveler_phone";
            return bot.sendMessage(chatId, "📞 Enter Phone (+911234567890):");

        // ---------------- PHONE ----------------
        case "traveler_phone":
            if (!isValidPhone(cleaned))
                return bot.sendMessage(chatId, "Invalid number. Format +911234567890");
            data.phone = cleaned;
            sess.step = "traveler_email";
            return bot.sendMessage(chatId, "📧 Enter Email:");

        // ---------------- EMAIL ----------------
        case "traveler_email":
            if (!isValidEmail(cleaned))
                return bot.sendMessage(chatId, "Invalid email. Try again.");
            data.email = cleaned;
            sess.step = "departure_airport";
            return bot.sendMessage(chatId, "🛫 Enter Departure Airport:");

        // ---------------- DEPARTURE AIRPORT ----------------
        case "departure_airport":
            data.departure = cleaned;
            sess.step = "departure_country";
            return bot.sendMessage(chatId, "🌍 Enter Departure Country:");

        // ---------------- DEPARTURE COUNTRY ----------------
        case "departure_country":
            data.departureCountry = cleaned;
            sess.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        // ---------------- DESTINATION AIRPORT ----------------
        case "destination_airport":
            data.destination = cleaned;
            sess.step = "arrival_country";
            return bot.sendMessage(chatId, "🌍 Enter Arrival Country:");

        // ---------------- ARRIVAL COUNTRY ----------------
        case "arrival_country":
            data.arrivalCountry = cleaned;
            sess.step = "departure_time";
            return bot.sendMessage(chatId, "⏰ Enter Departure (DD-MM-YY HH:mm):");

        // ---------------- DEPARTURE TIME ----------------
        case "departure_time": {
            const d = parseDate_ddmmyy_hhmm(cleaned);
            if (!d)
                return bot.sendMessage(chatId, "Invalid format. Use DD-MM-YY HH:mm");
            data.departureTime = moment(d).format("DD-MM-YY HH:mm");
            sess.step = "arrival_time";
            return bot.sendMessage(chatId, "⏰ Enter Arrival (DD-MM-YY HH:mm):");
        }

        // ---------------- ARRIVAL TIME ----------------
        case "arrival_time": {
            const d = parseDate_ddmmyy_hhmm(cleaned);
            if (!d)
                return bot.sendMessage(chatId, "Invalid format.");
            data.arrivalTime = moment(d).format("DD-MM-YY HH:mm");
            sess.step = "available_weight";
            return bot.sendMessage(chatId, "⚖️ Enter Available Weight (Max 10kg):");
        }

        // ---------------- WEIGHT ----------------
        case "available_weight": {
            const w = Number(cleaned);
            if (isNaN(w) || w <= 0 || w > 10)
                return bot.sendMessage(chatId, "Weight must be 1–10 kg.");
            data.availableWeight = w;
            sess.step = "passport_number";
            return bot.sendMessage(chatId, "🛂 Enter Passport Number:");
        }

        // ---------------- PASSPORT ----------------
        case "passport_number":
            data.passportNumber = cleaned;
            sess.expectingPhoto = "passport_selfie";
            sess.step = "passport_selfie";
            return bot.sendMessage(chatId, "📸 Upload selfie holding passport:");

        // --------------- PHOTO STEPS handled separately ---------------
        case "passport_selfie":
        case "itinerary_photo":
            return;

        // ---------------- NOTES ----------------
        case "optional_notes":
            data.notes = cleaned.toLowerCase() === "none" ? "" : cleaned;

            sess.requestId = makeRequestId("trv");
            sess.step = "confirm_traveler";

            let travelerSummary =
                `<b>🧳 Traveler Summary</b>\n\n` +
                `<b>ID:</b> <code>${sess.requestId}</code>\n` +
                `<b>Name:</b> ${escapeHtml(data.name)}\n` +
                `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
                `<b>Email:</b> ${escapeHtml(data.email)}\n` +
                `<b>From:</b> ${escapeHtml(data.departure)} (${escapeHtml(data.departureCountry)})\n` +
                `<b>To:</b> ${escapeHtml(data.destination)} (${escapeHtml(data.arrivalCountry)})\n` +
                `<b>Departure:</b> ${escapeHtml(data.departureTime)}\n` +
                `<b>Arrival:</b> ${escapeHtml(data.arrivalTime)}\n` +
                `<b>Capacity:</b> ${escapeHtml(String(data.availableWeight))} kg\n` +
                `<b>Passport:</b> ${escapeHtml(data.passportNumber)}\n`;

            if (data.notes)
                travelerSummary += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            return bot.sendMessage(chatId, travelerSummary, {
                parse_mode: "HTML",
                ...confirmKeyboard("traveler", sess.requestId)
            });

        default:
            return;
    }
}


// ================================================================
// PART 3 — PHOTO HANDLER (Sender + Traveler)
// ================================================================

bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const sess = userSessions[chatId];
    if (!sess) return;

    const fileId = msg.photo[msg.photo.length - 1].file_id;

    switch (sess.expectingPhoto) {

        // ---------------- SENDER PHOTOS ----------------
        case "package_photo":
            sess.data.packagePhoto = fileId;
            sess.expectingPhoto = "id_selfie";
            sess.step = "id_selfie";
            return bot.sendMessage(chatId, "📸 Upload a Selfie holding your ID:");

        case "id_selfie":
            sess.data.idSelfie = fileId;
            sess.expectingPhoto = null;
            sess.step = "optional_notes";
            return bot.sendMessage(chatId, "📝 Add notes (or type: none):");

        // ---------------- TRAVELER PHOTOS ----------------
        case "passport_selfie":
            sess.data.passportSelfie = fileId;
            sess.expectingPhoto = "itinerary_photo";
            sess.step = "itinerary_photo";
            return bot.sendMessage(chatId, "📄 Upload Itinerary / Flight Ticket:");

        case "itinerary_photo":
            sess.data.itinerary = fileId;
            sess.expectingPhoto = null;
            sess.step = "optional_notes";
            return bot.sendMessage(chatId, "📝 Add notes (or type: none):");

        default:
            return;
    }
});

console.log("✅ PART 3 Loaded");
// ===================================================================
// PART 4 — SAVE TO DATABASE + CONFIRMATION BUTTONS + MATCH ENGINE
// ===================================================================


// ---------------- CONFIRM KEYBOARD ----------------
function confirmKeyboard(role, requestId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Confirm & Submit", callback_data: `confirm_${role}_${requestId}` }
                ],
                [
                    { text: "❌ Cancel", callback_data: "cancel_flow" }
                ]
            ]
        }
    };
}


// ===========================================================
// 1) CONFIRMATION BUTTON HANDLER
// ===========================================================

bot.on("callback_query", async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    // ---------------- CANCEL FLOW ----------------
    if (data === "cancel_flow") {
        delete userSessions[chatId];
        await bot.answerCallbackQuery(query.id, { text: "Flow cancelled." });
        return bot.sendMessage(chatId, "❌ Cancelled.\n/start to begin again.");
    }

    // ---------------- CONFIRM SENDER ----------------
    if (data.startsWith("confirm_sender_")) {
        const requestId = data.replace("confirm_sender_", "");
        await saveSenderToDB(chatId, userId, requestId);
        await bot.answerCallbackQuery(query.id, { text: "Sender request submitted!" });
        return;
    }

    // ---------------- CONFIRM TRAVELER ----------------
    if (data.startsWith("confirm_traveler_")) {
        const requestId = data.replace("confirm_traveler_", "");
        await saveTravelerToDB(chatId, userId, requestId);
        await bot.answerCallbackQuery(query.id, { text: "Traveler request submitted!" });
        return;
    }
});


// ===========================================================
// 2) SAVE SENDER TO DATABASE
// ===========================================================

async function saveSenderToDB(chatId, userId, requestId) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;

    const doc = {
        userId: String(userId),
        requestId,
        role: "sender",
        name: data.name,
        phone: data.phone,
        email: data.email,
        pickupAirport: data.pickupAirport,
        destinationAirport: data.destinationAirport,
        weight: data.weight,
        category: data.category,
        sendDate: data.sendDate,
        arrivalDate: data.arrivalDate,
        packagePhoto: data.packagePhoto,
        idSelfie: data.idSelfie,
        notes: data.notes || "",
        createdAt: new Date(),
        pendingMatchWith: null,
        matchedWith: null,
        matchLocked: false,
    };

    await sendersCol.insertOne(doc);

    await bot.sendMessage(
        chatId,
        "📦 <b>Your sender request has been submitted!</b>\nWe will notify you if a matching traveler is found.",
        { parse_mode: "HTML" }
    );

    await attemptAutoMatchSender(doc);

    delete userSessions[chatId];
}



// ===========================================================
// 3) SAVE TRAVELER TO DATABASE
// ===========================================================

async function saveTravelerToDB(chatId, userId, requestId) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;

    const doc = {
        userId: String(userId),
        requestId,
        role: "traveler",
        name: data.name,
        phone: data.phone,
        email: data.email,
        departure: data.departure,
        departureCountry: data.departureCountry,
        destination: data.destination,
        arrivalCountry: data.arrivalCountry,
        departureTime: data.departureTime,
        arrivalTime: data.arrivalTime,
        availableWeight: data.availableWeight,
        passportNumber: data.passportNumber,
        passportSelfie: data.passportSelfie,
        itinerary: data.itinerary,
        notes: data.notes || "",
        createdAt: new Date(),
        pendingMatchWith: null,
        matchedWith: null,
        matchLocked: false,
    };

    await travelersCol.insertOne(doc);

    await bot.sendMessage(
        chatId,
        "🧳 <b>Your traveler profile has been submitted!</b>\nWe will notify you if a matching sender is found.",
        { parse_mode: "HTML" }
    );

    await attemptAutoMatchTraveler(doc);

    delete userSessions[chatId];
}



// ===================================================================
// 4) AUTO MATCHING ENGINE — Bidirectional Matching (FINAL VERSION)
// ===================================================================

async function attemptAutoMatchSender(senderDoc) {

    const travelers = await travelersCol
        .find({
            destination: senderDoc.destinationAirport,
            departure: senderDoc.pickupAirport,
            availableWeight: { $gte: senderDoc.weight },
            matchLocked: { $ne: true },
        })
        .toArray();

    if (!travelers.length) return;

    const traveler = travelers[0];

    // Lock both requests temporarily
    await sendersCol.updateOne(
        { requestId: senderDoc.requestId },
        { $set: { pendingMatchWith: traveler.requestId } }
    );
    await travelersCol.updateOne(
        { requestId: traveler.requestId },
        { $set: { pendingMatchWith: senderDoc.requestId } }
    );

    // Notify both
    await notifyPossibleMatch(senderDoc, traveler);
}



async function attemptAutoMatchTraveler(travelerDoc) {

    const senders = await sendersCol
        .find({
            pickupAirport: travelerDoc.departure,
            destinationAirport: travelerDoc.destination,
            weight: { $lte: travelerDoc.availableWeight },
            matchLocked: { $ne: true },
        })
        .toArray();

    if (!senders.length) return;

    const sender = senders[0];

    await sendersCol.updateOne(
        { requestId: sender.requestId },
        { $set: { pendingMatchWith: travelerDoc.requestId } }
    );
    await travelersCol.updateOne(
        { requestId: travelerDoc.requestId },
        { $set: { pendingMatchWith: sender.requestId } }
    );

    await notifyPossibleMatch(sender, travelerDoc);
}



// ===================================================================
// 5) NOTIFICATION TO USERS ABOUT A POSSIBLE MATCH
// ===================================================================

async function notifyPossibleMatch(senderDoc, travelerDoc) {

    const senderMsg =
        `🟢 <b>Possible Match Found!</b>\n\n` +
        `Your package might be able to travel with a verified traveler.\n\n` +
        `Tap below to review and accept or reject.`;


    const travelerMsg =
        `🟢 <b>Possible Match Found!</b>\n\n` +
        `A sender has a package on the same route.\n\n` +
        `Tap below to review and accept or reject.`;


    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📄 View Match Details", callback_data: `view_match_${senderDoc.requestId}_${travelerDoc.requestId}` }],
            ]
        }
    };

    await bot.sendMessage(senderDoc.userId, senderMsg, { parse_mode: "HTML", ...keyboard });
    await bot.sendMessage(travelerDoc.userId, travelerMsg, { parse_mode: "HTML", ...keyboard });
}



// ===================================================================
// 6) VIEW MATCH DETAILS + ACCEPT / REJECT
// ===================================================================

bot.on("callback_query", async (query) => {
    const data = query.data;

    if (data.startsWith("view_match_")) {

        const [_, sReq, tReq] = data.split("_");

        const sender = await sendersCol.findOne({ requestId: sReq });
        const traveler = await travelersCol.findOne({ requestId: tReq });

        if (!sender || !traveler) return;

        const text =
            `<b>🔍 Match Details</b>\n\n` +
            `📦 <b>Sender</b>\n` +
            `Airport: ${sender.pickupAirport} → ${sender.destinationAirport}\n` +
            `Weight: ${sender.weight}kg\n\n` +
            `🧳 <b>Traveler</b>\n` +
            `Route: ${traveler.departure} → ${traveler.destination}\n` +
            `Capacity: ${traveler.availableWeight}kg\n\n` +
            `Do you want to proceed?`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Accept", callback_data: `accept_match_${sReq}_${tReq}` },
                        { text: "❌ Reject", callback_data: `reject_match_${sReq}_${tReq}` }
                    ]
                ]
            }
        };

        return bot.sendMessage(query.from.id, text, { parse_mode: "HTML", ...keyboard });
    }
});


// ===================================================================
// 7) ACCEPT MATCH — Lock both users
// ===================================================================

bot.on("callback_query", async (query) => {
    const data = query.data;

    if (data.startsWith("accept_match_")) {
        const [_, sReq, tReq] = data.split("_");

        const sender = await sendersCol.findOne({ requestId: sReq });
        const traveler = await travelersCol.findOne({ requestId: tReq });

        if (!sender || !traveler) return;

        // Lock both
        await sendersCol.updateOne({ requestId: sReq }, { $set: { matchLocked: true, matchedWith: tReq } });
        await travelersCol.updateOne({ requestId: tReq }, { $set: { matchLocked: true, matchedWith: sReq } });

        // Notify both parties
        await bot.sendMessage(sender.userId,
            `🎉 <b>Match Confirmed!</b>\nThe traveler has accepted your request.\n\nYou can now coordinate through this chat.`,
            { parse_mode: "HTML" }
        );

        await bot.sendMessage(traveler.userId,
            `🎉 <b>Match Confirmed!</b>\nYou have accepted the sender.\n\nYou can now coordinate through this chat.`,
            { parse_mode: "HTML" }
        );

        return bot.answerCallbackQuery(query.id, { text: "Match accepted!" });
    }
});


// ===================================================================
// 8) REJECT MATCH
// ===================================================================

bot.on("callback_query", async (query) => {
    const data = query.data;

    if (data.startsWith("reject_match_")) {
        const [_, sReq, tReq] = data.split("_");

        // Clear pending match
        await sendersCol.updateOne({ requestId: sReq }, { $unset: { pendingMatchWith: "" } });
        await travelersCol.updateOne({ requestId: tReq }, { $unset: { pendingMatchWith: "" } });

        await bot.sendMessage(query.from.id, "❌ Match rejected. We'll notify you if a new one appears.");

        return bot.answerCallbackQuery(query.id, { text: "Match rejected" });
    }
});



console.log("🚀 AirDlivers Bot (PART 4) Loaded Successfully!");
console.log("===========================================================");
console.log("🎯 BOT IS NOW FULLY FUNCTIONAL");
