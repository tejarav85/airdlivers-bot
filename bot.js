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
/*
userSessions[chatId] = {
    type: "sender" | "traveler" | "tracking",
    step: "...",
    data: {},
    requestId: "...",
    expectingPhoto: "package_photo" | "passport_selfie" | "itinerary_photo" | null
}
*/
const userSessions = {};


// ==================== AIRPORT NORMALIZATION ====================
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


// ==================== DATE HELPERS ====================
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


// ==================== MATCHING HELPERS ====================
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


// ==================== JSON BACKUP HELPERS ====================
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

// ------------------- MAIN MENU INLINE KEYBOARD -------------------
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


// ------------------- HELP & SUPPORT TEXT -------------------
function showHelpMenu(chatId) {
  const text =
    `<b>ℹ️ Help & Support</b>\n\n` +
    `AirDlivers helps connect <b>senders</b> with <b>verified travelers</b> for fast and secure international package delivery.\n\n` +
    
    `<b>📞 Support</b>\n` +
    `• Telegram Support Group: <a href="https://t.me/+CAntejDg9plmNWI0">Join Here</a>\n` +
    `• Email: support@airdlivers.com\n\n` +

    `<b>🔐 Privacy Policy (Simple)</b>\n` +
    `• We only collect the information needed to verify users (name, phone, email, ID).\n` +
    `• Photos (ID, passport, itinerary) are used only for safety verification.\n` +
    `• We NEVER sell or share your data with third parties.\n` +
    `• Only admin can review chat in case of dispute or suspicious activity.\n\n` +

    `<b>⚠️ Important Safety Notes</b>\n` +
    `• Do NOT send illegal or prohibited items.\n` +
    `• Travelers MUST verify their identity.\n` +
    `• Sender & traveler personal details are hidden until both sides confirm.\n\n` +

    `<b>🛟 Need Help?</b>\n` +
    `Message us anytime or join the support group.`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

bot.onText(/\/help|\/privacy/, (msg) => {
  showHelpMenu(msg.chat.id);
});
// ------------------- SEND HELP MENU -------------------
async function showHelpMenu(chatId) {
    await bot.sendMessage(chatId, helpSupportText(), {
        parse_mode: "HTML",
        disable_web_page_preview: true
    });
}


// ------------------- START COMMAND -------------------
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Reset user session safely
    userSessions[chatId] = null;

    const welcome =
        `<b>👋 Welcome to AirDlivers!</b>\n\n` +
        `We connect <b>Senders</b> with <b>Travelers</b> for fast, safe and affordable international delivery.\n\n` +
        `Choose an option below to get started.`;

    await bot.sendMessage(chatId, welcome, {
        parse_mode: "HTML",
        ...mainMenuKeyboard
    });
});


// ------------------- HELP COMMAND (optional) -------------------
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await showHelpMenu(chatId);
});


// ------------------- PRIVACY COMMAND -------------------
bot.onText(/\/privacy/, async (msg) => {
    const chatId = msg.chat.id;

    const text =
        `<b>🔐 Privacy Policy</b>\n\n` +
        `AirDlivers values your privacy and protection.\n\n` +
        `We only collect the minimum information necessary:` +
        `\n• Name\n• Phone number\n• Email\n• ID verification photos\n• Travel or shipment details\n\n` +
        `This data is <b>not</b> sold or shared outside the platform.\n` +
        `It is used only for verification and matching purposes.\n\n` +
        `For any concerns email: <a href="mailto:support@airdlivers.com">support@airdlivers.com</a>`;

    await bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true
    });
});

console.log("✅ CHUNK 3 loaded.");
// ================================================================
// CHUNK 4 — ADMIN LOGIN SYSTEM (PIN-based + Super Admin)
// ================================================================

// admin state memory
const adminAuth = {}; 
// Structure:
// adminAuth[userId] = {
//   awaitingPin: true/false,
//   loggedIn: true/false,
//   super: true/false,
//   awaitingCustomReasonFor: <requestId|null>
// };


// ------------------- ADMIN LOGIN COMMAND -------------------
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id;

    // SUPER ADMIN LOGIN — bypass PIN
    if (String(adminId) === String(SUPER_ADMIN_ID)) {
        adminAuth[adminId] = {
            loggedIn: true,
            super: true,
            awaitingPin: false,
            awaitingCustomReasonFor: null
        };
        await bot.sendMessage(chatId, '🧠 Super Admin access granted ✅');
        return;
    }

    // Only admin group may log in
    if (String(chatId) !== String(ADMIN_GROUP_ID)) {
        return bot.sendMessage(chatId, '🚫 Admin login allowed only in admin group.');
    }

    // Normal admin login requires PIN
    adminAuth[adminId] = {
        loggedIn: false,
        super: false,
        awaitingPin: true,
        awaitingCustomReasonFor: null
    };

    await bot.sendMessage(chatId, '🔑 Enter Admin PIN:');
});


// ------------------- ADMIN PIN CHECK -------------------
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id;
    const text = msg.text ? msg.text.trim() : "";

    // Only process PIN in admin group
    if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

    // Check if admin is awaiting PIN
    if (!adminAuth[adminId]?.awaitingPin) return;

    // Validate PIN
    if (text === String(ADMIN_PIN)) {
        adminAuth[adminId] = {
            waitingPin: false,
            loggedIn: true,
            super: false,
            awaitingCustomReasonFor: null
        };

        await bot.sendMessage(
            chatId,
            `<b>✅ Admin login successful</b>\nAccess granted to admin <code>${adminId}</code>`,
            { parse_mode: "HTML" }
        );
    } else {
        adminAuth[adminId] = {
            loggedIn: false,
            awaitingPin: false,
            super: false,
            awaitingCustomReasonFor: null
        };

        await bot.sendMessage(chatId, '❌ Incorrect PIN. Access denied.');
    }
});


// ------------------- ADMIN ACCESS CHECK UTILITY -------------------
function isAdmin(userId) {
    return (
        adminAuth[userId]?.loggedIn ||
        String(userId) === String(SUPER_ADMIN_ID)
    );
}

console.log("✅ CHUNK 4 loaded: Admin login system ready.");
// ==================================================================
// CHUNK 5 — SUSPEND / UNSUSPEND / TERMINATE CHAT (MONGODB VERSION)
// ==================================================================

// Mongo collection for user control (suspension + termination)
const userControlCol = db.collection("userControls");


// ------------------- CHECKERS -------------------

// Check if suspended
async function isUserSuspended(userId) {
    const doc = await userControlCol.findOne({ userId: String(userId) });
    return doc?.suspended === true;
}

// Check if chat terminated
async function isChatTerminated(userId) {
    const doc = await userControlCol.findOne({ userId: String(userId) });
    return doc?.terminated === true;
}


// ------------------- ACTIONS -------------------

// Suspend a user
async function suspendUser(userId, reason = "Violation of platform rules") {
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

    // Notify user
    await bot.sendMessage(
        userId,
        `⛔ <b>Your access has been suspended</b>\nReason: ${reason}\n\nIf you think this is a mistake, contact support: support@airdlivers.com`,
        { parse_mode: "HTML" }
    );

    // Notify admin group
    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `⚠️ User <code>${userId}</code> has been <b>SUSPENDED</b>\nReason: ${reason}`,
        { parse_mode: "HTML" }
    );
}


// Unsuspend user
async function unsuspendUser(userId) {
    await userControlCol.updateOne(
        { userId: String(userId) },
        { $set: { suspended: false, updatedAt: new Date() } },
        { upsert: true }
    );

    await bot.sendMessage(
        userId,
        `🟢 <b>Your suspension has been lifted.</b>\nYou may continue using the bot.\nPress /start to begin.`,
        { parse_mode: "HTML" }
    );

    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `ℹ️ User <code>${userId}</code> has been <b>UNSUSPENDED</b>.`,
        { parse_mode: "HTML" }
    );
}


// Terminate chat (Completed or Suspicious)
async function terminateChat(userId, type = "completed", customReason = "") {
    let message = "";

    if (type === "completed") {
        message =
            `🎉 <b>Delivery Completed</b>\n` +
            `Your chat session has been closed.\n\n` +
            `Thank you for using AirDlivers!`;
    } else if (type === "suspicious") {
        message =
            `🚫 <b>Your chat has been terminated due to suspicious activity.</b>\n` +
            `Reason: ${customReason}\n\n` +
            `Please restart using /start`;
    }

    await userControlCol.updateOne(
        { userId: String(userId) },
        {
            $set: {
                terminated: true,
                terminatedReason: message,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );

    // notify user
    await bot.sendMessage(
        userId,
        message + `\n\n➡️ Use /start to begin again.`,
        { parse_mode: "HTML" }
    );

    // notify admin
    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🔴 Chat TERMINATED for <code>${userId}</code>\nReason: ${message}`,
        { parse_mode: "HTML" }
    );
}


// ------------------- ADMIN COMMANDS -------------------

bot.onText(/\/suspend (\d+) (.+)/, async (msg, match) => {
    const adminId = msg.from.id;
    if (!isAdmin(adminId)) return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

    const userId = match[1];
    const reason = match[2];

    await suspendUser(userId, reason);
    bot.sendMessage(msg.chat.id, `⛔ User ${userId} suspended.`);
});

bot.onText(/\/unsuspend (\d+)/, async (msg, match) => {
    const adminId = msg.from.id;
    if (!isAdmin(adminId)) return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

    const userId = match[1];
    await unsuspendUser(userId);
    bot.sendMessage(msg.chat.id, `🟢 User ${userId} unsuspended.`);
});

bot.onText(/\/terminate (\d+) (completed|suspicious) ?(.*)?/, async (msg, match) => {
    const adminId = msg.from.id;
    if (!isAdmin(adminId)) return bot.sendMessage(msg.chat.id, "🔒 Unauthorized.");

    const userId = match[1];
    const type = match[2];
    const reason = match[3] || "";

    await terminateChat(userId, type, reason);
    bot.sendMessage(msg.chat.id, `🔴 User ${userId} chat terminated.`);
});


// ------------------- GLOBAL MESSAGE BLOCKER -------------------

bot.on("message", async (msg) => {
    const userId = msg.from.id;
    const text = msg.text || "";

    // Allow admin group always
    if (String(msg.chat.id) === String(ADMIN_GROUP_ID)) return;

    // Always allow /start (also resets terminated users)
    if (text.startsWith("/start")) return;

    // Block suspended
    if (await isUserSuspended(userId)) {
        return bot.sendMessage(
            userId,
            `⛔ You are suspended.\nContact support: support@airdlivers.com`,
            { parse_mode: "HTML" }
        );
    }

    // Block terminated chat
    if (await isChatTerminated(userId)) {
        return bot.sendMessage(
            userId,
            `🔴 Your chat was terminated.\nUse /start to begin again.`,
            { parse_mode: "HTML" }
        );
    }
});

console.log("✅ CHUNK 5 loaded: Suspend / Unsuspend / Terminate system active.");
// ==================================================================
// CHUNK 6 — INLINE BUTTON HANDLERS (SUSPEND / UNSUSPEND / TERMINATE)
// ==================================================================

bot.on("callback_query", async (query) => {
    try {
        const data = query.data;
        const adminId = query.from.id;
        const chatId = query.message.chat.id;

        // Only admins can handle these
        if (!isAdmin(adminId)) {
            await bot.answerCallbackQuery(query.id, { text: "🔒 Not authorized" });
            return;
        }

        // -------------------------
        //  SUSPEND USER
        // -------------------------
        if (data.startsWith("suspend_user_")) {
            const userId = data.replace("suspend_user_", "");

            adminAuth[adminId] = { 
                ...adminAuth[adminId], 
                awaitingSuspendReasonFor: userId 
            };

            await bot.sendMessage(
                chatId,
                `📝 Type the REASON for suspending user <code>${userId}</code>:`,
                { parse_mode: "HTML" }
            );

            await bot.answerCallbackQuery(query.id);
            return;
        }

        // -------------------------
        //  UNSUSPEND USER
        // -------------------------
        if (data.startsWith("unsuspend_user_")) {
            const userId = data.replace("unsuspend_user_", "");

            await unsuspendUser(userId);

            await bot.answerCallbackQuery(query.id, { text: "User unsuspended." });
            return;
        }

        // -------------------------
        //  TERMINATE CHAT (COMPLETED)
        // -------------------------
        if (data.startsWith("terminate_completed_")) {
            const userId = data.replace("terminate_completed_", "");

            await terminateChat(userId, "completed");

            await bot.answerCallbackQuery(query.id, { text: "Chat marked completed." });
            return;
        }

        // -------------------------
        //  TERMINATE CHAT (SUSPICIOUS)
        // -------------------------
        if (data.startsWith("terminate_suspicious_")) {
            const userId = data.replace("terminate_suspicious_", "");

            adminAuth[adminId] = { 
                ...adminAuth[adminId], 
                awaitingTerminateReasonFor: userId 
            };

            await bot.sendMessage(
                chatId,
                `🚨 Type the REASON for suspicious termination of <code>${userId}</code>:`,
                { parse_mode: "HTML" }
            );

            await bot.answerCallbackQuery(query.id);
            return;
        }

        // fallback
        await bot.answerCallbackQuery(query.id);
    } catch (err) {
        console.error("CHUNK 6 callback error:", err);
        try {
            await bot.answerCallbackQuery(query.id, { text: "Error" });
        } catch (e) {}
    }
});
// ==================================================================
// CHUNK 7 — ADMIN TYPED REASON HANDLER
// (Handles suspend reason + suspicious termination reason)
// ==================================================================

bot.on("message", async (msg) => {
    try {
        const chatId = msg.chat.id;
        const adminId = msg.from.id;
        const text = (msg.text || "").trim();

        // Only inside admin group
        if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

        // -------------------------------------------------------
        // 1) Admin typed SUSPEND reason
        // -------------------------------------------------------
        if (adminAuth[adminId]?.awaitingSuspendReasonFor) {
            const userId = adminAuth[adminId].awaitingSuspendReasonFor;
            const reason = text;

            await suspendUser(userId, reason);

            delete adminAuth[adminId].awaitingSuspendReasonFor;

            await bot.sendMessage(
                chatId,
                `🚫 User <code>${userId}</code> SUSPENDED.\nReason: ${escapeHtml(reason)}`,
                { parse_mode: "HTML" }
            );

            return;
        }

        // -------------------------------------------------------
        // 2) Admin typed TERMINATE (Suspicious) reason
        // -------------------------------------------------------
        if (adminAuth[adminId]?.awaitingTerminateReasonFor) {
            const userId = adminAuth[adminId].awaitingTerminateReasonFor;
            const reason = text;

            await terminateChat(userId, "suspicious", reason);

            delete adminAuth[adminId].awaitingTerminateReasonFor;

            await bot.sendMessage(
                chatId,
                `🚨 Chat terminated for <code>${userId}</code> (Suspicious)\nReason: ${escapeHtml(reason)}`,
                { parse_mode: "HTML" }
            );

            return;
        }

    } catch (err) {
        console.error("CHUNK 7 error:", err);
    }
});
// ==================================================================
// CHUNK 8 — CORE FUNCTIONS: suspend, unsuspend, terminate chat
// ==================================================================

/**
 * Suspend a user (cannot send messages, photos, or use menu)
 * @param {number|string} userId 
 * @param {string} reason 
 */
async function suspendUser(userId, reason) {
    userId = String(userId);

    // Sender doc
    await sendersCol.updateMany(
        { userId },
        { $set: { suspended: true, suspendReason: reason, suspendedAt: new Date() } }
    );

    // Traveler doc
    await travelersCol.updateMany(
        { userId },
        { $set: { suspended: true, suspendReason: reason, suspendedAt: new Date() } }
    );

    // Notify user
    try {
        await bot.sendMessage(
            userId,
            `🚫 <b>Your access is temporarily suspended.</b>\n\nReason: ${escapeHtml(reason)}\n\n` +
            `If you believe this is a mistake, contact support:\n` +
            `📩 support@airdlivers.com\n\n/start to reset.`,
            { parse_mode: "HTML" }
        );
    } catch (e) { }
}


/**
 * Unsuspend user (restore access)
 * @param {number|string} userId 
 */
async function unsuspendUser(userId) {
    userId = String(userId);

    await sendersCol.updateMany(
        { userId },
        { $unset: { suspended: "", suspendReason: "", suspendedAt: "" } }
    );

    await travelersCol.updateMany(
        { userId },
        { $unset: { suspended: "", suspendReason: "", suspendedAt: "" } }
    );

    // Notify user
    try {
        await bot.sendMessage(
            userId,
            `✅ <b>Your access to AirDlivers has been restored.</b>\n\nYou may continue using the service.\n/start`,
            { parse_mode: "HTML" }
        );
    } catch (e) { }
}


/**
 * Terminate Chat (completed or suspicious)
 * @param {number|string} userId 
 * @param {'completed' | 'suspicious'} type
 * @param {string} reason
 */
async function terminateChat(userId, type, reason = "") {
    userId = String(userId);

    // Find user (sender or traveler)
    const senderDoc = await sendersCol.findOne({ userId, matchLocked: true });
    const travelerDoc = await travelersCol.findOne({ userId, matchLocked: true });

    let myDoc = senderDoc || travelerDoc;
    if (!myDoc) return; // No active match

    const otherCol = myDoc.role === "sender" ? travelersCol : sendersCol;
    const myCol = myDoc.role === "sender" ? sendersCol : travelersCol;

    if (!myDoc.matchedWith) return;

    const otherDoc = await otherCol.findOne({ requestId: myDoc.matchedWith });

    // Clear match for both
    await clearMatchBetween(myDoc, otherDoc);

    // Notify both users
    if (type === "completed") {
        await bot.sendMessage(
            userId,
            `🎉 <b>Your delivery chat has been closed successfully.</b>\nThank you for using AirDlivers!`,
            { parse_mode: "HTML" }
        );
        if (otherDoc) {
            await bot.sendMessage(
                otherDoc.userId,
                `🎉 <b>Your delivery chat has been closed successfully.</b>\nThank you for using AirDlivers!`,
                { parse_mode: "HTML" }
            );
        }
    }

    if (type === "suspicious") {
        await bot.sendMessage(
            userId,
            `⚠️ <b>Your chat was terminated due to suspicious activity.</b>\nReason: ${escapeHtml(reason)}\n\nYou may restart using /start`,
            { parse_mode: "HTML" }
        );

        if (otherDoc) {
            await bot.sendMessage(
                otherDoc.userId,
                `⚠️ <b>The chat with your match has been terminated by admin due to suspicious activity.</b>\nPlease return to /start`,
                { parse_mode: "HTML" }
            );
        }
    }

    // Log to admin group
    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🛑 <b>Chat terminated</b>\nUser: <code>${userId}</code>\nType: ${escapeHtml(type)}\nReason: ${escapeHtml(reason)}`,
        { parse_mode: "HTML" }
    );
}


/**
 * Helper: Clear match linkage between sender & traveler
 */
async function clearMatchBetween(docA, docB) {
    if (!docA) return;
    const colA = docA.role === "sender" ? sendersCol : travelersCol;

    await colA.updateOne(
        { requestId: docA.requestId },
        {
            $unset: {
                matchedWith: "",
                pendingMatchWith: "",
                matchLocked: ""
            }
        }
    );

    if (docB) {
        const colB = docB.role === "sender" ? sendersCol : travelersCol;
        await colB.updateOne(
            { requestId: docB.requestId },
            {
                $unset: {
                    matchedWith: "",
                    pendingMatchWith: "",
                    matchLocked: ""
                }
            }
        );
    }
}
// =======================================================
// CHUNK 10 — FIXED TRAVELER FLOW (Email + Validations)
// =======================================================

async function handleTravelerTextStep(chatId, text) {
  const sess = userSessions[chatId];
  if (!sess) return;

  const data = sess.data;
  const cleaned = text.trim();

  switch (sess.step) {

    case 'traveler_name':
      if (cleaned.length < 2)
        return bot.sendMessage(chatId, 'Please enter a valid full name.');
      data.name = cleaned;
      sess.step = 'traveler_phone';
      return bot.sendMessage(chatId, '📞 Enter Phone (Example: +911234567890):');

    case 'traveler_phone':
      if (!isValidPhone(cleaned))
        return bot.sendMessage(chatId, '❌ Invalid phone. Use format +911234567890');
      data.phone = cleaned;
      sess.step = 'traveler_email';
      return bot.sendMessage(chatId, '📧 Enter Email:');

    case 'traveler_email':
      if (!isValidEmail(cleaned))
        return bot.sendMessage(chatId, '❌ Invalid email. Please try again.');
      data.email = cleaned;
      sess.step = 'departure_airport';
      return bot.sendMessage(chatId, '🛫 Enter Departure Airport (From):');

    case 'departure_airport':
      data.departure = cleaned;
      sess.step = 'departure_country';
      return bot.sendMessage(chatId, '🌍 Enter Departure Country:');

    case 'departure_country':
      data.departureCountry = cleaned;
      sess.step = 'destination_airport';
      return bot.sendMessage(chatId, '🛬 Enter Destination Airport (To):');

    case 'destination_airport':
      data.destination = cleaned;
      sess.step = 'arrival_country';
      return bot.sendMessage(chatId, '🌍 Enter Arrival Country:');

    case 'arrival_country':
      data.arrivalCountry = cleaned;
      sess.step = 'departure_time';
      return bot.sendMessage(chatId, '⏰ Enter Departure (DD-MM-YY HH:mm):');

    case 'departure_time': {
      const dt = parseDate_ddmmyy_hhmm(cleaned);
      if (!dt)
        return bot.sendMessage(chatId, 'Invalid format. Use DD-MM-YY HH:mm');
      data.departureTime = moment(dt).format('DD-MM-YY HH:mm');
      sess.step = 'arrival_time';
      return bot.sendMessage(chatId, '⏰ Enter Arrival (DD-MM-YY HH:mm):');
    }

    case 'arrival_time': {
      const dt = parseDate_ddmmyy_hhmm(cleaned);
      if (!dt)
        return bot.sendMessage(chatId, 'Invalid format. Use DD-MM-YY HH:mm');
      data.arrivalTime = moment(dt).format('DD-MM-YY HH:mm');
      sess.step = 'available_weight';
      return bot.sendMessage(chatId, '⚖️ Enter Available Weight in kg (Max 10kg):');
    }

    case 'available_weight': {
      const num = Number(cleaned);
      if (isNaN(num) || num <= 0)
        return bot.sendMessage(chatId, 'Please enter a valid positive number.');
      if (num > 10)
        return bot.sendMessage(chatId, '❌ Max weight is 10kg.');
      data.availableWeight = num;
      sess.step = 'passport_number';
      return bot.sendMessage(chatId, '🛂 Enter Passport Number (Example: L7982227):');
    }

    case 'passport_number':
      if (!/^[A-Za-z0-9]{6,10}$/.test(cleaned))
        return bot.sendMessage(chatId, 'Invalid passport format. Try again.');
      data.passportNumber = cleaned;
      sess.expectingPhoto = 'passport_selfie';
      sess.step = 'passport_selfie';
      return bot.sendMessage(chatId, '📸 Upload a selfie holding your passport (mandatory):');

    case 'passport_selfie':
      return; // handled by photo handler

    case 'itinerary_photo':
      return; // handled by photo handler

    case 'optional_notes':
      data.notes = cleaned.toLowerCase() === 'none' ? '' : cleaned;
      sess.requestId = makeRequestId('trv');
      sess.step = 'confirm_pending';

      let summary = `<b>🧳 Traveler Summary</b>\n\n`;
      summary += `<b>Request ID:</b> <code>${escapeHtml(sess.requestId)}</code>\n`;
      summary += `<b>Name:</b> ${escapeHtml(data.name)}\n`;
      summary += `<b>Phone:</b> ${escapeHtml(data.phone)}\n`;
      summary += `<b>Email:</b> ${escapeHtml(data.email)}\n`;
      summary += `<b>From:</b> ${escapeHtml(data.departure)} (${escapeHtml(data.departureCountry)})\n`;
      summary += `<b>To:</b> ${escapeHtml(data.destination)} (${escapeHtml(data.arrivalCountry)})\n`;
      summary += `<b>Departure:</b> ${escapeHtml(data.departureTime)}\n`;
      summary += `<b>Arrival:</b> ${escapeHtml(data.arrivalTime)}\n`;
      summary += `<b>Capacity:</b> ${escapeHtml(String(data.availableWeight))} kg\n`;
      summary += `<b>Passport:</b> ${escapeHtml(data.passportNumber)}\n`;
      if (data.notes) summary += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

      await bot.sendMessage(chatId, summary, {
        parse_mode: 'HTML',
        ...confirmKeyboard('traveler', sess.requestId)
      });
      return;

    default:
      return;
  }
}
