// ========================================================================
// AirDlivers · Telegram Bot (Webhook + Automatic Match Engine + Admin Panel)
// Full bot.js — Segment 1 / 6
// ========================================================================

// --------------------------- Imports ------------------------------------
import 'dotenv/config';
import TelegramBot from "node-telegram-bot-api";
import fs from "fs-extra";
import express from "express";
import moment from "moment";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// --------------------------- Directory Fix -------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --------------------------- Environment Vars ----------------------------
const BOT_TOKEN       = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID  = process.env.SUPER_ADMIN_ID || "";
const ADMIN_GROUP_ID  = process.env.ADMIN_GROUP_ID;
const ADMIN_PIN       = process.env.ADMIN_PIN;
const MONGO_URI       = process.env.MONGO_URI;
const MONGO_DB_NAME   = process.env.MONGO_DB_NAME || "airdlivers";
const RAILWAY_URL     = process.env.RAILWAY_URL;

if (!BOT_TOKEN)       { console.error("FATAL: BOT_TOKEN missing");       process.exit(1); }
if (!ADMIN_GROUP_ID)  { console.error("FATAL: ADMIN_GROUP_ID missing");  process.exit(1); }
if (!ADMIN_PIN)       { console.error("FATAL: ADMIN_PIN missing");       process.exit(1); }
if (!MONGO_URI)       { console.error("FATAL: MONGO_URI missing");       process.exit(1); }
if (!RAILWAY_URL)     { console.error("FATAL: RAILWAY_URL missing");     process.exit(1); }

// --------------------------- JSON Backup Files ---------------------------
const SENDERS_JSON    = join(__dirname, "senders.json");
const TRAVELERS_JSON  = join(__dirname, "travelers.json");

await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// --------------------------- MongoDB ------------------------------------
let mongoClient, db, sendersCol, travelersCol, suspendedCol;

try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);

    sendersCol    = db.collection("senders");
    travelersCol  = db.collection("travelers");
    suspendedCol  = db.collection("suspendedUsers");

    console.log("✅ MongoDB connected");
} catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
}

// --------------------------- Telegram Bot (Webhook Mode) ------------------
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL  = `${RAILWAY_URL}${WEBHOOK_PATH}`;

try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("✅ Webhook set:", WEBHOOK_URL);
} catch (err) {
    console.error("❌ Cannot set webhook:", err);
}

// --------- Auto-Fix Webhook Every 15 minutes (Railway stability) ---------
async function autoFixWebhook() {
    try {
        const info = await bot.getWebHookInfo();
        if (!info || info.url !== WEBHOOK_URL) {
            console.log("♻️ Fixing webhook…");
            await bot.setWebHook(WEBHOOK_URL);
        }
    } catch (err) {
        console.error("Webhook auto-fix error:", err);
    }
}
setInterval(autoFixWebhook, 15 * 60 * 1000);

// --------------------------- Express Server ------------------------------
const app = express();
app.use(express.json({ limit: "30mb" }));

app.get("/", (req, res) => {
    res.send("🌍 AirDlivers bot is live (Webhook OK).");
});

app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log("🌍 Express running on port", PORT);
});

// ========================================================================
// UTILITIES
// ========================================================================

function escapeHtml(str = "") {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function makeRequestId(prefix) {
    return `${prefix}${moment().format("YYMMDDHHmmss")}`;
}

function isValidPhone(v) {
    return /^\+\d{8,15}$/.test(v);
}
function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function parseDate_ddmmyyyy(txt) {
    const m = moment(txt, "DD-MM-YYYY", true);
    return m.isValid() ? m : null;
}
function parseDate_ddmmyy_hhmm(txt) {
    const m = moment(txt, "DD-MM-YY HH:mm", true);
    return m.isValid() ? m : null;
}

// Clean airport names before comparing
function normalizeAirport(str = "") {
    return str.trim().toUpperCase()
        .replace(/\s+AIRPORT\b/g, "")
        .replace(/\s+INTERNATIONAL\b/g, "")
        .replace(/\s+INTL\b/g, "")
        .replace(/\s+/g, " ");
}

function airportsMatch(a, b) {
    return normalizeAirport(a) === normalizeAirport(b);
}

function isWeightCompatible(senderW, travelerW) {
    return Math.abs(Number(senderW) - Number(travelerW)) <= 2;
}

function areDatesClose(senderDate, travelerDeparture) {
    let s = moment(senderDate, "DD-MM-YYYY");
    let t = moment(travelerDeparture, "DD-MM-YY HH:mm");
    return Math.abs(t.diff(s, "days")) <= 1;
}

// ========================================================================
// END OF SEGMENT 1/6
// ========================================================================
// ========================================================================
// SEGMENT 2 / 6 — Sessions, Keyboards, Intro, Suspension System, Help/Support
// ========================================================================

// --------------------------- In-Memory Sessions ---------------------------
const userSessions = {}; 
/*
userSessions[chatId] = {
    type: 'sender'|'traveler'|'tracking',
    step: '...',
    data: {},
    expectingPhoto: null,
    requestId: null
}
*/

// --------------------------- Admin Auth Memory ----------------------------
const adminAuth = {};  
/*
adminAuth[userId] = {
   loggedIn: true/false,
   awaitingPin: true/false,
   super: true/false,
   awaitingCustomReasonFor: requestId | null
}
*/

// ========================================================================
// SUSPENSION SYSTEM (Option A — simple block + message)
// ========================================================================

// Check if user suspended
async function isSuspended(userId) {
    const doc = await suspendedCol.findOne({ userId });
    return !!doc;
}

// Suspend User
async function suspendUser(userId, reason) {
    await suspendedCol.updateOne(
        { userId },
        { $set: { userId, reason, suspendedAt: new Date() } },
        { upsert: true }
    );
}

// Unsuspend User
async function unsuspendUser(userId) {
    await suspendedCol.deleteOne({ userId });
}

// ========================================================================
// MAIN MENU + HELP MENU + INTRO MESSAGE
// ========================================================================

const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📦 Send a Package", callback_data: "flow_sender" }],
            [{ text: "🧳 Traveler",        callback_data: "flow_traveler" }],
            [{ text: "📍 Track Shipment", callback_data: "flow_tracking" }],
            [{ text: "ℹ️ Help / Support", callback_data: "flow_help" }]
        ]
    }
};

function helpMenu(chatId) {
    return bot.sendMessage(
        chatId,
        `<b>ℹ️ Help & Support</b>\n
📘 <b>Instructions:</b>
• Choose <b>Send a Package</b> to ship items internationally.
• Choose <b>Traveler</b> to earn by carrying packages safely.
• Choose <b>Track Shipment</b> using your phone number.

🛡 <b>Privacy Policy:</b>
We store only details required for delivery verification:
Name, Phone, Email, ID/Passport selfie & itinerary.
We do NOT sell or share your data.

☎️ <b>Support Contact:</b>
Email: support@airdlivers.com
Telegram Admins available after starting any service.`,
        { parse_mode: "HTML", disable_web_page_preview: true }
    );
}

// ========================================================================
// /start — Intro message BEFORE main menu
// ========================================================================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // if suspended → only show suspension message
    if (await isSuspended(chatId)) {
        return bot.sendMessage(
            chatId,
            "⛔ <b>Your account is suspended.</b>\nPlease contact: support@airdlivers.com",
            { parse_mode: "HTML" }
        );
    }

    // reset session
    userSessions[chatId] = null;

    const intro =
        `<b>👋 Welcome to AirDlivers!</b>\n\n` +
        `🚀 <b>Fastest next-day global delivery</b> using passenger flight space.\n` +
        `We connect <b>Senders</b> and <b>Travelers</b> securely.\n\n` +
        `Choose an option below to begin.`;

    await bot.sendMessage(chatId, intro, { parse_mode: "HTML", ...mainMenu });
});

// ========================================================================
// HELP & SUPPORT CALLBACK
// ========================================================================

bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // block suspended users
    if (await isSuspended(chatId)) {
        return bot.answerCallbackQuery(query.id, {
            text: "⛔ You are suspended. Contact support@airdlivers.com",
            show_alert: true
        });
    }

    if (data === "flow_help") {
        await helpMenu(chatId);
        return bot.answerCallbackQuery(query.id);
    }

    // Track Shipment
    if (data === "flow_tracking") {
        userSessions[chatId] = {
            type: "tracking",
            step: "enter_phone",
            data: {}
        };
        await bot.sendMessage(chatId, "📍 Enter your phone number (+911234567890):");
        return bot.answerCallbackQuery(query.id);
    }

    // Sender Flow
    if (data === "flow_sender") {
        startSenderFlow(chatId);
        return bot.answerCallbackQuery(query.id);
    }

    // Traveler Flow
    if (data === "flow_traveler") {
        startTravelerFlow(chatId);
        return bot.answerCallbackQuery(query.id);
    }
});

// ========================================================================
// TRACK SHIPMENT FLOW (uses: phone → show status)
// ========================================================================

async function findShipmentByPhone(phone) {
    return (
        await sendersCol.findOne({ "data.phone": phone }) ||
        await travelersCol.findOne({ "data.phone": phone })
    );
}

async function handleTracking(chatId, text) {
    const phone = text.trim();

    if (!isValidPhone(phone)) {
        return bot.sendMessage(chatId, "❌ Invalid phone. Use +911234567890");
    }

    const doc = await findShipmentByPhone(phone);

    if (!doc) {
        return bot.sendMessage(chatId, "❌ No shipment found with this number.");
    }

    return bot.sendMessage(
        chatId,
        `<b>📦 Shipment Status:</b> ${escapeHtml(doc.status || "Pending")}\n` +
        `<b>📝 Admin Note:</b> ${escapeHtml(doc.adminNote || "No notes")}`,
        { parse_mode: "HTML" }
    );
}

// ========================================================================
// END OF SEGMENT 2 / 6
// ========================================================================
// ========================================================================
// SEGMENT 3 / 6 — Sender Flow + Traveler Flow + Photo Handling
// ========================================================================

// ----------------------- CATEGORY KEYBOARD -----------------------
const categoryKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: "📄 Documents", callback_data: "cat_Documents" },
                { text: "🥇 Gold (with bill)", callback_data: "cat_Gold" }
            ],
            [
                { text: "💊 Medicines (Rx only)", callback_data: "cat_Medicines" },
                { text: "👕 Clothes", callback_data: "cat_Clothes" }
            ],
            [
                { text: "🍱 Food (sealed)", callback_data: "cat_Food" },
                { text: "💻 Electronics (bill mandatory)", callback_data: "cat_Electronics" }
            ],
            [
                { text: "🎁 Gifts", callback_data: "cat_Gifts" },
                { text: "⚠️ Prohibited", callback_data: "cat_Prohibited" }
            ]
        ]
    }
};

// ----------------------- CONFIRM KEYBOARD -----------------------
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

// ========================================================================
// START SENDER FLOW
// ========================================================================
function startSenderFlow(chatId) {
    userSessions[chatId] = {
        type: "sender",
        step: "sender_name",
        data: {},
        requestId: null,
        expectingPhoto: null
    };
    bot.sendMessage(chatId, "👤 Enter your Full Name:");
}

// ------------------------ SENDER TEXT STEPS ------------------------
async function handleSenderTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;
    const data = sess.data;

    switch (sess.step) {

        case "sender_name":
            if (text.length < 2) return bot.sendMessage(chatId, "Enter a valid name.");
            data.name = text;
            sess.step = "sender_phone";
            return bot.sendMessage(chatId, "📞 Enter phone number (+911234567890):");

        case "sender_phone":
            if (!isValidPhone(text))
                return bot.sendMessage(chatId, "❌ Invalid phone number format.");
            data.phone = text;
            sess.step = "sender_email";
            return bot.sendMessage(chatId, "📧 Enter your email:");

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
            return bot.sendMessage(chatId, "⚖️ Enter Package Weight (kg):");

        case "package_weight":
            const w = parseFloat(text);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, "❌ Enter a valid weight.");
            if (w > 10) return bot.sendMessage(chatId, "❌ Max allowed is 10kg.");
            data.weight = w;
            sess.step = "package_category";
            return bot.sendMessage(chatId, "📦 Choose category:", categoryKeyboard);

        case "send_date": {
            const d = parseDate_ddmmyyyy(text);
            if (!d) return bot.sendMessage(chatId, "❌ Use format DD-MM-YYYY.");
            data.sendDate = moment(d).format("DD-MM-YYYY");
            sess.step = "arrival_date";
            return bot.sendMessage(chatId, "📅 Enter Arrival Date (DD-MM-YYYY):");
        }

        case "arrival_date": {
            const d = parseDate_ddmmyyyy(text);
            if (!d) return bot.sendMessage(chatId, "❌ Use format DD-MM-YYYY.");
            data.arrivalDate = moment(d).format("DD-MM-YYYY");
            sess.step = "selfie_id";
            sess.expectingPhoto = "selfie_id";
            return bot.sendMessage(chatId, "📸 Upload a selfie holding your ID:");
        }

        case "optional_notes":
            data.notes = (text.toLowerCase() === "none") ? "" : text;
            sess.requestId = makeRequestId("snd");
            sess.step = "confirm_sender";
            return sendSenderSummary(chatId, sess);
    }
}

// ----------------------- SENDER SUMMARY -----------------------
async function sendSenderSummary(chatId, sess) {
    const d = sess.data;

    let summary =
        `<b>📦 Sender Summary</b>\n\n` +
        `<b>ID:</b> <code>${sess.requestId}</code>\n` +
        `<b>Name:</b> ${escapeHtml(d.name)}\n` +
        `<b>Phone:</b> ${escapeHtml(d.phone)}\n` +
        `<b>Email:</b> ${escapeHtml(d.email)}\n` +
        `<b>From:</b> ${escapeHtml(d.pickup)}\n` +
        `<b>To:</b> ${escapeHtml(d.destination)}\n` +
        `<b>Weight:</b> ${escapeHtml(String(d.weight))} kg\n` +
        `<b>Category:</b> ${escapeHtml(d.category)}\n` +
        `<b>Send:</b> ${escapeHtml(d.sendDate)}\n` +
        `<b>Arrival:</b> ${escapeHtml(d.arrivalDate)}\n`;

    if (d.notes) summary += `<b>Notes:</b> ${escapeHtml(d.notes)}\n`;

    await bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("sender", sess.requestId)
    });
}

// ========================================================================
// START TRAVELER FLOW
// ========================================================================
function startTravelerFlow(chatId) {
    userSessions[chatId] = {
        type: "traveler",
        step: "traveler_name",
        data: {},
        requestId: null,
        expectingPhoto: null
    };
    bot.sendMessage(chatId, "👤 Enter your Full Name:");
}

// ------------------------- TRAVELER TEXT STEPS -------------------------
async function handleTravelerTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;
    const data = sess.data;

    switch (sess.step) {

        case "traveler_name":
            if (text.length < 2) return bot.sendMessage(chatId, "Enter a valid name.");
            data.name = text;
            sess.step = "traveler_phone";
            return bot.sendMessage(chatId, "📞 Enter phone number (+911234567890):");

        case "traveler_phone":
            if (!isValidPhone(text))
                return bot.sendMessage(chatId, "❌ Invalid phone.");
            data.phone = text;
            sess.step = "traveler_email";
            return bot.sendMessage(chatId, "📧 Enter your Email:");

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
            if (!d) return bot.sendMessage(chatId, "❌ Use format DD-MM-YY HH:mm.");
            data.departureTime = moment(d).format("DD-MM-YY HH:mm");
            sess.step = "arrival_time";
            return bot.sendMessage(chatId, "⏰ Enter Arrival Time (DD-MM-YY HH:mm):");
        }

        case "arrival_time": {
            const d = parseDate_ddmmyy_hhmm(text);
            if (!d) return bot.sendMessage(chatId, "❌ Use format DD-MM-YY HH:mm.");
            data.arrivalTime = moment(d).format("DD-MM-YY HH:mm");
            sess.step = "available_weight";
            return bot.sendMessage(chatId, "⚖️ Enter Available Weight (Max 10kg):");
        }

        case "available_weight":
            const w = parseFloat(text);
            if (isNaN(w) || w <= 0 || w > 10)
                return bot.sendMessage(chatId, "❌ Enter weight ≤ 10kg.");
            data.availableWeight = w;
            sess.step = "passport_number";
            return bot.sendMessage(chatId, "🛂 Enter Passport Number:");

        case "passport_number":
            data.passportNumber = text;
            sess.expectingPhoto = "passport_selfie";
            sess.step = "passport_selfie";
            return bot.sendMessage(chatId, "📸 Upload a selfie holding passport:");

        case "optional_notes":
            data.notes = (text.toLowerCase() === "none") ? "" : text;
            sess.requestId = makeRequestId("trv");
            sess.step = "confirm_traveler";
            return sendTravelerSummary(chatId, sess);
    }
}

// ----------------------- TRAVELER SUMMARY -----------------------
async function sendTravelerSummary(chatId, sess) {
    const d = sess.data;
    let summary =
        `<b>🧳 Traveler Summary</b>\n\n` +
        `<b>ID:</b> <code>${sess.requestId}</code>\n` +
        `<b>Name:</b> ${escapeHtml(d.name)}\n` +
        `<b>Phone:</b> ${escapeHtml(d.phone)}\n` +
        `<b>Email:</b> ${escapeHtml(d.email)}\n` +
        `<b>From:</b> ${escapeHtml(d.departure)} (${escapeHtml(d.departureCountry)})\n` +
        `<b>To:</b> ${escapeHtml(d.destination)} (${escapeHtml(d.arrivalCountry)})\n` +
        `<b>Departure:</b> ${escapeHtml(d.departureTime)}\n` +
        `<b>Arrival:</b> ${escapeHtml(d.arrivalTime)}\n` +
        `<b>Capacity:</b> ${escapeHtml(String(d.availableWeight))} kg\n` +
        `<b>Passport:</b> ${escapeHtml(d.passportNumber)}\n`;

    if (d.notes) summary += `<b>Notes:</b> ${escapeHtml(d.notes)}\n`;

    await bot.sendMessage(chatId, summary, {
        parse_mode: "HTML",
        ...confirmKeyboard("traveler", sess.requestId)
    });
}

// ========================================================================
// PHOTO HANDLER (Sender & Traveler)
// ========================================================================
bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const sess = userSessions[chatId];
    if (!sess) return;

    // ---------------- SENDER PHOTO FLOW ----------------
    if (sess.type === "sender") {

        if (sess.expectingPhoto === "selfie_id") {
            sess.data.selfieId = fileId;
            sess.expectingPhoto = null;
            sess.step = "optional_notes";
            return bot.sendMessage(chatId, "📝 Add notes (or type 'none'):");
        }
    }

    // ---------------- TRAVELER PHOTO FLOW ----------------
    if (sess.type === "traveler") {

        if (sess.expectingPhoto === "passport_selfie") {
            sess.data.passportSelfie = fileId;
            sess.expectingPhoto = "itinerary_photo";
            sess.step = "itinerary_photo";
            return bot.sendMessage(chatId, "📄 Upload your itinerary/ticket:");
        }

        if (sess.expectingPhoto === "itinerary_photo") {
            sess.data.itineraryPhoto = fileId;
            sess.expectingPhoto = null;
            sess.step = "optional_notes";
            return bot.sendMessage(chatId, "📝 Add notes (or type 'none'):");
        }
    }
});

// ========================================================================
// END OF SEGMENT 3 / 6
// ========================================================================
// ------------------- Segment-4-MATCH CALLBACKS -------------------
async function handleMatchCallback(query) {
  const data = query.data;
  const parts = data.split('_');
  if (parts.length < 5) {
    await bot.answerCallbackQuery(query.id, { text: 'Invalid match token.' });
    return;
  }
  const side = parts[1];
  const action = parts[2];
  const myReqId = parts[3];
  const otherReqId = parts[4];
  const fromUserId = query.from.id;

  if (action === 'skip') {
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: 'Skipped.' });
    return;
  }

  if (action === 'conf') {
    const myRole = (side === 's') ? 'sender' : 'traveler';
    await handleUserMatchConfirm(myRole, myReqId, otherReqId, fromUserId, query);
    return;
  }
  await bot.answerCallbackQuery(query.id, { text: 'Unknown match action.' });
}

async function handleUserMatchConfirm(myRole, myReqId, otherReqId, userId, query) {
  try {
    const myCol = myRole === 'sender' ? sendersCol : travelersCol;
    const otherCol = myRole === 'sender' ? travelersCol : sendersCol;

    const myDoc = await myCol.findOne({ requestId: myReqId });
    const otherDoc = await otherCol.findOne({ requestId: otherReqId });
    if (!myDoc || !otherDoc) {
      await bot.answerCallbackQuery(query.id, { text: 'Match expired.' });
      return;
    }

    if (String(myDoc.userId) !== String(userId)) {
      await bot.answerCallbackQuery(query.id, { text: 'Not your match card.' });
      return;
    }

    if (myDoc.status !== 'Approved' || otherDoc.status !== 'Approved') {
      await bot.answerCallbackQuery(query.id, { text: 'Request not approved anymore.' });
      return;
    }

    if (myDoc.matchLocked || otherDoc.matchLocked) {
      await bot.answerCallbackQuery(query.id, { text: 'Already matched.' });
      return;
    }

    if (myDoc.pendingMatchWith && myDoc.pendingMatchWith !== otherReqId) {
      await bot.answerCallbackQuery(query.id, { text: 'You confirmed another match.' });
      return;
    }

    // second confirmation
    if (otherDoc.pendingMatchWith === myReqId) {
      await myCol.updateOne(
        { requestId: myReqId },
        { $set: { matchLocked: true, matchedWith: otherReqId }, $unset: { pendingMatchWith: '' } }
      );
      await otherCol.updateOne(
        { requestId: otherReqId },
        { $set: { matchLocked: true, matchedWith: myReqId }, $unset: { pendingMatchWith: '' } }
      );

      await bot.sendMessage(
        myDoc.userId,
        `🤝 Match Confirmed!\nYou can now chat with your partner.`,
      );
      await bot.sendMessage(
        otherDoc.userId,
        `🤝 Match Confirmed!\nYou can now chat with your partner.`,
      );

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      }).catch(() => {});

      await bot.answerCallbackQuery(query.id, { text: 'Match confirmed.' });
      return;
    }

    // first confirmation
    await myCol.updateOne({ requestId: myReqId }, { $set: { pendingMatchWith: otherReqId } });
    await bot.answerCallbackQuery(query.id, { text: 'Waiting for other user.' });

  } catch (err) {
    await bot.answerCallbackQuery(query.id, { text: 'Error confirming match.' });
  }
}

// ------------------- MATCHED USER CHAT FORWARDING -------------------
async function findActiveMatchForUser(userId) {
  const s = await sendersCol.findOne({ userId, matchLocked: true });
  const t = await travelersCol.findOne({ userId, matchLocked: true });
  if (!s && !t) return null;
  if (s && !t) return s;
  if (!s && t) return t;

  const sTime = s.matchFinalizedAt || s.createdAt;
  const tTime = t.matchFinalizedAt || t.createdAt;
  return sTime >= tTime ? s : t;
}

async function tryForwardChatMessage(chatId, text) {
  if (String(chatId) === String(ADMIN_GROUP_ID)) return false;
  const myDoc = await findActiveMatchForUser(chatId);
  if (!myDoc) return false;

  const otherCol = myDoc.role === 'sender' ? travelersCol : sendersCol;
  const otherDoc = await otherCol.findOne({ requestId: myDoc.matchedWith });
  if (!otherDoc) return false;

  await bot.sendMessage(otherDoc.userId, text);
  await bot.sendMessage(ADMIN_GROUP_ID, `Chat: ${myDoc.requestId} → ${otherDoc.requestId}\n${text}`);
  return true;
}
// ========================================================================
// END OF SEGMENT 4 / 6
// ------------------- PHOTO HANDLER -------------------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const session = userSessions[chatId];

  if (session) {
    if (session.expectingPhoto === 'package_photo') {
      session.data.packagePhoto = fileId;
      session.expectingPhoto = null;
      session.step = 'send_date';
      return bot.sendMessage(chatId, '📅 Enter Send Date (DD-MM-YYYY):');
    }

    if (session.expectingPhoto === 'selfie_id') {
      session.data.selfieId = fileId;
      session.expectingPhoto = null;
      session.step = 'optional_notes';
      return bot.sendMessage(chatId, "📝 Add notes or type 'None':");
    }

    if (session.expectingPhoto === 'passport_selfie') {
      session.data.passportSelfie = fileId;
      session.expectingPhoto = 'itinerary_photo';
      session.step = 'itinerary_photo';
      return bot.sendMessage(chatId, '📄 Upload Itinerary Photo:');
    }

    if (session.expectingPhoto === 'itinerary_photo') {
      session.data.itineraryPhoto = fileId;
      session.expectingPhoto = null;
      session.step = 'optional_notes';
      return bot.sendMessage(chatId, "📝 Add notes or type 'None':");
    }
  }

  // visa upload (after admin requests)
  const visaReq = await travelersCol.findOne({ userId: chatId, status: 'VisaRequested' });
  if (visaReq) {
    await travelersCol.updateOne(
      { requestId: visaReq.requestId },
      { $set: { 'data.visaPhoto': fileId, status: 'VisaUploaded' } }
    );

    await bot.sendPhoto(ADMIN_GROUP_ID, fileId, {
      caption: `🛂 Visa Uploaded: ${visaReq.requestId}`
    });

    await bot.sendMessage(
      ADMIN_GROUP_ID,
      `Admin actions for <code>${visaReq.requestId}</code>:`,
      { parse_mode: 'HTML', ...adminActionKeyboardForDoc({ requestId: visaReq.requestId, role: 'traveler', status: 'VisaUploaded' }) }
    );

    return bot.sendMessage(chatId, 'Visa received. Admin will review.');
  }
});

// ------------------- SENDER FLOW (TEXT STEPS) -------------------
async function handleSenderTextStep(chatId, text) {
  const sess = userSessions[chatId];
  const data = sess.data;

  switch (sess.step) {
    case 'sender_name':
      data.name = text;
      sess.step = 'sender_phone';
      return bot.sendMessage(chatId, '📞 Enter your phone (+911234567890):');

    case 'sender_phone':
      if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone.');
      data.phone = text;
      sess.step = 'sender_email';
      return bot.sendMessage(chatId, '📧 Enter your email:');

    case 'sender_email':
      if (!isValidEmail(text)) return bot.sendMessage(chatId, '❌ Invalid email.');
      data.email = text;
      sess.step = 'pickup_airport';
      return bot.sendMessage(chatId, '🛫 Enter Pickup Airport:');

    case 'pickup_airport':
      data.pickup = text;
      sess.step = 'destination_airport';
      return bot.sendMessage(chatId, '🛬 Enter Destination Airport:');

    case 'destination_airport':
      data.destination = text;
      sess.step = 'package_weight';
      return bot.sendMessage(chatId, '⚖ Weight in kg (max 10):');

    case 'package_weight':
      const w = parseFloat(text);
      if (!w || w > 10) return bot.sendMessage(chatId, 'Invalid weight (max 10kg).');
      data.weight = w;
      sess.step = 'package_category';
      return bot.sendMessage(chatId, 'Choose category:', categoryKeyboard);

    case 'send_date': {
      const d = parseDate_ddmmyyyy(text);
      if (!d) return bot.sendMessage(chatId, 'Invalid date.');
      data.sendDate = moment(d).format('DD-MM-YYYY');
      sess.step = 'arrival_date';
      return bot.sendMessage(chatId, '📅 Enter Arrival Date (DD-MM-YYYY):');
    }

    case 'arrival_date': {
      const d = parseDate_ddmmyyyy(text);
      if (!d) return bot.sendMessage(chatId, 'Invalid date.');
      data.arrivalDate = moment(d).format('DD-MM-YYYY');
      sess.step = 'selfie_id';
      sess.expectingPhoto = 'selfie_id';
      return bot.sendMessage(chatId, '📸 Upload selfie holding ID:');
    }

    case 'optional_notes':
      data.notes = text === 'None' ? '' : text;
      sess.requestId = makeRequestId('snd');
      sess.step = 'confirm_pending';
      return sendSenderSummary(chatId, sess);
  }
}

async function sendSenderSummary(chatId, sess) {
  const d = sess.data;
  let html = `<b>📦 Sender Summary</b>\n\n`;
  html += `ID: <code>${sess.requestId}</code>\n`;
  html += `Name: ${d.name}\n`;
  html += `Phone: ${d.phone}\n`;
  html += `Email: ${d.email}\n`;
  html += `From: ${d.pickup}\n`;
  html += `To: ${d.destination}\n`;
  html += `Weight: ${d.weight}kg\n`;
  html += `Category: ${d.category}\n`;
  html += `Send Date: ${d.sendDate}\n`;
  html += `Arrival Date: ${d.arrivalDate}\n`;
  await bot.sendMessage(chatId, html, {
    parse_mode: 'HTML',
    ...confirmKeyboard('sender', sess.requestId)
  });
}

// ------------------- TRAVELER FLOW (TEXT STEPS) -------------------
async function handleTravelerTextStep(chatId, text) {
  const sess = userSessions[chatId];
  const d = sess.data;

  switch (sess.step) {
    case 'traveler_name':
      d.name = text;
      sess.step = 'traveler_phone';
      return bot.sendMessage(chatId, '📞 Enter your phone (+911234567890):');

    case 'traveler_phone':
      if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone.');
      d.phone = text;
      sess.step = 'departure_airport';
      return bot.sendMessage(chatId, '🛫 Enter Departure Airport:');

    case 'departure_airport':
      d.departure = text;
      sess.step = 'departure_country';
      return bot.sendMessage(chatId, '🌍 Enter Departure Country:');

    case 'departure_country':
      d.departureCountry = text;
      sess.step = 'destination_airport';
      return bot.sendMessage(chatId, '🛬 Enter Destination Airport:');

    case 'destination_airport':
      d.destination = text;
      sess.step = 'arrival_country';
      return bot.sendMessage(chatId, '🌍 Enter Arrival Country:');

    case 'arrival_country':
      d.arrivalCountry = text;
      sess.step = 'departure_time';
      return bot.sendMessage(chatId, '⏰ Enter Departure Time (DD-MM-YY HH:mm):');

    case 'departure_time': {
      const dt = parseDate_ddmmyy_hhmm(text);
      if (!dt) return bot.sendMessage(chatId, 'Invalid date/time.');
      d.departureTime = moment(dt).format('DD-MM-YY HH:mm');
      sess.step = 'arrival_time';
      return bot.sendMessage(chatId, '⏰ Enter Arrival Time (DD-MM-YY HH:mm):');
    }

    case 'arrival_time': {
      const dt = parseDate_ddmmyy_hhmm(text);
      if (!dt) return bot.sendMessage(chatId, 'Invalid date/time.');
      d.arrivalTime = moment(dt).format('DD-MM-YY HH:mm');
      sess.step = 'available_weight';
      return bot.sendMessage(chatId, '⚖ Available weight (kg):');
    }

    case 'available_weight':
      const w = parseFloat(text);
      if (!w || w > 10) return bot.sendMessage(chatId, 'Invalid weight (max 10kg).');
      d.availableWeight = w;
      sess.step = 'passport_number';
      return bot.sendMessage(chatId, '🛂 Enter Passport Number:');

    case 'passport_number':
      d.passportNumber = text;
      sess.expectingPhoto = 'passport_selfie';
      sess.step = 'passport_selfie';
      return bot.sendMessage(chatId, '📸 Upload selfie holding passport:');

    case 'optional_notes':
      d.notes = text === 'None' ? '' : text;
      sess.requestId = makeRequestId('trv');
      sess.step = 'confirm_pending';
      return sendTravelerSummary(chatId, sess);
  }
}

async function sendTravelerSummary(chatId, sess) {
  const d = sess.data;
  let html = `<b>🧳 Traveler Summary</b>\n\n`;
  html += `ID: <code>${sess.requestId}</code>\n`;
  html += `Name: ${d.name}\n`;
  html += `Phone: ${d.phone}\n`;
  html += `Route: ${d.departure} → ${d.destination}\n`;
  html += `Departure: ${d.departureTime}\n`;
  html += `Arrival: ${d.arrivalTime}\n`;
  html += `Weight: ${d.availableWeight}kg\n`;
  html += `Passport: ${d.passportNumber}\n`;
  await bot.sendMessage(chatId, html, {
    parse_mode: 'HTML',
    ...confirmKeyboard('traveler', sess.requestId)
  });
}

// ------------------- FINAL SENDER SUBMIT -------------------
async function handleFinalSenderSubmit(chatId, session) {
  const doc = {
    requestId: session.requestId,
    userId: chatId,
    role: 'sender',
    data: session.data,
    status: 'Pending',
    createdAt: new Date()
  };

  await sendersCol.insertOne(doc);
  await bot.sendMessage(chatId, `Submitted for approval. ID: ${session.requestId}`);
  await bot.sendMessage(chatId, 'Returning to menu:', mainMenuInline);

  bot.sendMessage(ADMIN_GROUP_ID, `📦 New Sender: ${session.requestId}`);
  userSessions[chatId] = null;
}

// ------------------- FINAL TRAVELER SUBMIT -------------------
async function handleFinalTravelerSubmit(chatId, session) {
  const doc = {
    requestId: session.requestId,
    userId: chatId,
    role: 'traveler',
    data: session.data,
    status: 'Pending',
    createdAt: new Date()
  };

  await travelersCol.insertOne(doc);
  await bot.sendMessage(chatId, `Submitted for approval. ID: ${session.requestId}`);
  await bot.sendMessage(chatId, 'Returning to menu:', mainMenuInline);

  bot.sendMessage(ADMIN_GROUP_ID, `🧳 New Traveler: ${session.requestId}`);
  userSessions[chatId] = null;
}

// ------------------- ADMIN APPROVE -------------------
async function processApprove(requestId) {
  const col = await findCol(requestId);
  if (!col) return;

  await col.updateOne({ requestId }, { $set: { status: 'Approved' } });
  const user = await col.findOne({ requestId });

  bot.sendMessage(user.userId, `✅ Approved: ${requestId}`);
  bot.sendMessage(user.userId, 'Returning to menu:', mainMenuInline);
  bot.sendMessage(ADMIN_GROUP_ID, `Admin approved ${requestId}`);

  triggerMatchingForRequest(user.role, requestId);
}

// ------------------- ADMIN REJECT -------------------
async function processReject(requestId, reason) {
  const col = await findCol(requestId);
  if (!col) return;

  await col.updateOne(
    { requestId },
    { $set: { status: 'Rejected', adminNote: reason }, $unset: { matchLocked: '', matchedWith: '' } }
  );

  const user = await col.findOne({ requestId });

  bot.sendMessage(user.userId, `❌ Rejected: ${requestId}\nReason: ${reason}`);
  bot.sendMessage(user.userId, 'Returning to menu:', mainMenuInline);
}

// ------------------- ADMIN VISA REQUEST -------------------
async function processRequestVisa(requestId) {
  await travelersCol.updateOne(
    { requestId },
    { $set: { status: 'VisaRequested' } }
  );
}
// ------------------- Segment-5 -------------------
// ------------------- PHOTO HANDLER -------------------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const session = userSessions[chatId];

  if (session) {
    if (session.expectingPhoto === 'package_photo') {
      session.data.packagePhoto = fileId;
      session.expectingPhoto = null;
      session.step = 'send_date';
      return bot.sendMessage(chatId, '📅 Enter Send Date (DD-MM-YYYY):');
    }

    if (session.expectingPhoto === 'selfie_id') {
      session.data.selfieId = fileId;
      session.expectingPhoto = null;
      session.step = 'optional_notes';
      return bot.sendMessage(chatId, "📝 Add notes or type 'None':");
    }

    if (session.expectingPhoto === 'passport_selfie') {
      session.data.passportSelfie = fileId;
      session.expectingPhoto = 'itinerary_photo';
      session.step = 'itinerary_photo';
      return bot.sendMessage(chatId, '📄 Upload Itinerary Photo:');
    }

    if (session.expectingPhoto === 'itinerary_photo') {
      session.data.itineraryPhoto = fileId;
      session.expectingPhoto = null;
      session.step = 'optional_notes';
      return bot.sendMessage(chatId, "📝 Add notes or type 'None':");
    }
  }

  // visa upload (after admin requests)
  const visaReq = await travelersCol.findOne({ userId: chatId, status: 'VisaRequested' });
  if (visaReq) {
    await travelersCol.updateOne(
      { requestId: visaReq.requestId },
      { $set: { 'data.visaPhoto': fileId, status: 'VisaUploaded' } }
    );

    await bot.sendPhoto(ADMIN_GROUP_ID, fileId, {
      caption: `🛂 Visa Uploaded: ${visaReq.requestId}`
    });

    await bot.sendMessage(
      ADMIN_GROUP_ID,
      `Admin actions for <code>${visaReq.requestId}</code>:`,
      { parse_mode: 'HTML', ...adminActionKeyboardForDoc({ requestId: visaReq.requestId, role: 'traveler', status: 'VisaUploaded' }) }
    );

    return bot.sendMessage(chatId, 'Visa received. Admin will review.');
  }
});

// ------------------- SENDER FLOW (TEXT STEPS) -------------------
async function handleSenderTextStep(chatId, text) {
  const sess = userSessions[chatId];
  const data = sess.data;

  switch (sess.step) {
    case 'sender_name':
      data.name = text;
      sess.step = 'sender_phone';
      return bot.sendMessage(chatId, '📞 Enter your phone (+911234567890):');

    case 'sender_phone':
      if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone.');
      data.phone = text;
      sess.step = 'sender_email';
      return bot.sendMessage(chatId, '📧 Enter your email:');

    case 'sender_email':
      if (!isValidEmail(text)) return bot.sendMessage(chatId, '❌ Invalid email.');
      data.email = text;
      sess.step = 'pickup_airport';
      return bot.sendMessage(chatId, '🛫 Enter Pickup Airport:');

    case 'pickup_airport':
      data.pickup = text;
      sess.step = 'destination_airport';
      return bot.sendMessage(chatId, '🛬 Enter Destination Airport:');

    case 'destination_airport':
      data.destination = text;
      sess.step = 'package_weight';
      return bot.sendMessage(chatId, '⚖ Weight in kg (max 10):');

    case 'package_weight':
      const w = parseFloat(text);
      if (!w || w > 10) return bot.sendMessage(chatId, 'Invalid weight (max 10kg).');
      data.weight = w;
      sess.step = 'package_category';
      return bot.sendMessage(chatId, 'Choose category:', categoryKeyboard);

    case 'send_date': {
      const d = parseDate_ddmmyyyy(text);
      if (!d) return bot.sendMessage(chatId, 'Invalid date.');
      data.sendDate = moment(d).format('DD-MM-YYYY');
      sess.step = 'arrival_date';
      return bot.sendMessage(chatId, '📅 Enter Arrival Date (DD-MM-YYYY):');
    }

    case 'arrival_date': {
      const d = parseDate_ddmmyyyy(text);
      if (!d) return bot.sendMessage(chatId, 'Invalid date.');
      data.arrivalDate = moment(d).format('DD-MM-YYYY');
      sess.step = 'selfie_id';
      sess.expectingPhoto = 'selfie_id';
      return bot.sendMessage(chatId, '📸 Upload selfie holding ID:');
    }

    case 'optional_notes':
      data.notes = text === 'None' ? '' : text;
      sess.requestId = makeRequestId('snd');
      sess.step = 'confirm_pending';
      return sendSenderSummary(chatId, sess);
  }
}

async function sendSenderSummary(chatId, sess) {
  const d = sess.data;
  let html = `<b>📦 Sender Summary</b>\n\n`;
  html += `ID: <code>${sess.requestId}</code>\n`;
  html += `Name: ${d.name}\n`;
  html += `Phone: ${d.phone}\n`;
  html += `Email: ${d.email}\n`;
  html += `From: ${d.pickup}\n`;
  html += `To: ${d.destination}\n`;
  html += `Weight: ${d.weight}kg\n`;
  html += `Category: ${d.category}\n`;
  html += `Send Date: ${d.sendDate}\n`;
  html += `Arrival Date: ${d.arrivalDate}\n`;
  await bot.sendMessage(chatId, html, {
    parse_mode: 'HTML',
    ...confirmKeyboard('sender', sess.requestId)
  });
}

// ------------------- TRAVELER FLOW (TEXT STEPS) -------------------
async function handleTravelerTextStep(chatId, text) {
  const sess = userSessions[chatId];
  const d = sess.data;

  switch (sess.step) {
    case 'traveler_name':
      d.name = text;
      sess.step = 'traveler_phone';
      return bot.sendMessage(chatId, '📞 Enter your phone (+911234567890):');

    case 'traveler_phone':
      if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone.');
      d.phone = text;
      sess.step = 'departure_airport';
      return bot.sendMessage(chatId, '🛫 Enter Departure Airport:');

    case 'departure_airport':
      d.departure = text;
      sess.step = 'departure_country';
      return bot.sendMessage(chatId, '🌍 Enter Departure Country:');

    case 'departure_country':
      d.departureCountry = text;
      sess.step = 'destination_airport';
      return bot.sendMessage(chatId, '🛬 Enter Destination Airport:');

    case 'destination_airport':
      d.destination = text;
      sess.step = 'arrival_country';
      return bot.sendMessage(chatId, '🌍 Enter Arrival Country:');

    case 'arrival_country':
      d.arrivalCountry = text;
      sess.step = 'departure_time';
      return bot.sendMessage(chatId, '⏰ Enter Departure Time (DD-MM-YY HH:mm):');

    case 'departure_time': {
      const dt = parseDate_ddmmyy_hhmm(text);
      if (!dt) return bot.sendMessage(chatId, 'Invalid date/time.');
      d.departureTime = moment(dt).format('DD-MM-YY HH:mm');
      sess.step = 'arrival_time';
      return bot.sendMessage(chatId, '⏰ Enter Arrival Time (DD-MM-YY HH:mm):');
    }

    case 'arrival_time': {
      const dt = parseDate_ddmmyy_hhmm(text);
      if (!dt) return bot.sendMessage(chatId, 'Invalid date/time.');
      d.arrivalTime = moment(dt).format('DD-MM-YY HH:mm');
      sess.step = 'available_weight';
      return bot.sendMessage(chatId, '⚖ Available weight (kg):');
    }

    case 'available_weight':
      const w = parseFloat(text);
      if (!w || w > 10) return bot.sendMessage(chatId, 'Invalid weight (max 10kg).');
      d.availableWeight = w;
      sess.step = 'passport_number';
      return bot.sendMessage(chatId, '🛂 Enter Passport Number:');

    case 'passport_number':
      d.passportNumber = text;
      sess.expectingPhoto = 'passport_selfie';
      sess.step = 'passport_selfie';
      return bot.sendMessage(chatId, '📸 Upload selfie holding passport:');

    case 'optional_notes':
      d.notes = text === 'None' ? '' : text;
      sess.requestId = makeRequestId('trv');
      sess.step = 'confirm_pending';
      return sendTravelerSummary(chatId, sess);
  }
}

async function sendTravelerSummary(chatId, sess) {
  const d = sess.data;
  let html = `<b>🧳 Traveler Summary</b>\n\n`;
  html += `ID: <code>${sess.requestId}</code>\n`;
  html += `Name: ${d.name}\n`;
  html += `Phone: ${d.phone}\n`;
  html += `Route: ${d.departure} → ${d.destination}\n`;
  html += `Departure: ${d.departureTime}\n`;
  html += `Arrival: ${d.arrivalTime}\n`;
  html += `Weight: ${d.availableWeight}kg\n`;
  html += `Passport: ${d.passportNumber}\n`;
  await bot.sendMessage(chatId, html, {
    parse_mode: 'HTML',
    ...confirmKeyboard('traveler', sess.requestId)
  });
}

// ------------------- FINAL SENDER SUBMIT -------------------
async function handleFinalSenderSubmit(chatId, session) {
  const doc = {
    requestId: session.requestId,
    userId: chatId,
    role: 'sender',
    data: session.data,
    status: 'Pending',
    createdAt: new Date()
  };

  await sendersCol.insertOne(doc);
  await bot.sendMessage(chatId, `Submitted for approval. ID: ${session.requestId}`);
  await bot.sendMessage(chatId, 'Returning to menu:', mainMenuInline);

  bot.sendMessage(ADMIN_GROUP_ID, `📦 New Sender: ${session.requestId}`);
  userSessions[chatId] = null;
}

// ------------------- FINAL TRAVELER SUBMIT -------------------
async function handleFinalTravelerSubmit(chatId, session) {
  const doc = {
    requestId: session.requestId,
    userId: chatId,
    role: 'traveler',
    data: session.data,
    status: 'Pending',
    createdAt: new Date()
  };

  await travelersCol.insertOne(doc);
  await bot.sendMessage(chatId, `Submitted for approval. ID: ${session.requestId}`);
  await bot.sendMessage(chatId, 'Returning to menu:', mainMenuInline);

  bot.sendMessage(ADMIN_GROUP_ID, `🧳 New Traveler: ${session.requestId}`);
  userSessions[chatId] = null;
}

// ------------------- ADMIN APPROVE -------------------
async function processApprove(requestId) {
  const col = await findCol(requestId);
  if (!col) return;

  await col.updateOne({ requestId }, { $set: { status: 'Approved' } });
  const user = await col.findOne({ requestId });

  bot.sendMessage(user.userId, `✅ Approved: ${requestId}`);
  bot.sendMessage(user.userId, 'Returning to menu:', mainMenuInline);
  bot.sendMessage(ADMIN_GROUP_ID, `Admin approved ${requestId}`);

  triggerMatchingForRequest(user.role, requestId);
}

// ------------------- ADMIN REJECT -------------------
async function processReject(requestId, reason) {
  const col = await findCol(requestId);
  if (!col) return;

  await col.updateOne(
    { requestId },
    { $set: { status: 'Rejected', adminNote: reason }, $unset: { matchLocked: '', matchedWith: '' } }
  );

  const user = await col.findOne({ requestId });

  bot.sendMessage(user.userId, `❌ Rejected: ${requestId}\nReason: ${reason}`);
  bot.sendMessage(user.userId, 'Returning to menu:', mainMenuInline);
}

// ------------------- ADMIN VISA REQUEST -------------------
async function processRequestVisa(requestId) {
  await travelersCol.updateOne(
    { requestId },
    { $set: { status: 'VisaRequested' } }
  );
}
// ================================================================
// SEGMENT 6A — USER SUSPEND / UNSUSPEND / TERMINATE ENGINE
// ================================================================

// COLLECTION FOR USER STATES
const userStateCol = db.collection("userStates");
/*
 userState schema:
 {
    userId: Number,
    suspended: Boolean,
    suspendedReason: String,
    terminated: Boolean,
    terminatedReason: String,
    updatedAt: Date
 }
*/

// -------------- GET USER STATE ----------------
async function getUserState(userId) {
  return (
    (await userStateCol.findOne({ userId })) || {
      userId,
      suspended: false,
      suspendedReason: "",
      terminated: false,
      terminatedReason: "",
    }
  );
}

// -------------- SET USER STATE ----------------
async function setUserState(userId, update) {
  await userStateCol.updateOne(
    { userId },
    { $set: { ...update, updatedAt: new Date() } },
    { upsert: true }
  );
}

// -------------- CHECK SUSPENSION / TERMINATION ----------------
async function blockIfSuspendedOrTerminated(chatId) {
  const state = await getUserState(chatId);

  // TERMINATED → cannot use anything. Only /start menu allowed.
  if (state.terminated === true) {
    await bot.sendMessage(
      chatId,
      `⛔ <b>Your conversation was terminated</b>\nReason: ${escapeHtml(
        state.terminatedReason || "Unknown"
      )}\n\n👉 Please press /start to begin again.`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  // SUSPENDED (cannot use bot)
  if (state.suspended === true) {
    await bot.sendMessage(
      chatId,
      `🚫 <b>Your account is suspended.</b>\nReason: ${escapeHtml(
        state.suspendedReason || "Not provided"
      )}\n\nFor help, contact: support@airdlivers.com`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  return false;
}

// =================================================================
// ADMIN COMMANDS — ONLY IN ADMIN GROUP OR BY SUPER ADMIN
// =================================================================

bot.onText(/\/suspend (\d+) (.+)/, async (msg, match) => {
  const adminId = msg.from.id;
  if (
    String(adminId) !== String(SUPER_ADMIN_ID) &&
    !adminAuth[adminId]?.loggedIn
  ) {
    return bot.sendMessage(msg.chat.id, "❌ Not authorized.");
  }

  const userId = Number(match[1]);
  const reason = match[2];

  await setUserState(userId, {
    suspended: true,
    suspendedReason: reason,
    terminated: false,
    terminatedReason: "",
  });

  await bot.sendMessage(
    msg.chat.id,
    `✅ User <code>${userId}</code> suspended.\nReason: ${escapeHtml(reason)}`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.sendMessage(
      userId,
      `🚫 <b>Your AirDlivers account has been suspended.</b>\nReason: ${escapeHtml(
        reason
      )}\n\nContact: support@airdlivers.com`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});

// --------------------------------------------------

bot.onText(/\/unsuspend (\d+)/, async (msg, match) => {
  const adminId = msg.from.id;

  if (
    String(adminId) !== String(SUPER_ADMIN_ID) &&
    !adminAuth[adminId]?.loggedIn
  ) {
    return bot.sendMessage(msg.chat.id, "❌ Not authorized.");
  }

  const userId = Number(match[1]);

  await setUserState(userId, {
    suspended: false,
    suspendedReason: "",
  });

  await bot.sendMessage(
    msg.chat.id,
    `🟢 User <code>${userId}</code> unsuspended.`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.sendMessage(
      userId,
      `✅ Your account has been restored.\nYou may now continue using AirDlivers.`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});

// --------------------------------------------------

bot.onText(/\/terminatechat (\d+) (.+)/, async (msg, match) => {
  const adminId = msg.from.id;

  if (
    String(adminId) !== String(SUPER_ADMIN_ID) &&
    !adminAuth[adminId]?.loggedIn
  ) {
    return bot.sendMessage(msg.chat.id, "❌ Not authorized.");
  }

  const userId = Number(match[1]);
  const reason = match[2];

  await setUserState(userId, {
    terminated: true,
    terminatedReason: reason,
    suspended: false,
    suspendedReason: "",
  });

  await bot.sendMessage(
    msg.chat.id,
    `🛑 Chat for user <code>${userId}</code> terminated.\nReason: ${escapeHtml(
      reason
    )}`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.sendMessage(
      userId,
      `⛔ <b>Your chat has been terminated.</b>\nReason: ${escapeHtml(
        reason
      )}\n\nPlease press /start to begin again.`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});
// ================================================================
// SEGMENT 6B — HELP / SUPPORT + TRACKING + START INTRO
// ================================================================

// --------------------------- START INTRO ---------------------------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // check suspension / termination
  const blocked = await blockIfSuspendedOrTerminated(chatId);
  if (blocked) return;

  userSessions[chatId] = null;

  const intro =
    `<b>👋 Welcome to AirDlivers!</b>\n\n` +
    `🚀 <i>Next-day international delivery using unused airline baggage space.</i>\n\n` +
    `Choose an option below to begin:`;

  await bot.sendMessage(chatId, intro, {
    parse_mode: "HTML",
    ...mainMenuInline,
  });
});

// --------------------------- HELP / SUPPORT ---------------------------
function helpSupport(chatId) {
  const msg =
    `<b>ℹ️ HELP & SUPPORT</b>\n\n` +
    `Here’s how to use AirDlivers:\n\n` +
    `📦 <b>Send a Package</b>\nProvide your details, package weight, category & ID verification.\n\n` +
    `🧳 <b>Traveler</b>\nList your travel route, upload passport selfie + itinerary.\n\n` +
    `📍 <b>Track Shipment</b>\nEnter phone number used during registration.\n\n` +
    `🛂 <b>Suspended?</b>\nIf suspended, you will see: “Your account is suspended. Contact support.”\n\n` +
    `📞 <b>Support Contact</b>\nEmail: <a href="mailto:support@airdlivers.com">support@airdlivers.com</a>\nTelegram Support Group: <a href="https://t.me/+CAntejDg9plmNWI0">Join Here</a>\n\n` +
    `<i>Thank you for using AirDlivers!</i>`;

  bot.sendMessage(chatId, msg, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

bot.onText(/\/help/, (msg) => helpSupport(msg.chat.id));

bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  // check suspension / termination
  const blocked = await blockIfSuspendedOrTerminated(chatId);
  if (blocked) return bot.answerCallbackQuery(query.id);

  if (data === "flow_help") {
    helpSupport(chatId);
    return bot.answerCallbackQuery(query.id);
  }
});

// --------------------------- TRACKING FLOW ---------------------------

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "flow_tracking") {
    const blocked = await blockIfSuspendedOrTerminated(chatId);
    if (blocked) return bot.answerCallbackQuery(query.id);

    userSessions[chatId] = {
      type: "tracking",
      step: "tracking_phone",
      data: {},
    };

    await bot.sendMessage(
      chatId,
      "📍 Enter the phone number used for shipment:\n\nExample: +911234567890",
      { parse_mode: "HTML" }
    );
    return bot.answerCallbackQuery(query.id);
  }
});

// --------------------------- TRACKING TEXT INPUT ---------------------------

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  // check suspension / termination
  const blocked = await blockIfSuspendedOrTerminated(chatId);
  if (blocked) return;

  const session = userSessions[chatId];
  if (!session) return;

  if (session.type === "tracking" && session.step === "tracking_phone") {
    if (!isValidPhone(text))
      return bot.sendMessage(chatId, "❌ Invalid phone format. Use +911234567890");

    // FIND SENDER OR TRAVELER BY PHONE
    const sender = await sendersCol.findOne({ "data.phone": text });
    const traveler = await travelersCol.findOne({ "data.phone": text });

    const doc = sender || traveler;
    if (!doc)
      return bot.sendMessage(chatId, "❌ No shipment/travel found for that number.");

    const status = doc.status || "Pending";
    const note = doc.adminNote || "— No Admin Note —";

    const msg =
      `<b>📦 STATUS UPDATE</b>\n\n` +
      `<b>Status:</b> ${escapeHtml(status)}\n` +
      `<b>Admin Note:</b> ${escapeHtml(note)}\n\n` +
      `🔁 <i>For more help, choose Help / Support from Menu.</i>`;

    await bot.sendMessage(chatId, msg, { parse_mode: "HTML" });

    userSessions[chatId] = null;
    return;
  }
});
// ================================================================
// END OF SEGMENT 6B
// ================================================================
