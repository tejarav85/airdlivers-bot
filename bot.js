// ================================================================
//  PART 1 — IMPORTS + ENV + WEBHOOK SERVER + UTILITIES
// ================================================================

import 'dotenv/config';
import TelegramBot from "node-telegram-bot-api";
import fs from "fs-extra";
import express from "express";
import moment from "moment";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// -------------------- ENV --------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "airdlivers";
const BASE_URL = process.env.RAILWAY_URL;  // MUST use this

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!ADMIN_GROUP_ID) throw new Error("ADMIN_GROUP_ID missing");
if (!ADMIN_PIN) throw new Error("ADMIN_PIN missing");
if (!MONGO_URI) throw new Error("MONGO_URI missing");
if (!BASE_URL) throw new Error("RAILWAY_URL missing in .env");

// Prepare local JSON backup
const SENDERS_JSON = join(__dirname, "senders.json");
const TRAVELERS_JSON = join(__dirname, "travelers.json");
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// -------------------- MONGODB --------------------
let mongoClient, db, sendersCol, travelersCol, userControlCol;
try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);

    sendersCol = db.collection("senders");
    travelersCol = db.collection("travelers");
    userControlCol = db.collection("user_controls");

    console.log("✅ MongoDB connected");
} catch (err) {
    console.error("❌ DB error:", err);
    process.exit(1);
}

// -------------------- TELEGRAM BOT (Webhook) --------------------
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${BASE_URL}${WEBHOOK_PATH}`;

// Set webhook
try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("🔗 Webhook set to:", WEBHOOK_URL);
} catch (err) {
    console.error("Webhook error:", err.message);
}

// -------------------- EXPRESS SERVER --------------------
const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) =>
    res.status(200).send("🌍 AirDlivers bot is running via webhook")
);

app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌍 Webhook server on ${PORT}`));

// -------------------- UTILITIES --------------------
function escapeHtml(str = "") {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function makeRequestId(prefix) {
    return prefix + moment().format("YYMMDDHHmmss");
}

function isValidEmail(t) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function isValidPhone(t) {
    return /^\+\d{8,15}$/.test(t);
}

function parseDate_ddmmyyyy(txt) {
    const m = moment(txt, "DD-MM-YYYY", true);
    return m.isValid() ? m.toDate() : null;
}

function parseDate_ddmmyy_hhmm(txt) {
    const m = moment(txt, "DD-MM-YY HH:mm", true);
    return m.isValid() ? m.toDate() : null;
}

console.log("✅ PART 1 loaded");
// ================================================================
//  PART 2 — SESSION SYSTEM + MAIN MENU + HELP + ADMIN LOGIN
// ================================================================

// -------------------- USER SESSIONS --------------------
const userSessions = {};  
// Structure:
// userSessions[chatId] = {
//   type: "sender" | "traveler",
//   step: "...",
//   data: {},
//   requestId: "...",
//   expectingPhoto: null | "package_photo" | "passport_selfie" | "itinerary_photo"
// }

// -------------------- MAIN MENU --------------------
const mainMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📦 Send a Package", callback_data: "flow_sender" }],
            [{ text: "🧳 Carry as Traveler", callback_data: "flow_traveler" }],
            [{ text: "📍 Track Shipment", callback_data: "flow_tracking" }],
            [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
        ]
    }
};

// -------------------- HELP MESSAGE --------------------
function helpSupportText() {
    return (
        `<b>ℹ️ Help & Support</b>\n\n` +
        `AirDlivers connects <b>senders</b> with verified <b>travelers</b> for fast, secure international delivery.\n\n` +
        `<b>📞 Support:</b>\n` +
        `• Telegram Group: <a href="https://t.me/+CAntejDg9plmNWI0">Join Support</a>\n` +
        `• Email: support@airdlivers.com\n\n` +
        `<b>🔐 Privacy Policy:</b>\n` +
        `• We only collect required information (name, phone, email, ID photos)\n` +
        `• We do NOT share or sell your data\n` +
        `• Admin can review chats only for safety reasons\n\n` +
        `<b>⚠️ Safety:</b>\n` +
        `• Do not send restricted/illegal items\n` +
        `• Travelers must verify identity\n` +
        `• Personal details stay hidden until match confirmed`
    );
}

// -------------------- START COMMAND --------------------
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    userSessions[chatId] = null;

    const welcome =
        `<b>👋 Welcome to AirDlivers!</b>\n\n` +
        `Choose an option below to begin.`;

    await bot.sendMessage(chatId, welcome, {
        parse_mode: "HTML",
        ...mainMenuKeyboard
    });
});

// -------------------- HELP COMMAND --------------------
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, helpSupportText(), {
        parse_mode: "HTML",
        disable_web_page_preview: true
    });
});

// -------------------- PRIVACY COMMAND --------------------
bot.onText(/\/privacy/, (msg) => {
    bot.sendMessage(msg.chat.id, helpSupportText(), {
        parse_mode: "HTML",
        disable_web_page_preview: true
    });
});

// ================================================================
//  ADMIN LOGIN (PIN + SUPER ADMIN)
// ================================================================

const adminState = {};  
// adminState[userId] = {
//   loggedIn: true/false,
//   awaitingPin: true/false
// };

bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id;

    if (String(adminId) === String(SUPER_ADMIN_ID)) {
        adminState[adminId] = { loggedIn: true };
        return bot.sendMessage(chatId, "🧠 Super Admin authenticated!");
    }

    if (String(chatId) !== String(ADMIN_GROUP_ID)) {
        return bot.sendMessage(chatId, "🚫 Admin login only allowed in the Admin Group.");
    }

    adminState[adminId] = { loggedIn: false, awaitingPin: true };
    bot.sendMessage(chatId, "🔑 Enter Admin PIN:");
});

bot.on("message", async (msg) => {
    const adminId = msg.from.id;
    const chatId = msg.chat.id;

    if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

    if (adminState[adminId]?.awaitingPin) {
        if (msg.text.trim() === ADMIN_PIN) {
            adminState[adminId] = { loggedIn: true };
            bot.sendMessage(chatId, "✅ Admin access granted!");
        } else {
            bot.sendMessage(chatId, "❌ Wrong PIN.");
        }
    }
});

// Utility
function isAdmin(id) {
    return adminState[id]?.loggedIn || String(id) === String(SUPER_ADMIN_ID);
}

// ================================================================
//  SUSPEND / UNSUSPEND / TERMINATE SYSTEM
// ================================================================

// Check suspended
async function isSuspended(userId) {
    const doc = await userControlCol.findOne({ userId: String(userId) });
    return doc?.suspended === true;
}

// Suspend user
async function suspendUser(userId, reason) {
    await userControlCol.updateOne(
        { userId: String(userId) },
        { $set: { suspended: true, reason } },
        { upsert: true }
    );

    await bot.sendMessage(
        userId,
        `⛔ <b>You are suspended.</b>\nReason: ${reason}\n\nContact support.`,
        { parse_mode: "HTML" }
    );
}

// Unsuspend
async function unsuspendUser(userId) {
    await userControlCol.updateOne(
        { userId: String(userId) },
        { $set: { suspended: false } },
        { upsert: true }
    );

    await bot.sendMessage(
        userId,
        `🟢 <b>Your suspension is removed.</b>\nUse /start`,
        { parse_mode: "HTML" }
    );
}

// Terminate chat
async function terminateChat(userId, type, reason) {
    await userControlCol.updateOne(
        { userId: String(userId) },
        { $set: { terminated: true, terminatedReason: reason } },
        { upsert: true }
    );

    let msg =
        type === "completed"
            ? `🎉 Chat closed successfully.\nThank you for using AirDlivers!`
            : `🚫 Chat terminated due to suspicious activity.\nReason: ${reason}`;

    await bot.sendMessage(userId, msg, { parse_mode: "HTML" });
}

// Block suspended users globally
bot.on("message", async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (String(chatId) === String(ADMIN_GROUP_ID)) return;
    if (msg.text && msg.text.startsWith("/start")) return;

    if (await isSuspended(userId)) {
        return bot.sendMessage(
            userId,
            `⛔ You are suspended.\nEmail support@airdlivers.com`,
            { parse_mode: "HTML" }
        );
    }
});

console.log("✅ PART 2 loaded");
// ================================================================
// PART 3 — SENDER FLOW (COMPLETE)
// ================================================================

async function handleSenderTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;
    const cleaned = text.trim();

    switch (sess.step) {
        case "sender_name":
            if (cleaned.length < 2)
                return bot.sendMessage(chatId, "❌ Enter a valid full name.");
            data.name = cleaned;
            sess.step = "sender_phone";
            return bot.sendMessage(chatId, "📞 Enter Phone (+countrycode123456789):");

        case "sender_phone":
            if (!isValidPhone(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid phone format. Use +911234567890");
            data.phone = cleaned;
            sess.step = "sender_email";
            return bot.sendMessage(chatId, "📧 Enter Email:");

        case "sender_email":
            if (!isValidEmail(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid email address.");
            data.email = cleaned;
            sess.step = "pickup_airport";
            return bot.sendMessage(chatId, "🛫 Enter Pickup Airport:");

        case "pickup_airport":
            data.pickupAirport = cleaned;
            sess.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        case "destination_airport":
            data.destinationAirport = cleaned;
            sess.step = "weight";
            return bot.sendMessage(chatId, "⚖️ Enter Package Weight (kg):");

        case "weight": {
            const kg = Number(cleaned);
            if (isNaN(kg) || kg <= 0)
                return bot.sendMessage(chatId, "❌ Enter a valid weight.");
            data.weight = kg;
            sess.step = "category";
            return bot.sendMessage(chatId, "📦 Enter Category of Package:");
        }

        case "category":
            data.category = cleaned;
            sess.step = "send_date";
            return bot.sendMessage(chatId, "📅 Enter Send Date (DD-MM-YYYY):");

        case "send_date": {
            const d = parseDate_ddmmyyyy(cleaned);
            if (!d) return bot.sendMessage(chatId, "❌ Invalid date. Use: DD-MM-YYYY");
            data.sendDate = moment(d).format("DD-MM-YYYY");
            sess.step = "arrival_date";
            return bot.sendMessage(chatId, "📅 Enter Expected Arrival Date (DD-MM-YYYY):");
        }

        case "arrival_date": {
            const d = parseDate_ddmmyyyy(cleaned);
            if (!d) return bot.sendMessage(chatId, "❌ Invalid date. Use: DD-MM-YYYY");
            data.arrivalDate = moment(d).format("DD-MM-YYYY");
            sess.expectingPhoto = "package_photo";
            sess.step = "package_photo";
            return bot.sendMessage(chatId, "📸 Upload Package Photo:");
        }

        case "package_photo":
            return; // handled in photo handler

        case "id_selfie":
            return;

        case "optional_notes":
            data.notes = cleaned === "none" ? "" : cleaned;
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
                `<b>Send Date:</b> ${escapeHtml(data.sendDate)}\n` +
                `<b>Arrival Date:</b> ${escapeHtml(data.arrivalDate)}\n`;

            if (data.notes) summary += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            return bot.sendMessage(chatId, summary, {
                parse_mode: "HTML",
                ...confirmKeyboard("sender", sess.requestId)
            });
    }
}

// ================================================================
// PART 3 — TRAVELER FLOW (COMPLETE)
// ================================================================

async function handleTravelerTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;

    const data = sess.data;
    const cleaned = text.trim();

    switch (sess.step) {
        case "traveler_name":
            if (cleaned.length < 2)
                return bot.sendMessage(chatId, "❌ Enter a valid full name.");
            data.name = cleaned;
            sess.step = "traveler_phone";
            return bot.sendMessage(chatId, "📞 Enter Phone:");

        case "traveler_phone":
            if (!isValidPhone(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid phone format. Use +911234567890");
            data.phone = cleaned;
            sess.step = "traveler_email";
            return bot.sendMessage(chatId, "📧 Enter Email:");

        case "traveler_email":
            if (!isValidEmail(cleaned))
                return bot.sendMessage(chatId, "❌ Invalid email address.");
            data.email = cleaned;
            sess.step = "departure_airport";
            return bot.sendMessage(chatId, "🛫 Enter Departure Airport:");

        case "departure_airport":
            data.departure = cleaned;
            sess.step = "departure_country";
            return bot.sendMessage(chatId, "🌍 Enter Departure Country:");

        case "departure_country":
            data.departureCountry = cleaned;
            sess.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        case "destination_airport":
            data.destination = cleaned;
            sess.step = "arrival_country";
            return bot.sendMessage(chatId, "🌍 Enter Arrival Country:");

        case "arrival_country":
            data.arrivalCountry = cleaned;
            sess.step = "departure_time";
            return bot.sendMessage(chatId, "⏰ Enter Departure Time (DD-MM-YY HH:mm):");

        case "departure_time": {
            const d = parseDate_ddmmyy_hhmm(cleaned);
            if (!d)
                return bot.sendMessage(chatId, "❌ Use format: DD-MM-YY HH:mm");
            data.departureTime = moment(d).format("DD-MM-YY HH:mm");
            sess.step = "arrival_time";
            return bot.sendMessage(chatId, "⏰ Enter Arrival Time (DD-MM-YY HH:mm):");
        }

        case "arrival_time": {
            const d = parseDate_ddmmyy_hhmm(cleaned);
            if (!d)
                return bot.sendMessage(chatId, "❌ Use format: DD-MM-YY HH:mm");
            data.arrivalTime = moment(d).format("DD-MM-YY HH:mm");
            sess.step = "available_weight";
            return bot.sendMessage(chatId, "⚖️ Enter Available Weight (kg, Max 10kg):");
        }

        case "available_weight": {
            const kg = Number(cleaned);
            if (isNaN(kg) || kg <= 0 || kg > 10)
                return bot.sendMessage(chatId, "❌ Weight must be 1–10kg.");
            data.availableWeight = kg;
            sess.step = "passport_number";
            return bot.sendMessage(chatId, "🛂 Enter Passport Number:");
        }

        case "passport_number":
            data.passportNumber = cleaned;
            sess.expectingPhoto = "passport_selfie";
            sess.step = "passport_selfie";
            return bot.sendMessage(chatId, "📸 Upload Selfie holding Passport:");

        case "passport_selfie":
            return;

        case "itinerary_photo":
            return;

        case "optional_notes":
            data.notes = cleaned === "none" ? "" : cleaned;
            sess.requestId = makeRequestId("trv");
            sess.step = "confirm_traveler";

            let summary =
                `<b>🧳 Traveler Summary</b>\n\n` +
                `<b>ID:</b> <code>${sess.requestId}</code>\n` +
                `<b>Name:</b> ${escapeHtml(data.name)}\n` +
                `<b>Phone:</b> ${escapeHtml(data.phone)}\n` +
                `<b>Email:</b> ${escapeHtml(data.email)}\n` +
                `<b>From:</b> ${escapeHtml(data.departure)} (${escapeHtml(data.departureCountry)})\n` +
                `<b>To:</b> ${escapeHtml(data.destination)} (${escapeHtml(data.arrivalCountry)})\n` +
                `<b>Departure:</b> ${escapeHtml(data.departureTime)}\n` +
                `<b>Arrival:</b> ${escapeHtml(data.arrivalTime)}\n` +
                `<b>Weight:</b> ${escapeHtml(String(data.availableWeight))}kg\n` +
                `<b>Passport:</b> ${escapeHtml(data.passportNumber)}\n`;

            if (data.notes) summary += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            return bot.sendMessage(chatId, summary, {
                parse_mode: "HTML",
                ...confirmKeyboard("traveler", sess.requestId)
            });
    }
}

// ================================================================
// PART 3 — PHOTO HANDLER
// ================================================================

bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const sess = userSessions[chatId];
    if (!sess) return;

    const fileId = msg.photo[msg.photo.length - 1].file_id;

    if (sess.expectingPhoto === "package_photo") {
        sess.data.packagePhoto = fileId;
        sess.expectingPhoto = "id_selfie";
        sess.step = "id_selfie";
        return bot.sendMessage(chatId, "📸 Upload your Selfie holding your ID:");
    }

    if (sess.expectingPhoto === "id_selfie") {
        sess.data.idSelfie = fileId;
        sess.expectingPhoto = null;
        sess.step = "optional_notes";
        return bot.sendMessage(chatId, "📝 Add notes (or type 'none'):");
    }

    if (sess.expectingPhoto === "passport_selfie") {
        sess.data.passportSelfie = fileId;
        sess.expectingPhoto = "itinerary_photo";
        sess.step = "itinerary_photo";
        return bot.sendMessage(chatId, "📄 Upload Itinerary / Ticket:");
    }

    if (sess.expectingPhoto === "itinerary_photo") {
        sess.data.itinerary = fileId;
        sess.expectingPhoto = null;
        sess.step = "optional_notes";
        return bot.sendMessage(chatId, "📝 Add notes (or type 'none'):");
    }
});

console.log("✅ PART 3 loaded — Sender + Traveler + Photos");
// ================================================================
// PART 4 — CONFIRMATION HANDLERS (Sender / Traveler)
// ================================================================

function confirmKeyboard(role, requestId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Confirm & Submit", callback_data: `confirm_${role}_${requestId}` }],
                [{ text: "❌ Cancel", callback_data: "cancel_form" }]
            ]
        }
    };
}

// ------------------- INLINE HANDLER -------------------
bot.on("callback_query", async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const userId = String(query.from.id);

    if (data === "cancel_form") {
        userSessions[chatId] = null;
        await bot.sendMessage(chatId, "❌ Form cancelled.\n/start to begin again.");
        return bot.answerCallbackQuery(query.id);
    }

    // ------------------- SENDER SUBMIT -------------------
    if (data.startsWith("confirm_sender_")) {
        const requestId = data.replace("confirm_sender_", "");
        const sess = userSessions[chatId];
        if (!sess) return;

        const doc = {
            userId,
            requestId,
            role: "sender",
            ...sess.data,
            status: "pending",
            createdAt: new Date()
        };

        await sendersCol.insertOne(doc);
        await backupSenderJSON(doc);

        await bot.sendMessage(chatId, "🎉 Sender request submitted!\nWe will match a traveler for you soon.");

        await attemptAutoMatchSender(doc);

        userSessions[chatId] = null;
        return bot.answerCallbackQuery(query.id);
    }

    // ------------------- TRAVELER SUBMIT -------------------
    if (data.startsWith("confirm_traveler_")) {
        const requestId = data.replace("confirm_traveler_", "");
        const sess = userSessions[chatId];
        if (!sess) return;

        const doc = {
            userId,
            requestId,
            role: "traveler",
            ...sess.data,
            status: "pending",
            createdAt: new Date()
        };

        await travelersCol.insertOne(doc);
        await backupTravelerJSON(doc);

        await bot.sendMessage(chatId, "🧳 Traveler data submitted!\nWe will match a sender for you soon.");

        await attemptAutoMatchTraveler(doc);

        userSessions[chatId] = null;
        return bot.answerCallbackQuery(query.id);
    }

    bot.answerCallbackQuery(query.id);
});

// ================================================================
// PART 4 — AUTO MATCHING ENGINE (Improved)
// ================================================================

async function attemptAutoMatchSender(sender) {
    const match = await travelersCol.findOne({
        departure: sender.pickupAirport,
        destination: sender.destinationAirport,
        availableWeight: { $gte: sender.weight },
        matchLocked: { $ne: true }
    });

    if (!match) return;

    await lockMatch(sender, match);
}

async function attemptAutoMatchTraveler(traveler) {
    const match = await sendersCol.findOne({
        pickupAirport: traveler.departure,
        destinationAirport: traveler.destination,
        weight: { $lte: traveler.availableWeight },
        matchLocked: { $ne: true }
    });

    if (!match) return;

    await lockMatch(match, traveler);
}

async function lockMatch(senderDoc, travelerDoc) {
    await sendersCol.updateOne(
        { requestId: senderDoc.requestId },
        { $set: { matchedWith: travelerDoc.requestId, matchLocked: true } }
    );
    await travelersCol.updateOne(
        { requestId: travelerDoc.requestId },
        { $set: { matchedWith: senderDoc.requestId, matchLocked: true } }
    );

    // Notify both
    await bot.sendMessage(senderDoc.userId,
        `🎯 <b>Match Found!</b>\nA traveler was matched with your shipment.\nYou may start chatting.`,
        { parse_mode: "HTML" }
    );

    await bot.sendMessage(travelerDoc.userId,
        `🎯 <b>Match Found!</b>\nA sender matches your trip.\nYou may start chatting.`,
        { parse_mode: "HTML" }
    );

    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🔔 MATCH CREATED\nSender: ${senderDoc.userId}\nTraveler: ${travelerDoc.userId}`,
        { parse_mode: "HTML" }
    );
}

// ================================================================
// PART 4 — CHAT RELAY BETWEEN MATCHED USERS
// ================================================================

async function relayMessage(msg) {
    const userId = String(msg.from.id);
    const text = msg.text || "";
    const photo = msg.photo?.[msg.photo.length - 1]?.file_id;
    const video = msg.video?.file_id;
    const doc = msg.document?.file_id;

    // Find matching document
    const mySender = await sendersCol.findOne({ userId, matchLocked: true });
    const myTraveler = await travelersCol.findOne({ userId, matchLocked: true });

    const me = mySender || myTraveler;
    if (!me || !me.matchedWith) return;

    const otherCol = me.role === "sender" ? travelersCol : sendersCol;
    const other = await otherCol.findOne({ requestId: me.matchedWith });
    if (!other) return;

    const target = other.userId;

    // Relay normal text
    if (text) {
        await bot.sendMessage(target, `💬 ${text}`);
    }

    // Relay photos
    if (photo) {
        await bot.sendPhoto(target, photo);
    }

    // Relay documents
    if (doc) {
        await bot.sendDocument(target, doc);
    }

    // Relay video
    if (video) {
        await bot.sendVideo(target, video);
    }
}

// Global message listener
bot.on("message", async (msg) => {
    if (!msg.text?.startsWith("/") && msg.chat.type === "private") {
        await relayMessage(msg);
    }
});

// ================================================================
// PART 4 — WEBHOOK AUTO-RECOVERY (Railway Safe Mode)
// ================================================================

async function autoFixWebhook() {
    try {
        const info = await bot.getWebHookInfo();
        if (!info || info.url !== WEBHOOK_URL) {
            console.log("♻️ Fixing webhook...");
            await bot.setWebHook(WEBHOOK_URL);
        }
    } catch (e) {
        console.error("Webhook fix error:", e);
    }
}

setInterval(autoFixWebhook, 15 * 60 * 1000); // every 15 minutes

console.log("✅ PART 4 loaded — Matching + Chat Relay + Final Handlers");

// ================================================================
// BOT FULLY LOADED
// ================================================================
console.log("🚀 AirDlivers Bot fully operational.");
