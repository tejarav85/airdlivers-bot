import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import { MongoClient } from 'mongodb';
import moment from 'moment';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

// __dirname setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || '';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'airdlivers';
const RAILWAY_URL = process.env.RAILWAY_URL;

if (!BOT_TOKEN) { console.error("BOT_TOKEN missing"); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error("ADMIN_GROUP_ID missing"); process.exit(1); }
if (!ADMIN_PIN) { console.error("ADMIN_PIN missing"); process.exit(1); }
if (!MONGO_URI) { console.error("MONGO_URI missing"); process.exit(1); }
if (!RAILWAY_URL) { console.error("RAILWAY_URL missing"); process.exit(1); }

// MongoDB
let mongo, db, sendersCol, travelersCol;
try {
    mongo = new MongoClient(MONGO_URI);
    await mongo.connect();
    db = mongo.db(DB_NAME);
    sendersCol = db.collection("senders");
    travelersCol = db.collection("travelers");
    console.log("✅ MongoDB connected");
} catch (e) {
    console.error("MongoDB error:", e);
    process.exit(1);
}

// Bot instance
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

// Webhook
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${RAILWAY_URL}${WEBHOOK_PATH}`;

// Set initial webhook
try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("🔗 Webhook set:", WEBHOOK_URL);
} catch (e) {
    console.error("Webhook error:", e);
}

// Auto-recovery webhook
async function autoFixWebhook() {
    try {
        const info = await bot.getWebHookInfo();
        if (!info || info.url !== WEBHOOK_URL) {
            console.log("♻️ Webhook mismatch — fixing...");
            await bot.setWebHook(WEBHOOK_URL);
        }
    } catch (e) {
        console.error("AutoFix error:", e);
    }
}
setInterval(autoFixWebhook, 15 * 60 * 1000);

// Express server
const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => {
    res.send("🌍 AirDlivers bot running");
});
app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () =>
    console.log("🌍 HTTP Server running")
);

// Utilities
const userSessions = {};
const adminAuth = {};

function escapeHtml(s = "") {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function isValidPhone(p) {
    return /^\+\d{8,15}$/.test(p);
}

function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function parseDate(txt) {
    const m = moment(txt, "DD-MM-YYYY", true);
    return m.isValid() ? m : null;
}

function makeID(prefix) {
    return `${prefix}${moment().format("YYMMDDHHmmss")}`;
}

// Help / Support message
function getHelpText() {
    return (
        `<b>ℹ️ Help & Support</b>\n\n` +
        `Here is how to use this bot:\n` +
        `• Select Sender or Traveler\n` +
        `• Complete required steps\n` +
        `• Upload mandatory ID/Passport photos\n` +
        `• Wait for Admin approval\n` +
        `• After match, chat securely inside bot\n\n` +
        `📜 <b>Privacy:</b>\n` +
        `We store only required data (Name, Phone, Email, ID/Passport).\n` +
        `Your data is NOT shared/sold.\n\n` +
        `📞 <b>Support Contact:</b> hrmailsinfo@gmail.com\n` +
        `🧑‍💻 <b>Admin Support Chat:</b> Available ONLY after starting Sender or Traveler service.\n`
    );
}

// -----------------------------
// SUSPEND / UNSUSPEND / TERMINATE
// -----------------------------

async function suspendUser(userId, reason) {
    userId = String(userId);

    await sendersCol.updateMany({ userId }, {
        $set: { suspended: true, suspendedAt: new Date(), suspendedReason: reason }
    });

    await travelersCol.updateMany({ userId }, {
        $set: { suspended: true, suspendedAt: new Date(), suspendedReason: reason }
    });

    try {
        await bot.sendMessage(
            userId,
            `🚫 <b>Your access to AirDlivers has been suspended.</b>\nReason: ${escapeHtml(reason)}\n\nIf this is a mistake, email support: hrmailsinfo@gmail.com`,
            { parse_mode: "HTML" }
        );
    } catch { }
}

async function unsuspendUser(userId) {
    userId = String(userId);

    await sendersCol.updateMany({ userId }, {
        $unset: { suspended: "", suspendedAt: "", suspendedReason: "" }
    });

    await travelersCol.updateMany({ userId }, {
        $unset: { suspended: "", suspendedAt: "", suspendedReason: "" }
    });

    try {
        await bot.sendMessage(
            userId,
            `✅ <b>Your account has been restored.</b>\nYou may now use the bot again.\n/start`,
            { parse_mode: "HTML" }
        );
    } catch { }
}

async function terminateChat(userId, type, reason) {
    userId = String(userId);

    let senderDoc = await sendersCol.findOne({ userId, matchLocked: true });
    let travelerDoc = await travelersCol.findOne({ userId, matchLocked: true });

    const doc = senderDoc || travelerDoc;
    if (!doc) return;

    const myCol = doc.role === "sender" ? sendersCol : travelersCol;
    const otherCol = doc.role === "sender" ? travelersCol : sendersCol;

    if (!doc.matchedWith) return;

    const other = await otherCol.findOne({ requestId: doc.matchedWith });

    // clearing match
    await myCol.updateOne({ requestId: doc.requestId }, {
        $unset: { matchLocked: "", matchedWith: "" }
    });

    if (other) {
        await otherCol.updateOne({ requestId: other.requestId }, {
            $unset: { matchLocked: "", matchedWith: "" }
        });
    }

    if (type === "completed") {
        await bot.sendMessage(userId, `🎉 Delivery completed! Thank you for using AirDlivers.`);
        if (other) await bot.sendMessage(other.userId, `🎉 Delivery completed! Thank you.`);
    }

    if (type === "suspicious") {
        await bot.sendMessage(
            userId,
            `⚠️ <b>Your chat has been terminated due to suspicious activity.</b>\n${escapeHtml(reason)}\n\n/start`,
            { parse_mode: "HTML" }
        );
        if (other) {
            await bot.sendMessage(
                other.userId,
                `⚠️ The chat was terminated due to suspicious activity.\n/start`,
                { parse_mode: "HTML" }
            );
        }
    }

    await bot.sendMessage(
        ADMIN_GROUP_ID,
        `🛑 Chat terminated\nUser: ${userId}\nReason: ${escapeHtml(reason)}`,
        { parse_mode: "HTML" }
    );
}

// -----------------------------
// START COMMAND
// -----------------------------
bot.onText(/\/start/, async (msg) => {
    const id = msg.chat.id;

    const suspended =
        (await sendersCol.findOne({ userId: String(id), suspended: true })) ||
        (await travelersCol.findOne({ userId: String(id), suspended: true }));

    if (suspended) {
        return bot.sendMessage(
            id,
            `🚫 You are suspended.\nReason: ${escapeHtml(suspended.suspendedReason || "")}\nContact: hrmailsinfo@gmail.com`,
            { parse_mode: "HTML" }
        );
    }

    userSessions[id] = null;

    await bot.sendMessage(
        id,
        `<b>👋 Welcome to AirDlivers!</b>\nChoose an option below:`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📦 Send Package", callback_data: "flow_sender" }],
                    [{ text: "🧳 Traveler", callback_data: "flow_traveler" }],
                    [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
                ]
            }
        }
    );
});

// -----------------------------
// HELP CALLBACK
// -----------------------------
bot.on("callback_query", async (q) => {
    if (q.data === "flow_help") {
        return bot.sendMessage(q.message.chat.id, getHelpText(), { parse_mode: "HTML" });
    }
});
/* ============================================================
   TRAVELER + SENDER FLOWS (Option B: Only Email Added to Traveler)
   ============================================================ */

// -----------------------------
// Callback: START SENDER / TRAVELER
// -----------------------------
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // Suspend block
    const suspended =
        (await sendersCol.findOne({ userId: String(chatId), suspended: true })) ||
        (await travelersCol.findOne({ userId: String(chatId), suspended: true }));
    if (suspended) {
        return bot.sendMessage(chatId, `🚫 You are suspended.\nReason: ${suspended.suspendedReason}`, {
            parse_mode: "HTML",
        });
    }

    // Sender flow
    if (data === "flow_sender") {
        userSessions[chatId] = {
            type: "sender",
            step: "name",
            data: {},
        };
        return bot.sendMessage(chatId, "👤 Enter your Full Name:");
    }

    // Traveler flow
    if (data === "flow_traveler") {
        userSessions[chatId] = {
            type: "traveler",
            step: "name",
            data: {},
        };
        return bot.sendMessage(chatId, "👤 Enter your Full Name:");
    }
});

// -----------------------------
// MESSAGE HANDLER (Sender + Traveler flows)
// -----------------------------
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";
    const session = userSessions[chatId];

    // ignore /start here
    if (text.startsWith("/")) return;

    if (!session) return;

    // If SENDER
    if (session.type === "sender") return handleSender(chatId, text);

    // If TRAVELER
    if (session.type === "traveler") return handleTraveler(chatId, text);
});

/* ============================================================
   SENDER FLOW
   ============================================================ */
async function handleSender(chatId, text) {
    const session = userSessions[chatId];
    const d = session.data;

    switch (session.step) {
        case "name":
            d.name = text;
            session.step = "phone";
            return bot.sendMessage(chatId, "📞 Enter Phone Number (+911234567890):");

        case "phone":
            if (!isValidPhone(text)) return bot.sendMessage(chatId, "❌ Invalid phone.");
            d.phone = text;
            session.step = "email";
            return bot.sendMessage(chatId, "📧 Enter Email ID:");

        case "email":
            if (!isValidEmail(text)) return bot.sendMessage(chatId, "❌ Invalid email.");
            d.email = text;
            session.step = "pickup";
            return bot.sendMessage(chatId, "🛫 Enter Pickup Airport:");

        case "pickup":
            d.pickup = text;
            session.step = "destination";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        case "destination":
            d.destination = text;
            session.step = "weight";
            return bot.sendMessage(chatId, "⚖️ Enter Package Weight (kg):");

        case "weight":
            d.weight = parseFloat(text);
            session.step = "category";
            return bot.sendMessage(chatId, "📦 Select Category:", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Documents", callback_data: "cat_documents" }],
                        [{ text: "Clothes", callback_data: "cat_clothes" }],
                        [{ text: "Food", callback_data: "cat_food" }]
                    ]
                }
            });
    }
}

/* ============================================================
   TRAVELER FLOW (UPDATED WITH EMAIL)
   ============================================================ */
async function handleTraveler(chatId, text) {
    const session = userSessions[chatId];
    const d = session.data;

    switch (session.step) {
        case "name":
            d.name = text;
            session.step = "phone";
            return bot.sendMessage(chatId, "📞 Enter Phone Number (+911234567890):");

        case "phone":
            if (!isValidPhone(text)) return bot.sendMessage(chatId, "❌ Invalid phone.");
            d.phone = text;
            session.step = "email";                // ← ADDED
            return bot.sendMessage(chatId, "📧 Enter Email ID:");

        case "email":                             // ← ADDED
            if (!isValidEmail(text)) return bot.sendMessage(chatId, "❌ Invalid email.");
            d.email = text;
            session.step = "pickup_airport";
            return bot.sendMessage(chatId, "🛫 Enter Pickup Airport:");

        case "pickup_airport":
            d.pickup = text;
            session.step = "pickup_country";
            return bot.sendMessage(chatId, "🌍 Enter Pickup Country:");

        case "pickup_country":
            d.pickupCountry = text;
            session.step = "destination_airport";
            return bot.sendMessage(chatId, "🛬 Enter Destination Airport:");

        case "destination_airport":
            d.destination = text;
            session.step = "destination_country";
            return bot.sendMessage(chatId, "🌍 Enter Destination Country:");

        case "destination_country":
            d.destinationCountry = text;
            session.step = "weight";
            return bot.sendMessage(chatId, "⚖️ Enter Available Weight (kg):");

        case "weight":
            d.availableWeight = parseFloat(text);
            session.step = "passport_number";
            return bot.sendMessage(chatId, "🛂 Enter Passport Number:");

        case "passport_number":
            d.passportNumber = text;
            session.step = "passport_selfie";
            session.expectingPhoto = "passport_selfie";
            return bot.sendMessage(chatId, "📸 Upload Selfie Holding Passport:");
    }
}

/* ============================================================
   PHOTO HANDLER (passport selfie / id selfie)
   ============================================================ */
bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.photo[msg.photo.length - 1].file_id;

    const session = userSessions[chatId];
    if (!session) return;

    if (session.expectingPhoto === "passport_selfie") {
        session.data.passportSelfie = fileId;
        session.expectingPhoto = null;
        session.step = "ticket";
        return bot.sendMessage(chatId, "🎫 Upload Flight Ticket / Itinerary:");
    }

    if (session.expectingPhoto === "ticket") {
        session.data.ticket = fileId;
        session.expectingPhoto = null;

        session.step = "confirm";

        const d = session.data;

        // SUMMARY
        let summary =
            `<b>🧳 Traveler Summary</b>\n\n` +
            `<b>Name:</b> ${escapeHtml(d.name)}\n` +
            `<b>Phone:</b> ${escapeHtml(d.phone)}\n` +
            `<b>Email:</b> ${escapeHtml(d.email)}\n` +
            `<b>From:</b> ${escapeHtml(d.pickup)} (${escapeHtml(d.pickupCountry)})\n` +
            `<b>To:</b> ${escapeHtml(d.destination)} (${escapeHtml(d.destinationCountry)})\n` +
            `<b>Weight:</b> ${d.availableWeight} kg\n` +
            `<b>Passport:</b> ${escapeHtml(d.passportNumber)}\n`;

        return bot.sendMessage(chatId, summary, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Confirm & Submit", callback_data: "traveler_confirm" }],
                    [{ text: "❌ Cancel", callback_data: "traveler_cancel" }]
                ]
            }
        });
    }
});

/* ============================================================
   CONFIRMATION HANDLER
   ============================================================ */
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;

    if (q.data === "traveler_cancel") {
        userSessions[chatId] = null;
        return bot.sendMessage(chatId, "❌ Cancelled.\n/start");
    }

    if (q.data === "traveler_confirm") {
        const d = userSessions[chatId].data;
        const reqId = makeID("trv");

        await travelersCol.insertOne({
            requestId: reqId,
            userId: String(chatId),
            role: "traveler",
            data: d,
            status: "Pending",
            createdAt: new Date()
        });

        await bot.sendMessage(
            chatId,
            `✅ Traveler request submitted.\n<b>Request ID:</b> <code>${reqId}</code>`,
            { parse_mode: "HTML" }
        );

        await bot.sendMessage(
            ADMIN_GROUP_ID,
            `🧳 <b>New Traveler</b>\nID: <code>${reqId}</code>\nName: ${escapeHtml(d.name)}\nPhone: ${escapeHtml(d.phone)}`,
            { parse_mode: "HTML" }
        );

        userSessions[chatId] = null;
    }
});

/* ============================================================
   ADMIN COMMANDS — Suspend / Unsuspend / Terminate
   ============================================================ */
bot.onText(/\/suspend (.+) (.+)/, async (msg, m) => {
    if (String(msg.chat.id) !== String(ADMIN_GROUP_ID)) return;
    const uid = m[1];
    const reason = m[2];
    await suspendUser(uid, reason);
    bot.sendMessage(ADMIN_GROUP_ID, `🚫 Suspended ${uid}`);
});

bot.onText(/\/unsuspend (.+)/, async (msg, m) => {
    if (String(msg.chat.id) !== String(ADMIN_GROUP_ID)) return;
    const uid = m[1];
    await unsuspendUser(uid);
    bot.sendMessage(ADMIN_GROUP_ID, `♻️ Unsuspended ${uid}`);
});

bot.onText(/\/terminate (.+) (.+)/, async (msg, m) => {
    if (String(msg.chat.id) !== String(ADMIN_GROUP_ID)) return;
    const uid = m[1];
    const reason = m[2];
    await terminateChat(uid, "suspicious", reason);
    bot.sendMessage(ADMIN_GROUP_ID, `🛑 Terminated chat for ${uid}`);
});

/* ============================================================
   FINAL LOG
   ============================================================ */
console.log("🚀 AirDlivers bot fully loaded.");
