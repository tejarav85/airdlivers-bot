// bot.js - AirDlivers production bot (webhook + auto-recovery)
// package.json must have: { "type": "module" }

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import { MongoClient, ObjectId } from 'mongodb';
import moment from 'moment';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from "cors";
import express from 'express';
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Readable } from "stream";
import fetch from "node-fetch";

// ------------------- __dirname for ES modules -------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOADS_DIR = join(__dirname, "uploads");
const { ensureDir } = fs;
ensureDir(UPLOADS_DIR);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadMemory = multer({ storage: multer.memoryStorage() }); // for logic that needs raw buffer

// ------------------- ENV -------------------
// ------------------- ENV -------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || '';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const SUPPORT_GROUP_ID = process.env.SUPPORT_GROUP_ID || ADMIN_GROUP_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const SUPPORT_GROUP_PIN = process.env.SUPPORT_GROUP_PIN || "1848";
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'airdlivers';
const JWT_SECRET = process.env.JWT_SECRET || "secret";
const BASE_URL = process.env.BASE_URL;   // ✅ FIRST CREATE THIS

// ✅ ONLY AFTER BASE_URL EXISTS
const PORT = process.env.PORT || 8080;
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${BASE_URL}${WEBHOOK_PATH}`;

console.log("BASE_URL =", BASE_URL);
console.log("WEBHOOK_URL =", WEBHOOK_URL);
if (!BOT_TOKEN) { console.error('FATAL: BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error('FATAL: ADMIN_GROUP_ID missing'); process.exit(1); }
if (!ADMIN_PIN) { console.error('FATAL: ADMIN_PIN missing'); process.exit(1); }
if (!MONGO_URI) { console.error('FATAL: MONGO_URI missing'); process.exit(1); }
const SUPPORT_TEXT =
    `\n\n📞 <b>Contact Support</b>\n` +
    `🔗 <a href="https://t.me/+CAntejDg9plmNWI0">AirDlivers Support Group</a>\n` +
    `📧 Email: <b>Info@airdlivers.com</b>`;

// ------------------- JSON backup files -------------------
const SENDERS_JSON = join(__dirname, 'senders.json');
const TRAVELERS_JSON = join(__dirname, 'travelers.json');
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// 🛡️ GLOBAL CRASH PROTECTION
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// 🛡️ Safe callback answer helper
async function safeAnswerCallback(queryId, options = {}) {
    try {
        if (queryId) await bot.answerCallbackQuery(queryId, options);
    } catch (err) {
        console.warn('Bot: Callback answer failed (likely timeout or stale):', err.message);
    }
}

// ------------------- MongoDB -------------------
let mongoClient, db, sendersCol, travelersCol, trackingCol, usersCol, supportTicketsCol, adminsCol;
try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);
    sendersCol = db.collection('senders');
    travelersCol = db.collection('travelers');
    trackingCol = db.collection('trackingRequests');
    usersCol = db.collection("users");
    supportTicketsCol = db.collection("supportTickets");
    adminsCol = db.collection('admins');
    console.log('✅ MongoDB connected successfully');
} catch (e) {
    console.error('MongoDB connection error:', e);
    process.exit(1);
}

// ------------------- TELEGRAM BOT (webhook only) -------------------
const bot = new TelegramBot(BOT_TOKEN, {
    webHook: false
});
// 🔥 SAVE REAL TELEGRAM METHODS
bot.__realSendMessage = bot.sendMessage.bind(bot);
bot.__realSendPhoto = bot.sendPhoto.bind(bot);
bot.__realEditMessageText = bot.editMessageText.bind(bot);
bot.__realEditMessageReplyMarkup = bot.editMessageReplyMarkup.bind(bot);
bot.__realAnswerCallbackQuery = bot.answerCallbackQuery.bind(bot);

const webCaptures = {}; // chatId -> { reply, buttons, parseMode }

bot.sendMessage = async function(cid, text, options = {}) {
    const cap = webCaptures[cid];
    if (cap) {
        cap.reply = text;
        if (options?.parse_mode === "HTML") cap.parseMode = "HTML";
        if (options?.reply_markup?.inline_keyboard) cap.buttons = options.reply_markup.inline_keyboard;
        return Promise.resolve();
    }
    return bot.__realSendMessage(cid, text, options);
};
bot.sendPhoto = async function(cid, photo, options = {}) {
    const cap = webCaptures[cid];
    if (cap) {
        cap.reply = options.caption || "📷 (Incoming Photo Notification)";
        cap.photo = (typeof photo === 'string' && photo.startsWith('http')) ? photo : null;
        if (options?.parse_mode === "HTML") cap.parseMode = "HTML";
        if (options?.reply_markup?.inline_keyboard) cap.buttons = options.reply_markup.inline_keyboard;
        return Promise.resolve();
    }
    return bot.__realSendPhoto(cid, photo, options);
};
bot.editMessageText = async function(text, options = {}) {
    if (String(options.chat_id).startsWith("web_")) return Promise.resolve();
    return bot.__realEditMessageText ? bot.__realEditMessageText(text, options) : Promise.resolve();
};
bot.editMessageReplyMarkup = async function(markup, options = {}) {
    if (String(options.chat_id).startsWith("web_")) return Promise.resolve();
    return bot.__realEditMessageReplyMarkup ? bot.__realEditMessageReplyMarkup(markup, options) : Promise.resolve();
};
bot.answerCallbackQuery = async function(id, options = {}) {
    if (String(id).startsWith("web_query_")) return Promise.resolve();
    return bot.__realAnswerCallbackQuery ? bot.__realAnswerCallbackQuery(id, options) : Promise.resolve();
};

// ------------------- EXPRESS SERVER & WEBHOOK -------------------
const app = express();

// 🔥 TELEGRAM WEBHOOK MUST BE RAW FIRST
// 🔥 TELEGRAM WEBHOOK MUST BE RAW FIRST
app.post(
    WEBHOOK_PATH,
    express.raw({ type: 'application/json' }),
    (req, res) => {
        try {
            const update = JSON.parse(req.body.toString());
            bot.processUpdate(update);
            res.sendStatus(200);
        } catch (err) {
            console.error("Webhook update error:", err);
            res.sendStatus(200);
        }
    }
);
// 🔥 THEN WEBSITE MIDDLEWARE
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:") || (BASE_URL && origin.startsWith(BASE_URL))) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));
app.use(express.json({ limit: "20mb" }));

// 🔥 WEBSITE STATIC SERVING
const buildPath = join(__dirname, "airdlivers-web", "build");
app.use(express.static(buildPath));
app.use("/uploads", express.static(UPLOADS_DIR));

// ---------------- WEBSITE AUTH MIDDLEWARE ----------------
function webAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : authHeader;

        if (!token) return res.status(401).json({ error: "No token" });

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: "Invalid token" });
    }
}


// ---------------- MY SERVICES API ----------------
app.get("/api/my-services", webAuth, async (req, res) => {
    try {
        const userIdObj = new ObjectId(req.user.id);
        const mySenders = await sendersCol.find({ userId: userIdObj }).sort({ createdAt: -1 }).toArray();
        const myTravelers = await travelersCol.find({ userId: userIdObj }).sort({ createdAt: -1 }).toArray();

        res.json({ senders: mySenders, travelers: myTravelers });
    } catch (err) {
        console.error("my-services error", err);
        res.status(500).json({ error: "Failed to fetch services" });
    }
});

app.get("/api/notifications/status", webAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const chatId = "web_" + userId;
        const user = await usersCol.findOne({ _id: new ObjectId(userId) });
        const activeReq = await getUserActiveRequest(chatId);
        const activeTicket = await supportTicketsCol.findOne({ chatId: chatId, status: { $ne: 'closed' } });
        const hasActiveRequest = !!activeReq || !!user?.flowActive;
        
        // 🛡️ HEALING & NOTIFICATION LOGIC:
        // We show the dot if there's a real unread flag OR if there are pending notifications in the memory queue.
        const pendingNotifs = webNotifications[userId] || [];
        const pendingSupport = webSupportNotifications[userId] || [];
        
        let showSupport = !!(user?.unreadSupport || pendingSupport.length > 0);
        let showService = !!(user?.unreadService || pendingNotifs.length > 0);

        // 🧪 DEBUG LOG (Remove after fixed)
        console.log(`[NOTIF_DEBUG] User ${userId}: unreadS=${user?.unreadSupport}, unreadReq=${user?.unreadService}, pendingN=${pendingNotifs.length}, req=${!!activeReq}, flow=${!!user?.flowActive}`);

        // Only clear the flags if there's truly no reason for them to be set
        // (but we keep them if there's an active request or flow, to be safe)
        if (!activeReq && !user?.flowActive && pendingNotifs.length === 0 && user?.unreadService) {
            await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { unreadService: false } });
            showService = false;
        }
        if (!activeTicket && pendingSupport.length === 0 && user?.unreadSupport) {
            await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { unreadSupport: false } });
            showSupport = false;
        }

        res.json({
            unreadSupport: showSupport,
            unreadService: showService,
            hasActiveRequest: hasActiveRequest,
            activeService: (activeReq?.role === 'sender' ? 'sender' : (activeReq?.role === 'traveler' ? 'traveler' : (user?.currentService || null)))
        });
    } catch (err) {
        res.status(500).json({ error: "failed" });
    }
});

// ---------------- WEBSITE CHAT START ----------------
app.post("/api/chat/start", webAuth, async (req, res) => {
    try {

        const userId = req.user.id;
        const chatId = "web_" + userId;

        let { service, restart } = req.body;

        const user = await usersCol.findOne({ _id: new ObjectId(userId) });
        const activeMatch = await findActiveMatchForUser(chatId);
        const isMatched = (user?.flowActive ? false : !!(activeMatch && !activeMatch.deliveryCompleted));

        // 🛡️ Proactively clear notifications when they start the chat
        await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { unreadService: false } });

        // -------- TRACK --------
        if (service === "track") {
            return res.json({ reply: "📞 Enter phone number used for shipment:" });
        }

        // -------- SUPPORT --------
        if (service === "support") {
            const activeReq = await getUserActiveRequest(chatId);
            if (!activeReq) {
                return res.json({ 
                    error: "You can chat with support only if you currently have an active service request. If you do not have an active service, please contact us by email at info@airdlivers.com.",
                    isMatched: false 
                });
            }

            // Persistence: check if user already has an active support session/ticket
            let existingTicket = await supportTicketsCol.findOne({ chatId: chatId, status: { $ne: 'closed' } });
            let ticketId = existingTicket ? existingTicket.supportTicketId : null;

            if (!existingTicket) {
                const ticket = await createSupportTicket(chatId, activeReq, "web");
                ticketId = ticket.supportTicketId;
            }

            const startReply = existingTicket 
                ? "Welcome back to AirDlivers support. How can I help you?" 
                : "Welcome to AirDlivers support. How can I help you?";
            
            supportSessions[chatId] = {
                type: "support",
                step: "active",
                data: {},
                webUserId: userId,
                expectingPhoto: null,
                requestId: activeReq.requestId,
                supportTicketId: ticketId
            };
            
            await usersCol.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { currentSupportTicketId: ticketId } }
            );

            // 🛡️ Proactively clear support notifications when they start the support chat
            await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { unreadSupport: false } });

            return res.json({ history: supportHistory, isMatched: false, activeService: "support" });
        }

        let history = (user?.chatHistory || []).filter(m => m.target !== 'support');

        let pendingSender = await sendersCol.findOne({ 
            userId: new ObjectId(userId), 
            status: { $nin: ['Completed', 'Cancelled', 'Rejected'] }, 
            deliveryCompleted: { $ne: true },
            deliveryPendingApproval: { $ne: true }
        }, { sort: { createdAt: -1 } });
        let pendingTraveler = await travelersCol.findOne({ 
            userId: new ObjectId(userId), 
            status: { $nin: ['Completed', 'Cancelled', 'Rejected'] }, 
            deliveryCompleted: { $ne: true },
            deliveryPendingApproval: { $ne: true }
        }, { sort: { createdAt: -1 } });

        // 🛡️ REFINED Restriction Logic: 
        // Only block if they have a CONFIRMED MATCH (matchLocked) that is NOT COMPLETED, 
        // OR if they are currently inside a flow (flowActive).
        const lockedSender = (pendingSender && (pendingSender.matchLocked || pendingSender.pendingMatchWith));
        const lockedTraveler = (pendingTraveler && (pendingTraveler.matchLocked || pendingTraveler.pendingMatchWith));

        if ((lockedSender || lockedTraveler) && service !== "my_services" && service !== "track" && service !== "support") {
            const activeType = lockedSender ? 'sender' : 'traveler';
            
            if (service !== activeType && !restart) {
                const warningMsg = "⚠️ You already have an active request being matched or confirmed. Please finish or cancel the current process before starting another service.";
                const lockedHistory = [...history, { from: "bot", text: warningMsg }];
                return res.json({ 
                    history: lockedHistory, 
                    activeService: activeType,
                    isMatched
                });
            }
            service = activeType;
        }

        let shouldRestart = false;
        if (restart) {
            shouldRestart = true;
        } else if (!user?.flowActive) {
            if (service === "sender" && !pendingSender) shouldRestart = true;
            if (service === "traveler" && !pendingTraveler) shouldRestart = true;
            if (user?.currentService !== service) shouldRestart = true;
        } else {
            if (user?.currentService !== service) shouldRestart = true;
        }

        if (shouldRestart) {
            history = [];

            const startStep = service === "sender" ? "sender_name" : "traveler_name";
            const startReply = "👤 Enter your Full Name:";

            await usersCol.updateOne(
                { _id: new ObjectId(userId) },
                {
                    $set: {
                        currentService: service,
                        flowStep: startStep,
                        flowData: {},
                        flowActive: true,
                        chatHistory: [{ from: "bot", text: startReply, target: service }],
                        updatedAt: new Date()
                    }
                }
            );

            userSessions[chatId] = {
                type: service,
                step: startStep,
                data: {},
                expectingPhoto: null,
                webUserId: userId,
                requestId: null
            };

            return res.json({ history: [{ from: "bot", text: startReply }], isMatched });
        }

        // Resuming existing flow
        if (!userSessions[chatId]) {
            if (user?.flowActive) {
                userSessions[chatId] = {
                    type: user.currentService,
                    step: user.flowStep,
                    data: user.flowData || {},
                    webUserId: userId,
                    expectingPhoto: user.flowExpectingPhoto || null,
                    requestId: user.flowRequestId || null
                };
            } else if (user?.currentSupportTicketId) {
                const ticket = await supportTicketsCol.findOne({ supportTicketId: user.currentSupportTicketId });
                if (ticket && ticket.status !== 'closed') {
                    userSessions[chatId] = {
                        type: 'support',
                        step: 'active',
                        data: {},
                        webUserId: userId,
                        expectingPhoto: null,
                        requestId: ticket.requestId,
                        supportTicketId: ticket.supportTicketId
                    };
                }
            }
        }

        if (history.length === 0 && !shouldRestart) {
            if (isMatched) {
                history = [{ from: 'bot', text: '🤝 Match Confirmed! You can now chat with your partner here.' }];
            } else {
                history = [{ from: 'bot', text: '✅ Request submitted successfully. Waiting for admin/matching...' }];
            }
        }

        return res.json({ history, isMatched });

    } catch (err) {
        console.error("chat start error", err);
        res.status(500).json({ error: "start failed" });
    }
});


// ---------------- WEBSITE CHAT MESSAGE (REAL ENGINE) ----------------
app.post("/api/chat/message", webAuth, async (req, res) => {
    try {
        const userId = String(req.user.id);
        const chatId = "web_" + userId;
        const message = (req.body.message || "").trim();
        const target = req.body.target || "service";
        
        if (message !== "") console.log(`[REQ_DEBUG] user:${userId} msg:"${message}"`);
        else if (process.env.POLLING_DEBUG) console.log(`[REQ_DEBUG] user:${userId} poll`);
        
        
        if (message !== "") console.log(`[CHAT_DEBUG] Msg from ${userId}: "${message}" target: ${target}`);
        
        
        const user = await usersCol.findOne({ _id: new ObjectId(userId) });
        let session = userSessions[chatId];
        const supportSession = supportSessions[chatId];
        
        let botReply = "";
        let botButtons = null;
        let botParseMode = null;
        let updateOps = [];

        // 1️⃣ HANDLE NOTIFICATION POLLING (Flush unread messages)
        const notifArray = target === "support" ? (webSupportNotifications[userId] || []) : (webNotifications[userId] || []);
        
        if (notifArray && (Array.isArray(notifArray) ? notifArray.length > 0 : true)) {
            if (target === "support") webSupportNotifications[userId] = [];
            else webNotifications[userId] = [];

            // 🛡️ SECURITY & ROBUSTNESS: Ensure we always treat it as an array for processing
            let safeNotifs = Array.isArray(notifArray) ? notifArray : [notifArray];

            const chatUpdates = [];
            for (const notif of safeNotifs) {
                if (!notif) continue;
                const botObj = typeof notif === 'object'
                    ? { 
                        from: "bot", 
                        text: notif.text, 
                        buttons: notif.buttons || null, 
                        photo: notif.photo || null,
                        target: target, 
                        adminId: notif.adminId || null, 
                        adminName: notif.adminName || null 
                      }
                    : { from: "bot", text: notif, target: target };
                if (!notif.skipHistory) chatUpdates.push(botObj);
            }
            if (chatUpdates.length > 0) {
                const updateQuery = { $push: { chatHistory: { $each: chatUpdates } } };
                if (target === "support") updateQuery.$set = { unreadSupport: false };
                else updateQuery.$set = { unreadService: false };
                await usersCol.updateOne({ _id: new ObjectId(userId) }, updateQuery);
            }

            const combinedReply = safeNotifs.map(n => typeof n === 'object' ? (n.text || '') : n).join("\n\n");
            const lastNotif = safeNotifs[safeNotifs.length - 1] || {};

            let activeSvc = target === 'support' ? "support" : (user?.flowActive ? user.currentService : userSessions[chatId]?.type);

            let buttons = null;
            let photo = null;
            for (let i = safeNotifs.length - 1; i >= 0; i--) {
                if (safeNotifs[i] && typeof safeNotifs[i] === 'object') {
                    if (safeNotifs[i].buttons && !buttons) buttons = safeNotifs[i].buttons;
                    if (safeNotifs[i].photo && !photo) photo = safeNotifs[i].photo;
                }
            }

            return res.json({ 
                reply: combinedReply, 
                buttons: buttons, 
                photo: photo,
                parse_mode: 'HTML', 
                isMatched: (user?.flowActive ? false : !!(await findActiveMatchForUser(chatId))),
                activeService: activeSvc
            });
        }



        // 2️⃣ HANDLE SUPPORT TARGET (Complete Isolation)
        if (target === "support") {
            // Reconstruct support session if needed
            if (!supportSessions[chatId] && user?.currentSupportTicketId) {
                const ticket = await supportTicketsCol.findOne({ supportTicketId: user.currentSupportTicketId });
                if (ticket && ticket.status !== 'closed') {
                    supportSessions[chatId] = { type: 'support', requestId: ticket.requestId, supportTicketId: ticket.supportTicketId };
                }
            }
            
            const activeSup = supportSessions[chatId];
            if (activeSup?.type === "support") {
                if (message.toLowerCase() === 'end chat') {
                    const ticketId = activeSup.supportTicketId;
                    await supportTicketsCol.updateOne({ supportTicketId: ticketId }, { $set: { status: 'closed', closedAt: new Date() } });
                    await usersCol.updateOne({ _id: new ObjectId(userId) }, { $unset: { currentSupportTicketId: "" } });
                    delete supportSessions[chatId];
                    botReply = "✅ This support chat has been closed. If you need further assistance, please start a new support chat.";
                } else if (message !== "") {
                    const userName = user?.name || 'Unknown';
                    const ticketId = activeSup.supportTicketId;
                    await bot.__realSendMessage(
                        String(SUPPORT_GROUP_ID),
                        `🆘 <b>Support Request [${ticketId}]</b>\n` +
                        `<b>User:</b> ${escapeHtml(userName)}\n` +
                        `<b>Source:</b> Web\n` +
                        `<b>Ref:</b> <code>${String(chatId)}</code>\n\n` +
                        `💬 <i>${escapeHtml(message)}</i>`,
                        { parse_mode: 'HTML' }
                    );
                    await supportTicketsCol.updateOne({ supportTicketId: ticketId, firstMessage: { $exists: false } }, { $set: { firstMessage: message } });
                    botReply = "✅ Message received by support team. Please wait for a reply.";
                }

                if (message !== "") {
                    await usersCol.updateOne({ _id: new ObjectId(userId) }, { 
                        $push: { chatHistory: { $each: [{ from: 'user', text: message, target: "support" }, { from: 'bot', text: botReply, target: "support" }] } },
                        $set: { unreadSupport: false }
                    });
                }
                return res.json({ reply: botReply, activeService: "support", isMatched: !!(await findActiveMatchForUser(chatId)) });
            } else {
                 return res.json({ reply: "Please start a support session first." });
            }
        }

        // 3️⃣ HANDLE POLLING / CALLBACKS (Service Flow)
        if (message === "" || message.startsWith("m_") || message.startsWith("d_") || message.startsWith("cat_") || message.startsWith("sender_") || message.startsWith("traveler_")) {
            if (message !== "") console.log(`[REQ_DEBUG] Section 3 reached for ${message}`);
            if (message !== "") console.log(`[CHAT_DEBUG] Entering Section 3 (Callback) for ${message}`);
            if (message === "") return res.json({ reply: null, isMatched: !!(await findActiveMatchForUser(chatId)), activeService: user?.flowActive ? user.currentService : userSessions[chatId]?.type });
            
            const mockQuery = { data: message, message: { chat: { id: chatId }, message_id: Date.now() }, from: { id: userId }, id: "web_query_" + Date.now() };
            webCaptures[chatId] = { reply: "", buttons: null, parseMode: null };
            bot.emit('callback_query', mockQuery);
            
            // ⏳ Wait for bot to produce a message (up to 3 seconds for matches)
            for (let i = 0; i < 30; i++) {
                if (webCaptures[chatId]?.reply) break;
                await new Promise(r => setTimeout(r, 100));
            }
            
            const cap = webCaptures[chatId];
            delete webCaptures[chatId];

            return res.json({ 
                reply: cap?.reply || null, 
                buttons: cap?.buttons || null,
                activeService: user?.flowActive ? user.currentService : userSessions[chatId]?.type 
            });
        }

        // 4️⃣ HANDLE DELIVERY FLOW (High Priority Note Capture)
        if (session?.type === 'delivery_flow') {
            const rId = session.requestId;
            const note = message.toLowerCase() === 'none' ? '' : message;
            
            if (session.step === 'handover_note') {
                await sendersCol.updateOne({ requestId: rId }, { $set: { handoverNote: note } });
                await travelersCol.updateOne({ requestId: rId }, { $set: { handoverNote: note } });
                delete userSessions[chatId];
                await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { flowStep: null, flowData: null, flowActive: false } });
                
                await bot.sendMessage(String(ADMIN_GROUP_ID), `📋 <b>Traveler Confirmed Receipt</b>\nReq: <code>${rId}</code>\nNote: ${note || 'None'}`, { parse_mode: 'HTML' });
                return res.json({ reply: "✅ Handover note saved. Chat remains open until final delivery.", activeService: "service" });
            } else if (session.step === 'final_note') {
                await travelersCol.updateOne({ requestId: rId }, { $set: { finalNote: note, deliveryPendingApproval: true } });
                delete userSessions[chatId];
                await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { flowStep: null, flowData: null, flowActive: false } });

                const adminKb = { inline_keyboard: [[{ text: "✅ Approve Delivery", callback_data: `d_admin_app_${rId}` }], [{ text: "❌ Reject", callback_data: `d_admin_rej_${rId}` }]] };
                await bot.sendMessage(String(ADMIN_GROUP_ID), `🏁 <b>Final Delivery Completed</b>\nReq: <code>${rId}</code>\nNote: ${note || 'None'}\nApprove closure?`, { parse_mode: 'HTML', reply_markup: adminKb });
                return res.json({ reply: "✅ Final delivery note saved. Waiting for admin approval.", activeService: "service" });
            }
        }

        // 5️⃣ HANDLE PARTNER FORWARDING (Service Flow)
        if (!user?.flowActive && message !== "" && !message.startsWith("confirm_") && !message.startsWith("cat_") && !message.startsWith("sender_") && !message.startsWith("d_")) {
            if (message === "ui_delivered") {
                // Capture bot output for web
                webCaptures[chatId] = { reply: "", buttons: null, parseMode: null };
                await handleDeliveredCommand(chatId);
                const cap = webCaptures[chatId];
                delete webCaptures[chatId];
                
                if (!cap?.reply) {
                    return res.json({ reply: null, activeService: userSessions[chatId]?.type || "service" });
                }
                return res.json({ 
                    reply: cap.reply, 
                    buttons: cap.buttons || null,
                    activeService: userSessions[chatId]?.type || "service" 
                });
            }
            const handled = await tryForwardChatMessage(chatId, message);
            if (handled) return res.json({ reply: "", activeService: userSessions[chatId]?.type });
        }


        // 5️⃣ MAIN SERVICE ENGINE (Sender / Traveler)
        if (!user?.flowActive) return res.json({ reply: "Please select service to begin." });

        if (!userSessions[chatId]) {
            userSessions[chatId] = { type: user.currentService, step: user.flowStep, data: user.flowData || {}, webUserId: userId, expectingPhoto: null, requestId: user.flowRequestId || null };
        }
        session = userSessions[chatId]; // Update existing local variable

        // Capture bot output
        webCaptures[chatId] = { reply: "", buttons: null, parseMode: null };

        try {
            if (message.startsWith("confirm_yes_sender_")) {
                const reqId = message.split("confirm_yes_sender_")[1];
                if (session?.requestId === reqId) await handleFinalSenderSubmit(chatId, session);
                botReply = "✅ Shipment submitted successfully. Waiting for admin approval.";
            } else if (message.startsWith("confirm_no_sender_")) {
                delete userSessions[chatId];
                await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { flowActive: false, flowStep: null } });
                botReply = "❌ Shipment request cancelled.";
            } else if (message.startsWith("confirm_yes_traveler_")) {
                const reqId = message.split("confirm_yes_traveler_")[1];
                if (session?.requestId === reqId) await handleFinalTravelerSubmit(chatId, session);
                botReply = "✅ Travel submitted successfully. Waiting for admin approval.";
            } else if (message.startsWith("confirm_no_traveler_")) {
                delete userSessions[chatId];
                await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { flowActive: false, flowStep: null } });
                botReply = "❌ Travel request cancelled.";
            } else if (session?.type === "sender") {
                await handleSenderTextStep(chatId, message);
            } else if (session?.type === "traveler") {
                await handleTravelerTextStep(chatId, message);
            } else if (session?.type === "tracking") {
                botReply = isValidPhone(message) ? "Tracking coming soon." : "❌ Invalid phone number.";
            }
        } finally {
            // History & Status Update
            if (webCaptures[chatId]?.reply) {
                botReply = webCaptures[chatId].reply;
                botButtons = webCaptures[chatId].buttons;
                botParseMode = webCaptures[chatId].parseMode;
            }
            delete webCaptures[chatId];
        }

        // Finalize History
        if (message !== "" && !message.startsWith("m_")) {
            updateOps.push({ from: "user", text: message, target: "service" });
            if (botReply) updateOps.push({ from: "bot", text: botReply, buttons: botButtons || null, target: "service" });
            await usersCol.updateOne({ _id: new ObjectId(userId) }, { $push: { chatHistory: { $each: updateOps } }, $set: { unreadService: false } });
        }

        res.json({ 
            reply: botReply, 
            buttons: botButtons || null, 
            parse_mode: botParseMode || null, 
            isMatched: (user?.flowActive ? false : !!(await findActiveMatchForUser(chatId))), 
            activeService: user?.flowActive ? user.currentService : userSessions[chatId]?.type 
        });

    } catch (err) {
        console.error("chat message error:", err);
        res.status(500).json({ error: "message failed" });
    }
});

app.post("/api/chat/photo", webAuth, upload.single("photo"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        const filePath = req.file.path;
        const fileName = req.file.filename;
        const photoUrl = `${BASE_URL}/uploads/${fileName}`;

        // Upload to Telegram (optional, but keep it for admin/backups)
        const photoBuffer = await fs.readFile(filePath);
        const tgMsg = await bot.sendPhoto(
            String(ADMIN_GROUP_ID),
            photoBuffer,
            {
                filename: fileName,
                contentType: req.file.mimetype,
                disable_notification: true
            }
        );
        
        await bot.deleteMessage(String(ADMIN_GROUP_ID), tgMsg.message_id);
        const fileId = tgMsg.photo[tgMsg.photo.length - 1].file_id;

        const userId = req.user.id;
        const chatId = "web_" + userId;

        const session = userSessions[chatId];
        console.log(`[PHOTO_DEBUG] userId:${userId} type:${session?.type} step:${session?.step} expecting:${session?.expectingPhoto}`);

        // 🛡️ HEURISTIC FIX: If state is lost/null but step implies photo
        if (session && !session.expectingPhoto) {
            if (session.step === 'package_photo') session.expectingPhoto = 'package_photo';
            else if (session.step === 'selfie_id') session.expectingPhoto = 'selfie_id';
            else if (session.step === 'passport_selfie') session.expectingPhoto = 'passport_selfie';
            else if (session.step === 'itinerary_photo') session.expectingPhoto = 'itinerary_photo';
            else if (session.step === 'visa_photo') session.expectingPhoto = 'visa_photo';
        }
        
        // --- 🚛 Delivery Flow Note Capture ---
        if (session?.type === 'delivery_flow') {
            const reqId = session.requestId;
            const note = message.toLowerCase() === 'none' ? '' : message;
            
            if (session.step === 'handover_note') {
                await sendersCol.updateOne({ requestId: reqId }, { $set: { handoverNote: note } });
                await travelersCol.updateOne({ requestId: reqId }, { $set: { handoverNote: note } }); // Backup on both
                userSessions[chatId] = null;
                await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { flowStep: null, flowData: null, flowActive: false } });
                
                // Notify Admin
                await bot.sendMessage(String(ADMIN_GROUP_ID), `📋 <b>Traveler Confirmed Receipt</b>\nReq: <code>${reqId}</code>\nNote: ${note || 'None'}`, { parse_mode: 'HTML' });
                return res.json({ reply: "✅ Handover note saved. Chat remains open until final delivery." });
            } else if (session.step === 'final_note') {
                await travelersCol.updateOne({ requestId: reqId }, { $set: { finalNote: note, deliveryPendingApproval: true } });
                userSessions[chatId] = null;
                await usersCol.updateOne({ _id: new ObjectId(userId) }, { $set: { flowStep: null, flowData: null, flowActive: false } });

                // Notify Admin for approval
                const adminKeyboard = {
                    inline_keyboard: [
                        [{ text: "✅ Approve Delivery", callback_data: `d_admin_app_${reqId}` }],
                        [{ text: "❌ Reject", callback_data: `d_admin_rej_${reqId}` }]
                    ]
                };
                await bot.sendMessage(String(ADMIN_GROUP_ID), `🏁 <b>Final Delivery Completed</b>\nReq: <code>${reqId}</code>\nNote: ${note || 'None'}\nApprove closure?`, { parse_mode: 'HTML', reply_markup: adminKeyboard });
                return res.json({ reply: "✅ Final delivery note saved. Waiting for admin approval." });
            }
        }

        if (!session) {
            return res.json({ reply: "Session expired." });
        }

        // Define shared UI updater function for photo api
        const nextWebUI = async (step, expecting, replyText, currentPhotoField) => {
            const field = currentPhotoField || 'packagePhoto';
            session.expectingPhoto = expecting;
            session.step = step;
            
            // 🔥 SAVE BOTH TELEGRAM ID AND LOCAL URL USING THE CURRENT FIELD NAME
            session.data[field] = fileId; 
            session.data[field + 'Url'] = photoUrl;

            await usersCol.updateOne(
                { _id: new ObjectId(session.webUserId) },
                {
                    $set: {
                        flowStep: session.step,
                        flowExpectingPhoto: session.expectingPhoto,
                        flowData: session.data
                    },
                    $push: {
                        chatHistory: {
                            $each: [
                                { from: 'user', text: "📷 Photo uploaded", photo: photoUrl },
                                { from: 'bot', text: replyText }
                            ]
                        }
                    }
                }
            );
            return res.json({ reply: replyText, photo: photoUrl });
        };

        // Package photo
        if (session.expectingPhoto === 'package_photo') {
            return nextWebUI('send_date', null, "📅 Enter Send Date (DD-MM-YYYY):", "packagePhoto");
        }

        // Selfie
        if (session.expectingPhoto === 'selfie_id') {
            return nextWebUI('optional_notes', null, "📝 Add optional notes or type 'None':", "selfieId");
        }

        // TRAVELER PHOTOS //
        if (session.type === 'traveler') {
            if (session.expectingPhoto === 'passport_selfie') {
                return nextWebUI('itinerary_photo', 'itinerary_photo', '📄 Upload your Itinerary Photo (mandatory):', "passportSelfie");
            }
            if (session.expectingPhoto === 'itinerary_photo') {
                return nextWebUI('optional_notes', null, "📝 Add optional notes or type 'None':", "itineraryPhoto");
            }
            if (session.expectingPhoto === 'visa_photo') {
                return nextWebUI('optional_notes', null, "📝 Add optional notes or type 'None':", "visaPhoto");
            }
        }

        return res.json({ reply: "Photo received." });

    } catch (err) {
        console.error("🚨 FULL PHOTO ERROR:", err);
        return res.status(500).json({ reply: "Upload crashed" });
    }
});

// ✅ WEBHOOK MUST BE AFTER PATH EXISTS
// ✅ WEBHOOK ENDPOINT (PASTE HERE)

// health check
// ---------------- WEBSITE REGISTER ----------------
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const exist = await usersCol.findOne({ email });
        if (exist) return res.status(400).json({ error: "Email exists" });

        const hash = await bcrypt.hash(password, 10);

        await usersCol.insertOne({
            name,
            email,
            password: hash,
            role: "user",
            createdAt: new Date()
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Register failed" });
    }
});
// ---------------- WEBSITE LOGIN ----------------
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await usersCol.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found" });

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(400).json({ error: "Wrong password" });

        const token = jwt.sign(
            { id: user._id.toString(), role: user.role },
            JWT_SECRET
        );

        res.json({ token });
    } catch (e) {
        res.status(500).json({ error: "Login failed" });
    }
});
// ---------------- WEBSITE CREATE SENDER ----------------
app.post("/api/sender/create", webAuth, async (req, res) => {
    try {
        const requestId = makeRequestId("snd");

        const doc = {
            requestId,
            userId: req.user.id,
            role: "sender",
            data: req.body,
            status: "Pending",
            createdAt: new Date(),
            matchLocked: false
        };

        await sendersCol.insertOne(doc);

        res.json({ success: true, requestId });
    } catch (e) {
        res.status(500).json({ error: "Failed" });
    }
});


app.get("*", (req, res) => {
    // We only serve index.html for non-API requests
    if (req.path.startsWith("/api") || req.path.startsWith("/bot")) {
        return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(join(buildPath, "index.html"));
});

// start server + set webhook
app.listen(PORT, async () => {

    console.log(`🌍 Server running on port ${PORT}`);

    try {
        await bot.setWebHook(WEBHOOK_URL);
        console.log(`✅ Webhook set: ${WEBHOOK_URL}`);
    } catch (err) {
        console.error("❌ Webhook failed:", err.message);
    }

});

// ------------------- Utilities -------------------
function isWebChat(chatId) {
    return String(chatId).startsWith("web_");
}
function escapeHtml(str = '') {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function nowYYMMDDHHMMSS() {
    return moment().format('YYMMDDHHmmss');
}
function makeRequestId(prefix = 'snd') {
    return `${prefix}${nowYYMMDDHHMMSS()}`;
}
function isValidPhone(txt) {
    return /^\+\d{8,15}$/.test(String(txt || '').trim());
}
function isValidEmail(txt) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(txt || '').trim());
}
function parseDate_ddmmyyyy(txt) {
    if (!txt) return null;
    const m = moment(txt, 'DD-MM-YYYY', true);
    return m.isValid() ? m.toDate() : null;
}
function parseDate_ddmmyyyy_hhmm(txt) {
    if (!txt) return null;
    const m = moment(txt, 'DD-MM-YYYY HH:mm', true);
    return m.isValid() ? m.toDate() : null;
}
function todayStart() {
    return moment().startOf('day').toDate();
}
async function findUserByUserId(userId) {
    const sender = await sendersCol.findOne({ userId });
    if (sender) return { doc: sender, col: sendersCol };

    const traveler = await travelersCol.findOne({ userId });
    if (traveler) return { doc: traveler, col: travelersCol };

    return null;
}

function isAdminMessage(msg) {
    return String(msg.chat.id) === String(ADMIN_GROUP_ID) || String(msg.chat.id) === String(SUPPORT_GROUP_ID);
}


function getPinPadMarkup(pinBuffer = "") {
    const masked = pinBuffer.length > 0 ? "* ".repeat(pinBuffer.length).trim() : "ENTER PIN";
    return {
        inline_keyboard: [
            [{ text: `[ ${masked} ]`, callback_data: "pin_ignore" }],
            [
                { text: "1", callback_data: "pin_1" },
                { text: "2", callback_data: "pin_2" },
                { text: "3", callback_data: "pin_3" }
            ],
            [
                { text: "4", callback_data: "pin_4" },
                { text: "5", callback_data: "pin_5" },
                { text: "6", callback_data: "pin_6" }
            ],
            [
                { text: "7", callback_data: "pin_7" },
                { text: "8", callback_data: "pin_8" },
                { text: "9", callback_data: "pin_9" }
            ],
            [
                { text: "❌ Clear", callback_data: "pin_clear" },
                { text: "0", callback_data: "pin_0" },
                { text: "✅ OK", callback_data: "pin_ok" }
            ]
        ]
    };
}

// --- airport + matching helpers ---
function normalizeAirportName(str = '') {
    return String(str || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/\s+AIRPORT\b/g, '')
        .replace(/\s+INTL\b/g, '')
        .replace(/\s+INTERNATIONAL\b/g, '');
}

function airportsMatch(a, b) {
    const na = normalizeAirportName(a);
    const nb = normalizeAirportName(b);
    return na && nb && na === nb;
}

function isWeightCompatible(senderWeight, travelerWeight) {
    if (senderWeight == null || travelerWeight == null) return false;
    const diff = Math.abs(Number(senderWeight) - Number(travelerWeight));
    return diff <= 2; // ±2 kg
}

function areDatesClose(senderSendDateStr, travelerDepartureStr) {
    if (!senderSendDateStr || !travelerDepartureStr) return false;
    const s = moment(senderSendDateStr, 'DD-MM-YYYY', true);
    const t = moment(travelerDepartureStr, 'DD-MM-YYYY HH:mm', true);
    if (!s.isValid() || !t.isValid()) return false;
    const diffDays = Math.abs(t.startOf('day').diff(s.startOf('day'), 'days'));
    return diffDays <= 1;
}

// ------------------- JSON backup helpers -------------------
async function backupSenderToJSON(doc) {
    const arr = (await fs.readJson(SENDERS_JSON).catch(() => [])) || [];
    arr.push(doc);
    await fs.writeJson(SENDERS_JSON, arr, { spaces: 2 });
}
async function backupTravelerToJSON(doc) {
    const arr = (await fs.readJson(TRAVELERS_JSON).catch(() => [])) || [];
    arr.push(doc);
    await fs.writeJson(TRAVELERS_JSON, arr, { spaces: 2 });
}

// ------------------- In-memory state -------------------
const userSessions = {}; // chatId -> session (sender, traveler, tracking)
const supportSessions = {}; // chatId -> support session
const webNotifications = {}; // user_id -> array of { text, buttons, parse_mode, skipHistory }
const webSupportNotifications = {}; // user_id -> array of strings or objects
/*
session example:
{
  type: 'sender'|'traveler'|'tracking',
  step: 'sender_name'|...,
  data: {},
  expectingPhoto: null|'package_photo'|'selfie_id'|'passport_selfie'|'itinerary_photo'|'visa_photo'
  requestId: 'snd...'
}
*/
const adminAuth = {}; // userId -> { awaitingPin, loggedIn, super, awaitingCustomReasonFor }

// ------------------- Keyboards -------------------
function categoryKeyboardSingle() {

    const items = [
        "Documents",
        "Gold (with bill)",
        "Medicines (With prescription & Bill)",
        "Clothes",
        "Food (Should be sealed)",
        "Electronics",
        "Gifts",
        "Other"
    ];

    return {
        reply_markup: {
            inline_keyboard: items.map(i => [{
                text: i,
                callback_data: `cat_${i}`
            }])
        }
    };
}

function confirmKeyboard(role, requestId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Confirm & Submit', callback_data: `confirm_yes_${role}_${requestId}` }],
                [{ text: '❌ Cancel', callback_data: `confirm_no_${role}_${requestId}` }]
            ]
        }
    };
}

function adminActionKeyboardForDoc(doc) {
    const rid = doc.requestId;
    if (doc.role === 'sender') {
        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Approve', callback_data: `approve_${rid}` },
                        { text: '❌ Reject', callback_data: `reject_${rid}` }
                    ]
                ]
            }
        };
    } else {
        if (doc.status === 'VisaRequested') {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve', callback_data: `approve_${rid}` },
                            { text: '❌ Reject', callback_data: `reject_${rid}` }
                        ]
                    ]
                }
            };
        } else {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve', callback_data: `approve_${rid}` },
                            { text: '❌ Reject', callback_data: `reject_${rid}` }
                        ],
                        [{ text: '🛂 Request Visa', callback_data: `requestvisa_${rid}` }]
                    ]
                }
            };
        }
    }
}

function rejectionReasonsKeyboard(reqId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Incomplete Info', callback_data: `reason_info_${reqId}` }],
                [{ text: '🚫 Prohibited Item', callback_data: `reason_item_${reqId}` }],
                [{ text: '📄 Invalid Docs', callback_data: `reason_doc_${reqId}` }],
                [{ text: '✏️ Other (type reason)', callback_data: `reason_other_${reqId}` }]
            ]
        }
    };
}

const mainMenuInline = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📦 Send a Package', callback_data: 'flow_sender' }],
            [{ text: '🧳 Traveler (carry while travel)', callback_data: 'flow_traveler' }],
            [{ text: '📍 Track Shipment', callback_data: 'flow_tracking' }],
            [{ text: '📋 My Services', callback_data: 'flow_my_services' }],
            [{ text: 'ℹ️ Help / Support', callback_data: 'flow_help' }]
        ]
    }
};
const backToMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '⬅️ Back to Menu', callback_data: 'back_to_menu' }]
        ]
    }
};


// ------------------- Matching helpers -------------------
function buildSenderSnapshot(doc) {
    const data = doc?.data || {};
    return {
        requestId: doc?.requestId,
        userId: doc?.userId,
        telegramId: doc?.telegramId,
        pickup: data.pickup,
        destination: data.destination,
        weight: data.weight,
        sendDate: data.sendDate,
        arrivalDate: data.arrivalDate,
        status: doc?.status || 'Pending',
        matchLocked: !!doc?.matchLocked,
        pendingMatchWith: doc?.pendingMatchWith || null
    };
}

function buildTravelerSnapshot(doc) {
    const data = doc?.data || {};
    return {
        requestId: doc?.requestId,
        userId: doc?.userId,
        telegramId: doc?.telegramId,
        departure: data.departure,
        destination: data.destination,
        departureTime: data.departureTime,
        arrivalTime: data.arrivalTime,
        availableWeight: data.availableWeight,
        status: doc?.status || 'Pending',
        matchLocked: !!doc?.matchLocked,
        pendingMatchWith: doc?.pendingMatchWith || null
    };
}

// 🛡️ Helper for downloading Telegram photos for web display
async function downloadTelegramFile(fileId, targetName) {
    try {
        const link = await bot.getFileLink(fileId);
        const res = await fetch(link);
        const buffer = await res.arrayBuffer();
        const filePath = join(UPLOADS_DIR, targetName);
        await fs.writeFile(filePath, Buffer.from(buffer));
        return `${BASE_URL}/uploads/${targetName}`;
    } catch (e) {
        console.warn('Failed to download telegram file:', e.message);
        return null;
    }
}

function isSenderTravelerCompatible(senderSnap, travelerSnap) {
    if (!senderSnap || !travelerSnap) return false;
    if (!senderSnap.pickup || !senderSnap.destination || !senderSnap.sendDate) return false;
    if (!travelerSnap.departure || !travelerSnap.destination || !travelerSnap.departureTime) return false;

    if (!airportsMatch(senderSnap.pickup, travelerSnap.departure)) return false;
    if (!airportsMatch(senderSnap.destination, travelerSnap.destination)) return false;
    if (!isWeightCompatible(senderSnap.weight, travelerSnap.availableWeight)) return false;
    if (!areDatesClose(senderSnap.sendDate, travelerSnap.departureTime)) return false;
    if (senderSnap.matchLocked || travelerSnap.matchLocked) return false;

    // 🛡️ Loophole Fix: Cannot match with SELF
    if (senderSnap.userId && travelerSnap.userId && String(senderSnap.userId) === String(travelerSnap.userId)) return false;
    if (senderSnap.telegramId && travelerSnap.telegramId && String(senderSnap.telegramId) === String(travelerSnap.telegramId)) return false;

    return true;
}

// ------------------- Match cards -------------------
async function sendMatchCardToSender(senderDoc, travelerDoc) {
    try {
        const s = buildSenderSnapshot(senderDoc);
        const t = buildTravelerSnapshot(travelerDoc);
        if (!isSenderTravelerCompatible(s, t)) {
            console.log(`[MATCH_DEBUG] Sender ${senderDoc.requestId} and Traveler ${travelerDoc.requestId} are NOT compatible for card.`);
            return;
        }

        let text = `<b>🔍 Possible Traveler Match</b>\n\n`;
        text += `<b>Your Request ID:</b> <code>${escapeHtml(s.requestId)}</code>\n`;
        text += `<b>Route:</b> ${escapeHtml(s.pickup)} → ${escapeHtml(s.destination)}\n`;
        text += `<b>Your Package:</b> ${escapeHtml(String(s.weight))} kg, ${escapeHtml(senderDoc.data?.category || 'N/A')}\n`;
        text += `<b>Your Send Date:</b> ${escapeHtml(s.sendDate)}\n\n`;

        text += `<b>Traveler Request ID:</b> <code>${escapeHtml(t.requestId)}</code>\n`;
        text += `<b>Traveler Route:</b> ${escapeHtml(t.departure)} → ${escapeHtml(t.destination)}\n`;
        text += `<b>Traveler Schedule:</b>\n  🛫 ${escapeHtml(t.departureTime)}\n  🛬 ${escapeHtml(t.arrivalTime || 'N/A')}\n`;
        text += `<b>Traveler Capacity:</b> ${escapeHtml(String(t.availableWeight))} kg\n\n`;
        if (travelerDoc.data?.notes) {
            text += `<b>Traveler Notes:</b> ${escapeHtml(travelerDoc.data.notes)}\n\n`;
        }
        text += `✅ <b>Verified</b> by admin using ID, phone, passport & itinerary.\n`;
        text += `🔒 Name / phone / email / passport details are hidden until you both confirm.\n`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm with this traveler', callback_data: `m_s_conf_${s.requestId}_${t.requestId}` }],
                    [{ text: '➡ Skip', callback_data: `m_s_skip_${s.requestId}_${t.requestId}` }]
                ]
            },
            parse_mode: 'HTML'
        };

        // 🔄 ENSURE WE HAVE A PHOTO URL REGARDLESS OF SOURCE
        let photo = senderDoc.data?.packagePhotoUrl;
        if (!photo && senderDoc.data?.packagePhoto) {
            console.log(`[MATCH_DEBUG] Downloading package photo on-the-fly for ${senderDoc.requestId}`);
            photo = await downloadTelegramFile(senderDoc.data.packagePhoto, `tg_pkg_match_${senderDoc.requestId}.jpg`);
            if (photo) await sendersCol.updateOne({ requestId: senderDoc.requestId }, { $set: { "data.packagePhotoUrl": photo } });
        }

        // WEBSITE USER
        if (!senderDoc.telegramId) {
            const textToSave = text.replace(/<br\/>/g, '\n');
            const uid = senderDoc.userId.toString();
            webNotifications[uid] = webNotifications[uid] || [];
            webNotifications[uid].push({
                text: textToSave,
                buttons: keyboard.reply_markup.inline_keyboard,
                photo: photo || null,
                parse_mode: 'HTML',
                skipHistory: true
            });
            await usersCol.updateOne(
                { _id: new ObjectId(uid) },
                { $push: { chatHistory: { from: 'bot', text: textToSave, buttons: keyboard.reply_markup.inline_keyboard, photo: photo || null } } }
            );
            return;
        }

        // TELEGRAM USER
        const target = senderDoc.telegramId;
        const photoToUse = photo || senderDoc.data?.packagePhoto;
        if (photoToUse) {
            await bot.sendPhoto(target, photoToUse, { caption: text, parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        } else {
            await bot.sendMessage(target, text, keyboard);
        }
        console.log(`[MATCH_DEBUG] Match card sent to Sender ${senderDoc.requestId} on Telegram.`);
    } catch (err) {
        console.error(`[MATCH_DEBUG] sendMatchCardToSender error:`, err);
    }
}

async function sendMatchCardToTraveler(travelerDoc, senderDoc) {
    try {
        const s = buildSenderSnapshot(senderDoc);
        const t = buildTravelerSnapshot(travelerDoc);
        if (!isSenderTravelerCompatible(s, t)) {
            console.log(`[MATCH_DEBUG] Sender ${senderDoc.requestId} and Traveler ${travelerDoc.requestId} are NOT compatible for card.`);
            return;
        }

        let text = `<b>🔍 Possible Sender Match</b>\n\n`;
        text += `<b>Your Request ID:</b> <code>${escapeHtml(t.requestId)}</code>\n`;
        text += `<b>Your Route:</b> ${escapeHtml(t.departure)} → ${escapeHtml(t.destination)}\n`;
        text += `<b>Your Capacity:</b> ${escapeHtml(String(t.availableWeight))} kg\n`;
        text += `<b>Your Departure:</b> ${escapeHtml(t.departureTime)}\n\n`;

        text += `<b>Sender Request ID:</b> <code>${escapeHtml(s.requestId)}</code>\n`;
        text += `<b>Sender Route:</b> ${escapeHtml(s.pickup)} → ${escapeHtml(s.destination)}\n`;
        text += `<b>Package:</b> ${escapeHtml(String(s.weight))} kg, ${escapeHtml(senderDoc.data?.category || 'N/A')}\n`;
        text += `<b>Send Date:</b> ${escapeHtml(s.sendDate)}\n\n`;
        if (senderDoc.data?.notes) {
            text += `<b>Sender Notes:</b> ${escapeHtml(senderDoc.data.notes)}\n\n`;
        }
        text += `✅ <b>Verified</b> by admin using ID, phone & documents.\n`;
        text += `🔒 Name / phone / email / passport details are hidden until you both confirm.\n`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Confirm with this sender', callback_data: `m_t_conf_${t.requestId}_${s.requestId}` }],
                    [{ text: '➡ Skip', callback_data: `m_t_skip_${t.requestId}_${s.requestId}` }]
                ]
            },
            parse_mode: 'HTML'
        };

        // 🔄 PHOTO FALLBACK
        let photo = senderDoc.data?.packagePhotoUrl;
        if (!photo && senderDoc.data?.packagePhoto) {
            console.log(`[MATCH_DEBUG] Downloading package photo on-the-fly for ${senderDoc.requestId}`);
            photo = await downloadTelegramFile(senderDoc.data.packagePhoto, `tg_pkg_match_trv_${senderDoc.requestId}.jpg`);
            if (photo) await sendersCol.updateOne({ requestId: senderDoc.requestId }, { $set: { "data.packagePhotoUrl": photo } });
        }

        // WEBSITE USER
        if (!travelerDoc.telegramId) {
            const textToSave = text.replace(/<br\/>/g, '\n');
            const uid = travelerDoc.userId.toString();
            webNotifications[uid] = webNotifications[uid] || [];
            webNotifications[uid].push({
                text: textToSave,
                buttons: keyboard.reply_markup.inline_keyboard,
                photo: photo || null,
                parse_mode: 'HTML',
                skipHistory: true
            });
            await usersCol.updateOne(
                { _id: new ObjectId(uid) },
                { $push: { chatHistory: { from: 'bot', text: textToSave, buttons: keyboard.reply_markup.inline_keyboard, photo: photo || null } } }
            );
            return;
        }

        // TELEGRAM USER
        const target = travelerDoc.telegramId;
        const photoToUse = photo || senderDoc.data?.packagePhoto;
        if (photoToUse) {
            await bot.sendPhoto(target, photoToUse, { caption: text, parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        } else {
            await bot.sendMessage(target, text, keyboard);
        }
        console.log(`[MATCH_DEBUG] Match card sent to Traveler ${travelerDoc.requestId} on Telegram.`);
    } catch (err) {
        console.error(`[MATCH_DEBUG] sendMatchCardToTraveler error:`, err);
    }
}

// ------------------- Trigger matching after approval -------------------
async function triggerMatchingForRequest(role, requestId) {
    try {
        if (role === 'sender') {
            const senderDoc = await sendersCol.findOne({ requestId });
            if (!senderDoc) return;
            if (senderDoc.matchLocked || senderDoc.pendingMatchWith) return;

            const s = buildSenderSnapshot(senderDoc);
            if (!s || s.status !== 'Approved') return;

            const candidateTravelers = await travelersCol
                .find({
                    status: 'Approved',
                    matchLocked: { $ne: true },
                    $or: [{ pendingMatchWith: null }, { pendingMatchWith: { $exists: false } }]
                })
                .toArray();

            for (const trv of candidateTravelers) {
                const t = buildTravelerSnapshot(trv);
                if (isSenderTravelerCompatible(s, t)) {
                    await sendMatchCardToSender(senderDoc, trv);
                    await sendMatchCardToTraveler(trv, senderDoc);
                }
            }
        } else {
            const travelerDoc = await travelersCol.findOne({ requestId });
            if (!travelerDoc) return;
            if (travelerDoc.matchLocked || travelerDoc.pendingMatchWith) return;

            const t = buildTravelerSnapshot(travelerDoc);
            if (!t || t.status !== 'Approved') return;

            const candidateSenders = await sendersCol
                .find({
                    status: 'Approved',
                    matchLocked: { $ne: true },
                    $or: [{ pendingMatchWith: null }, { pendingMatchWith: { $exists: false } }]
                })
                .toArray();

            for (const snd of candidateSenders) {
                const s = buildSenderSnapshot(snd);
                if (isSenderTravelerCompatible(s, t)) {
                    await sendMatchCardToTraveler(travelerDoc, snd);
                    await sendMatchCardToSender(snd, travelerDoc);
                }
            }
        }
    } catch (err) {
        console.error('triggerMatchingForRequest error', err);
    }
}

// ------------------- Match callbacks -------------------
async function handleMatchCallback(query) {
    const data = query.data;
    if (String(query.message?.chat?.id).startsWith("web_")) console.log(`[MATCH_DEBUG] Web callback received: ${data}`);
    const parts = data.split('_'); // m_s_conf_sndReq_trvReq
    if (parts.length < 5) {
        await bot.answerCallbackQuery(query.id, { text: 'Invalid match token.' });
        return;
    }
    const side = parts[1];   // 's' or 't'
    const action = parts[2]; // 'conf' or 'skip'
    const myReqId = parts[3];
    const otherReqId = parts[4];
    const fromUserId = query.from.id;

    if (action === 'skip') {
        // High priority: notify web user immediately so API returns
        if (String(query.message?.chat?.id).startsWith("web_")) {
            await bot.sendMessage(query.message.chat.id, "➡ Match skipped. Searching for more matches...");
        }

        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            }).catch(() => { });
            await bot.answerCallbackQuery(query.id, { text: 'Skipped this match.' });
        } catch (e) { }
        return;
    }

    if (action === 'conf') {
        const myRole = (side === 's') ? 'sender' : 'traveler';
        await handleUserMatchConfirm(myRole, myReqId, otherReqId, fromUserId, query);
        return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Unknown match action.' });
}

// ------------------- Confirm match & lock -------------------
async function handleUserMatchConfirm(myRole, myReqId, otherReqId, telegramUserId, query) {
    try {
        console.log(`[MATCH_DEBUG] Starting Confirmation Check for ${myReqId} by ${telegramUserId}`);
        const myCol = myRole === 'sender' ? sendersCol : travelersCol;
        const otherCol = myRole === 'sender' ? travelersCol : sendersCol;

        const myDoc = await myCol.findOne({ requestId: myReqId });
        const otherDoc = await otherCol.findOne({ requestId: otherReqId });

        if (!myDoc || !otherDoc) {
            console.log(`[MATCH_DEBUG] Doc not found: My:${myReqId} (${!!myDoc}) Other:${otherReqId} (${!!otherDoc})`);
            await bot.answerCallbackQuery(query.id, { text: 'Match not found anymore.' });
            return;
        }

        // Allow Telegram traveler OR Telegram sender to confirm
        // even if other side is a WEBSITE USER
        const myIsTelegram =
            myDoc.telegramId &&
            String(myDoc.telegramId) === String(telegramUserId);

        const myIsWeb = myDoc.userId && String(myDoc.userId) === String(telegramUserId);

        const otherIsTelegram =
            otherDoc.telegramId &&
            String(otherDoc.telegramId) === String(telegramUserId);

        const otherIsWebUserId = otherDoc.userId && String(otherDoc.userId) === String(telegramUserId);

        const otherIsWebUser = !otherDoc.telegramId;

        // allow telegram user to confirm if
        // either side belongs to him OR
        // other side is a website user
        if (!myIsTelegram && !otherIsTelegram && !otherIsWebUser && !myIsWeb && !otherIsWebUserId) {
            console.log(`[MATCH_DEBUG] Security check failed for ${telegramUserId}. MyIsWeb:${myIsWeb} MatchCard:${myReqId}`);
            await bot.answerCallbackQuery(query.id, {
                text: 'This match card is not for you.'
            });
            return;
        }

        if (myDoc.status !== 'Approved' || otherDoc.status !== 'Approved') {
            console.log(`[MATCH_DEBUG] Status Check Failed: ${myDoc.status} / ${otherDoc.status}`);
            await bot.answerCallbackQuery(query.id, { text: 'One of the requests is not approved anymore.' });
            return;
        }

        if (myDoc.matchLocked || otherDoc.matchLocked) {
            console.log(`[MATCH_DEBUG] Already Locked Check failed.`);
            await bot.answerCallbackQuery(query.id, { text: 'Already matched with someone else.' });
            return;
        }

        if (myDoc.pendingMatchWith === otherReqId) {
            console.log(`[MATCH_DEBUG] User ${telegramUserId} already confirmed this match. Skipping redundant msg.`);
            await bot.answerCallbackQuery(query.id, { text: '⏳ Waiting for the other user to verify...', show_alert: true });
            return;
        }

        // second side confirming?
        if (otherDoc.pendingMatchWith === myReqId) {
            await myCol.updateOne(
                { requestId: myReqId },
                {
                    $set: {
                        matchLocked: true,
                        matchedWith: otherReqId,
                        matchFinalizedAt: new Date()
                    },
                    $unset: { pendingMatchWith: '' }
                }
            );
            await otherCol.updateOne(
                { requestId: otherReqId },
                {
                    $set: {
                        matchLocked: true,
                        matchedWith: myReqId,
                        matchFinalizedAt: new Date()
                    },
                    $unset: { pendingMatchWith: '' }
                }
            );

            try {
                const notifyMatchConfirmed = async (uDoc) => {
                    if (!uDoc) return;
                    const matchMsg = `🤝 <b>Match Confirmed!</b>\n\nChat is now open and will remain active until delivery is completed.\n\n<i>⚠️ Do NOT share personal details.</i>`;
                    
                    if (uDoc.telegramId) {
                        await bot.sendMessage(uDoc.telegramId, matchMsg, { parse_mode: 'HTML' });
                    } else if (uDoc.userId) {
                        const uid = uDoc.userId.toString();
                        webNotifications[uid] = webNotifications[uid] || [];
                        webNotifications[uid].push({
                            text: matchMsg,
                            parse_mode: 'HTML',
                            skipHistory: true
                        });
                        await usersCol.updateOne(
                            { _id: new ObjectId(uid) },
                            { $push: { chatHistory: { from: 'bot', text: matchMsg } }, $set: { unreadService: true } }
                        );
                    }
                };

                await notifyMatchConfirmed(myDoc);
                await notifyMatchConfirmed(otherDoc);

            } catch (e) { }

            try {
                await bot.sendMessage(
                    String(ADMIN_GROUP_ID),
                    `🤝 <b>Match finalized</b>\nSender: <code>${escapeHtml(myRole === 'sender' ? myReqId : otherReqId)}</code>\nTraveler: <code>${escapeHtml(myRole === 'sender' ? otherReqId : myReqId)}</code>`,
                    { parse_mode: 'HTML' }
                );
            } catch (e) { }

            try {
                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                }).catch(() => { });
            } catch (e) { }

            // For web users, notify immediately
            if (String(query.message?.chat?.id).startsWith("web_")) {
                await bot.sendMessage(query.message.chat.id, "✅ Match confirmed!", { parse_mode: 'HTML' });
            }
            await bot.answerCallbackQuery(query.id, { text: 'Match confirmed ✅' });
            return;
        } else {
            // first side confirming
            await myCol.updateOne(
                { requestId: myReqId },
                { $set: { pendingMatchWith: otherReqId } }
            );

            // For web users: notify IMMEDIATELY so webCapture catches it
            if (String(query.message.chat.id).startsWith("web_")) {
                const waitMsg = '⏳ Match confirmation sent. Waiting for the other user to verify.';
                const photoToAttach = myDoc.data?.packagePhotoUrl || otherDoc.data?.packagePhotoUrl;
                await bot.sendMessage(query.message.chat.id, waitMsg, { parse_mode: 'HTML', photo_url: photoToAttach });
                
                // Also update history
                const myUid = myDoc.userId.toString();
                await usersCol.updateOne(
                    { _id: new ObjectId(myUid) },
                    { $push: { chatHistory: { from: 'bot', text: waitMsg, photo: photoToAttach } } }
                );
            }

            await bot.answerCallbackQuery(query.id, { text: 'Confirmation sent. Waiting for other user.' });

            try {
                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                }).catch(() => { });
            } catch (e) { }

            if (myRole === 'sender') {
                await sendMatchCardToTraveler(otherDoc, myDoc);
            } else {
                await sendMatchCardToSender(otherDoc, myDoc);
            }
        }
    } catch (err) {
        console.error('handleUserMatchConfirm error', err);
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Error while confirming match.' });
        } catch (e) { }
    }
}

// ------------------- PRIVATE CHAT FOR MATCHED USERS -------------------
async function getUserActiveRequest(chatId) {
    try {
        let query = {};
        if (String(chatId).startsWith("web_")) {
            const uidStr = chatId.replace("web_", "");
            let uidObj;
            try { uidObj = new ObjectId(uidStr); } catch(e) { }
            
            // 🛡️ Robust Query: Search for both string ID and ObjectId!
            query = {
                $or: [
                    { userId: uidStr },
                    { userId: uidObj }
                ].filter(q => q.userId)
            };
        } else {
            query = { telegramId: chatId };
        }

        const activeSender = await sendersCol.findOne({
            ...query,
            status: { $nin: ['Completed', 'Cancelled', 'Rejected'] },
            deliveryCompleted: { $ne: true }
        }, { sort: { createdAt: -1 } });
        if (activeSender) return activeSender;

        const activeTraveler = await travelersCol.findOne({
            ...query,
            status: { $nin: ['Completed', 'Cancelled', 'Rejected'] },
            deliveryCompleted: { $ne: true }
        }, { sort: { createdAt: -1 } });
        if (activeTraveler) return activeTraveler;

        return null;
    } catch (e) {
        console.error("getUserActiveRequest error:", e);
        return null;
    }
}

async function notifyPartner(targetChatId, text, keyboard = null) {
    try {
        if (String(targetChatId).startsWith("web_")) {
            const uid = String(targetChatId).replace("web_", "");
            webNotifications[uid] = webNotifications[uid] || [];
            webNotifications[uid].push({
                text: text,
                parse_mode: 'HTML',
                buttons: keyboard?.inline_keyboard || null
            });
            await usersCol.updateOne({ _id: new ObjectId(uid) }, { $set: { unreadService: true } });
        } else {
            await bot.sendMessage(targetChatId, text, { 
                parse_mode: 'HTML', 
                reply_markup: keyboard 
            });
        }
    } catch (err) {
        console.error("notifyPartner error:", err);
    }
}

async function createSupportTicket(chatId, activeReq, source) {
    const ticketId = "SUP-" + (1000 + Math.floor(Math.random() * 9000));
    const ticket = {
        supportTicketId: ticketId,
        requestId: activeReq.requestId,
        userId: activeReq.userId || activeReq.telegramId,
        chatId: chatId,
        source: source,
        flowType: activeReq.role,
        status: 'pending',
        assignedTo: null,
        handledBy: [],
        createdAt: new Date(),
        updatedAt: new Date()
    };
    await supportTicketsCol.insertOne(ticket);
    return ticket;
}

async function getSupportDashboardMarkup() {
    const total = await supportTicketsCol.countDocuments({ status: { $ne: 'closed' } });
    const pending = await supportTicketsCol.countDocuments({ status: 'pending' });
    const completed = await supportTicketsCol.countDocuments({ status: { $in: ['completed', 'closed'] } });

    return {
        inline_keyboard: [
            [
                { text: `📥 Chat Requests (${total})`, callback_data: 'support_view_all' },
            ],
            [
                { text: `⏳ Pending (${pending})`, callback_data: 'support_view_pending' },
                { text: `✅ Completed (${completed})`, callback_data: 'support_view_completed' }
            ]
        ]
    };
}

async function handleSupportView(chatId, type) {
    let query = {};
    if (type === 'pending') query = { status: 'pending' };
    else if (type === 'completed') query = { status: { $in: ['completed', 'closed'] } };
    else query = { status: { $ne: 'closed' } };

    const tickets = await supportTicketsCol.find(query).sort({ createdAt: -1 }).limit(10).toArray();
    if (tickets.length === 0) return bot.sendMessage(chatId, `📭 No ${type} tickets found.`);

    let list = `🎫 <b>${type.toUpperCase()} TICKETS</b>\n\n`;
    const kb = [];
    tickets.forEach(t => {
        list += `• <b>${t.supportTicketId}</b> (${t.status}) - ${t.requestId}\n`;
        kb.push([{ text: `View ${t.supportTicketId}`, callback_data: `ticket_${t.supportTicketId}` }]);
    });

    return bot.sendMessage(chatId, list, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function findActiveMatchForUser(chatId) {
    try {
        let uidStr = '';
        let uidObj = null;

        if (String(chatId).startsWith("web_")) {
            uidStr = String(chatId).replace("web_", "");
            try { uidObj = new ObjectId(uidStr); } catch (e) { }
        } else {
            uidStr = String(chatId);
        }

        const baseQuery = {
            $or: [
                { userId: uidStr },
                { userId: uidObj },
                { telegramId: uidStr },
                { telegramId: Number(uidStr) || -1 }
            ].filter(q => (q.userId !== undefined && q.userId !== null) || (q.telegramId !== undefined && !isNaN(q.telegramId))),
            matchLocked: true, 
            matchedWith: { $exists: true },
            deliveryCompleted: { $ne: true }
        };

        const senderDoc = await sendersCol.findOne(baseQuery, { sort: { matchFinalizedAt: -1, updatedAt: -1, createdAt: -1 } });
        const travelerDoc = await travelersCol.findOne(baseQuery, { sort: { matchFinalizedAt: -1, updatedAt: -1, createdAt: -1 } });

        if (!senderDoc && !travelerDoc) return null;
        if (senderDoc && !travelerDoc) return senderDoc;
        if (!senderDoc && travelerDoc) return travelerDoc;

        const sTime = senderDoc.matchFinalizedAt || senderDoc.updatedAt || senderDoc.createdAt || new Date(0);
        const tTime = travelerDoc.matchFinalizedAt || travelerDoc.updatedAt || travelerDoc.createdAt || new Date(0);
        return sTime >= tTime ? senderDoc : travelerDoc;
    } catch (e) {
        console.error("findActiveMatchForUser error:", e);
        return null;
    }
}

async function tryForwardChatMessage(chatId, text) {
    try {
        if (String(chatId) === String(ADMIN_GROUP_ID)) return false;

        const myDoc = await findActiveMatchForUser(chatId);
        if (!myDoc) return false;

        if (myDoc.deliveryCompleted) return false;

        const otherCol = myDoc.role === 'sender' ? travelersCol : sendersCol;
        if (!myDoc.matchedWith) return false;

        const otherDoc = await otherCol.findOne({ requestId: myDoc.matchedWith, matchLocked: true });
        if (!otherDoc) return false;

        if (otherDoc.telegramId) {

            await bot.sendMessage(
                otherDoc.telegramId,
                `💬 Message from your match:\n${escapeHtml(text)}`,
                { parse_mode: 'HTML' }
            );

        } else {

            const fwdUid = otherDoc.userId.toString();
            webNotifications[fwdUid] = webNotifications[fwdUid] || [];
            webNotifications[fwdUid].push(`💬 Message from your match:\n${text}`);
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `👀 <b>Chat message</b>\n` +
            `${myDoc.role === 'sender' ? 'Sender' : 'Traveler'} <code>${escapeHtml(myDoc.requestId)}</code>\n\n` +
            `<i>${escapeHtml(text)}</i>`,
            { parse_mode: 'HTML' }
        );

        return true;
    } catch (err) {
        console.error('tryForwardChatMessage error', err);
        return false;
    }
}

// ------------------- Commands -------------------
bot.onText(/^\/(suspend|unsuspend|terminate|unterminate)\s+(\d+)\s*(.*)?$/i, async (msg, match) => {
    try {
        if (!isAdminMessage(msg)) return;

        const fromId = msg.from.id;
        const isSuper = String(fromId) === String(SUPER_ADMIN_ID);
        const adminData = adminAuth[fromId];

        // 🛡️ ADMIN GROUP ONLY for these commands
        if (String(msg.chat.id) !== String(ADMIN_GROUP_ID)) return;

        if (!isSuper && adminData?.role !== 'admin') {
            return bot.sendMessage(msg.chat.id, '🔒 Admin access required. Please login with /admin in this group.');
        }

        const command = match[1].toLowerCase();
        const userId = Number(match[2]);
        const reason = match[3] || 'Action taken by admin';

        const found = await findUserByUserId(userId);
        if (!found) {
            return bot.sendMessage(msg.chat.id, '❌ User not found.');
        }

        const { col } = found;

        // 🔴 SUSPEND
        if (command === 'suspend') {
            await col.updateOne(
                { userId },
                { $set: { suspended: true, suspendReason: reason, suspendedAt: new Date() } }
            );

            await bot.sendMessage(
                userId,
                `🚫 <b>Your account has been suspended.</b>\n\n` +
                `<b>Reason:</b>\n${escapeHtml(reason)}` +
                SUPPORT_TEXT,
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                }
            );

            return bot.sendMessage(msg.chat.id, `✅ User ${userId} suspended.`);
        }

        // 🟢 UNTERMINATE
        if (command === 'unterminate') {
            await col.updateOne(
                { userId },
                { $unset: { terminated: '', terminateReason: '', terminatedAt: '' } }
            );

            await bot.sendMessage(
                userId,
                `✅ <b>Your account termination has been lifted.</b>\n\n` +
                `You may now access AirDlivers services again.`,
                { parse_mode: 'HTML' }
            );

            return bot.sendMessage(msg.chat.id, `✅ User ${userId} unterminated.`);
        }

        // 🟢 UNSUSPEND
        if (command === 'unsuspend') {
            await col.updateOne(
                { userId },
                { $unset: { suspended: '', suspendReason: '', suspendedAt: '' } }
            );

            await bot.sendMessage(
                userId,
                `✅ <b>Your account has been restored.</b>\n\nYou may continue your previous conversation.`,
                { parse_mode: 'HTML' }
            );

            return bot.sendMessage(msg.chat.id, `✅ User ${userId} unsuspended.`);
        }

        // 🛑 TERMINATE CHAT
        if (command === 'terminate') {
            await sendersCol.updateMany(
                { userId },
                { $set: { chatTerminated: true, terminationReason: reason }, $unset: { matchedWith: '', pendingMatchWith: '' } }
            );

            await travelersCol.updateMany(
                { userId },
                { $set: { chatTerminated: true, terminationReason: reason }, $unset: { matchedWith: '', pendingMatchWith: '' } }
            );

            await bot.sendMessage(
                userId,
                `🛑 <b>Your chat has been terminated.</b>\n\nReason:\n${escapeHtml(reason)}`,
                { parse_mode: 'HTML', ...mainMenuInline }
            );

            return bot.sendMessage(msg.chat.id, `🛑 Chat terminated for user ${userId}.`);
        }

    } catch (err) {
        console.error('Admin command error:', err);
        bot.sendMessage(msg.chat.id, '❌ Admin command failed.');
    }
});

// ------------------- SUPER ADMIN: Manage Admins -------------------
bot.onText(/^\/(addadmin|removeadmin)\s+(\d+)\s*(.*)?$/i, async (msg, match) => {
    try {
        const fromId = msg.from.id;
        const chatId = msg.chat.id;

        // ONLY Super Admin
        if (String(fromId) !== String(SUPER_ADMIN_ID)) {
            return bot.sendMessage(chatId, "🚫 Only Super Admin can use this command.");
        }

        const cmd = match[1].toLowerCase();
        const targetId = match[2];
        const role = (match[3] || 'admin').trim().toLowerCase();

        if (cmd === 'addadmin') {
            const validRoles = ['admin', 'support_member'];
            const actualRole = validRoles.includes(role) ? role : 'admin';
            
            await adminsCol.updateOne(
                { telegramId: targetId },
                { $set: { role: actualRole, addedBy: fromId, addedAt: new Date() } },
                { upsert: true }
            );

            return bot.sendMessage(chatId, `✅ Successfully added <code>${targetId}</code> as <b>${actualRole}</b>.`, { parse_mode: 'HTML' });
        }

        if (cmd === 'removeadmin') {
            const res = await adminsCol.deleteOne({ telegramId: targetId });
            if (res.deletedCount > 0) {
                return bot.sendMessage(chatId, `✅ Successfully removed <code>${targetId}</code> from admin list.`, { parse_mode: 'HTML' });
            } else {
                return bot.sendMessage(chatId, `❌ User <code>${targetId}</code> was not in the admin list.`, { parse_mode: 'HTML' });
            }
        }

    } catch (err) {
        console.error('Add/Remove admin error:', err);
        bot.sendMessage(msg.chat.id, '❌ Command failed.');
    }
});
//-------------------- Delivered--------------------///
async function handleDeliveredCommand(chatId) {
    try {
        const myDoc = await findActiveMatchForUser(chatId);

        // ❌ No active match
        if (!myDoc) {
            return bot.sendMessage(chatId,
                '❌ You don’t have any current shipment in process.',
                { parse_mode: 'HTML' }
            );
        }

        // ❌ Already completed
        if (myDoc.deliveryCompleted) {
            return bot.sendMessage(chatId,
                '❌ Your delivery is already completed.',
                { parse_mode: 'HTML' }
            );
        }

        const strChatId = String(chatId);
        const isSender = (String(myDoc.userId) === strChatId.replace("web_", "") || myDoc.telegramId === chatId) && myDoc.role === 'sender';

        if (isSender) {
            if (myDoc.handoverStarted) {
                return bot.sendMessage(chatId, '⏳ Handover started. Waiting for traveler to confirm receiving shipment.');
            }
            const keyboard = {
                inline_keyboard: [
                    [{ text: "✅ Yes, I handed it over", callback_data: `d_handover_start_${myDoc.requestId}` }],
                    [{ text: "❌ Cancel", callback_data: `d_canc_${myDoc.requestId}` }]
                ]
            };
            return bot.sendMessage(chatId, "📦 <b>Have you handed over the shipment to the traveler?</b>", { reply_markup: keyboard, parse_mode: 'HTML' });
        } else {
            // TRAVELER
            if (!myDoc.travelerReceived) {
                const rxKeyboard = {
                    inline_keyboard: [
                        [{ text: "✅ Confirm Received", callback_data: `d_rx_${myDoc.matchedWith}` }],
                        [{ text: "❌ Not Received", callback_data: `d_nrx_${myDoc.matchedWith}` }]
                    ]
                };
                return bot.sendMessage(chatId, '⚠️ <b>Handover not confirmed.</b>\n\nYou must first confirm receiving the shipment from the sender before you can mark it as delivered.', { reply_markup: rxKeyboard, parse_mode: 'HTML' });
            }
            if (myDoc.deliveryPendingApproval) {
                return bot.sendMessage(chatId, '⏳ Final delivery is currently pending admin approval.', { parse_mode: 'HTML' });
            }

            const keyboard = {
                inline_keyboard: [
                    [{ text: "✅ Yes, I delivered it", callback_data: `d_delivery_final_${myDoc.requestId}` }],
                    [{ text: "❌ Cancel", callback_data: `d_canc_${myDoc.requestId}` }]
                ]
            };
            return bot.sendMessage(chatId, "📦 <b>Confirm final delivery to the destination point?</b>", { reply_markup: keyboard, parse_mode: 'HTML' });
        }
    } catch (err) {
        console.error('handleDeliveredCommand error', err);
        return bot.sendMessage(chatId, '❌ Error processing delivery request.');
    }
}

bot.onText(/^\/delivered$/i, async (msg) => {
    await handleDeliveredCommand(msg.chat.id);
});
bot.onText(/\/start/, async (msg) => {
    console.log('[/start] received from', msg.chat.id, 'msg_id', msg.message_id);
    try {
        const chatId = msg.chat.id;
        userSessions[chatId] = null;
        const welcome =
            `<b>👋 Welcome to AirDlivers!</b>\n\n` +
            `AirDlivers is a secure communication platform that connects Senders and Airline Travelers for next-day international delivery.\n\n` +
            `Only route, travel date, and package weight are visible for matching.\n\n` +
            `<i>ℹ️ Note: All personal and document details are reviewed by our admin team and never shared between users.</i>\n\n` +
            `Choose an option below to begin.`;
        await bot.sendMessage(chatId, welcome, { parse_mode: 'HTML', ...mainMenuInline });
    } catch (err) {
        console.error('/start handler err', err);
    }
});

bot.onText(/\/id/, (msg) => {
    const chatId = msg.chat.id;
    const type = msg.chat.type;
    bot.sendMessage(
        chatId,
        `🆔 Chat ID: <code>${escapeHtml(String(chatId))}</code>\n💬 Type: ${escapeHtml(type)}`,
        { parse_mode: 'HTML' }
    );
});

bot.onText(/\/privacy|\/help/, (msg) => {
    const chatId = msg.chat.id;
    const text =
        `<b>ℹ️ Help / Support</b>\n\n` +
        `Support Group: <a href="https://t.me/+CAntejDg9plmNWI0">AirDlivers Support</a>\n` +
        `Support Email: Info@airdlivers.com\n\n` +
        `Privacy: We collect data required to facilitate deliveries (name, contact, IDs when needed). We do not sell data.`;
    bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
});
// ------------------- Admin: WHOIS command -------------------
bot.onText(/^\/whois\s+(snd\d+|trv\d+)$/i, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const fromId = msg.from.id;

        // Both groups allowed for whois if role is correct
        const allowedGroups = [String(ADMIN_GROUP_ID), String(SUPPORT_GROUP_ID)];
        if (!allowedGroups.includes(String(chatId))) return;

        const isSuper = String(fromId) === String(SUPER_ADMIN_ID);
        const adminData = adminAuth[fromId];

        if (!isSuper && !adminData?.loggedIn) {
            return bot.sendMessage(chatId, '🔒 Authorized access required. Use /admin to login.');
        }

        const requestId = match[1];
        let doc = await sendersCol.findOne({ requestId });
        let role = 'Sender';

        if (!doc) {
            doc = await travelersCol.findOne({ requestId });
            role = 'Traveler';
        }

        if (!doc) {
            return bot.sendMessage(chatId, `❌ Request ID not found: ${requestId}`);
        }

        const suspended = doc.suspended ? 'YES 🚫' : 'NO ✅';

        const text =
            `<b>👤 USER INFO</b>\n\n` +
            `<b>Role:</b> ${role}\n` +
            `<b>Request ID:</b> <code>${escapeHtml(doc.requestId)}</code>\n` +
            `<b>Telegram User ID:</b> <code>${escapeHtml(String(doc.userId))}</code>\n\n` +
            `<b>Name:</b> ${escapeHtml(doc.data?.name || 'N/A')}\n` +
            `<b>Phone:</b> ${escapeHtml(doc.data?.phone || 'N/A')}\n` +
            `<b>Status:</b> ${escapeHtml(doc.status || 'N/A')}\n` +
            `<b>Suspended:</b> ${suspended}\n\n` +
            `🛠 You may now use:\n` +
            `<code>/suspend ${doc.userId} reason</code>\n` +
            `<code>/unsuspend ${doc.userId}</code>\n` +
            `<code>/terminate ${doc.userId} reason</code>`;

        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });

    } catch (err) {
        console.error('/whois error', err);
        bot.sendMessage(msg.chat.id, '❌ WHOIS command failed.');
    }
});

// ------------------- Callback handler -------------------
bot.on('callback_query', async (query) => {
    try {
        const data = query.data;
        const chatId = query.message.chat.id;

        // 🔐 PIN PAD HANDLER
        if (data.startsWith('pin_')) {
            const fromId = query.from.id;
            const key = data.replace('pin_', '');
            
            if (!adminAuth[fromId] || !adminAuth[fromId].awaitingPin) {
                return bot.answerCallbackQuery(query.id, { text: "No active login session." });
            }

            const auth = adminAuth[fromId];
            auth.pinBuffer = auth.pinBuffer || "";

            if (key === 'clear') {
                auth.pinBuffer = "";
            } else if (key === 'ok') {
                const targetRole = auth.targetRole;
                const correctPin = targetRole === 'admin' ? String(ADMIN_PIN) : String(SUPPORT_GROUP_PIN);

                if (auth.pinBuffer === correctPin) {
                    auth.loggedIn = true;
                    auth.role = targetRole;
                    auth.name = query.from.first_name;
                    auth.awaitingPin = false;
                    delete auth.pinBuffer;

                    await bot.editMessageText(`✅ <b>Login Successful</b>\nRole: ${targetRole === 'admin' ? 'Admin' : 'Support'}\nWelcome, ${auth.name}!`, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML'
                    });

                    if (targetRole === 'support_member') {
                        await bot.sendMessage(chatId, "📊 Support Dashboard", { reply_markup: await getSupportDashboardMarkup() });
                    }
                } else {
                    auth.pinBuffer = "";
                    await bot.answerCallbackQuery(query.id, { text: "❌ Invalid PIN. Please try again.", show_alert: true });
                    return bot.editMessageReplyMarkup(getPinPadMarkup(""), {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    });
                }
                return bot.answerCallbackQuery(query.id);
            } else if (key === 'ignore') {
                return bot.answerCallbackQuery(query.id);
            } else {
                if (auth.pinBuffer.length < 8) {
                    auth.pinBuffer += key;
                }
            }

            try {
                await bot.editMessageReplyMarkup(getPinPadMarkup(auth.pinBuffer), {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
            } catch (e) {}

            return bot.answerCallbackQuery(query.id);
        }
        // fromId is declared below

        if (data === 'support_view_all') {
            await bot.answerCallbackQuery(query.id);
            return handleSupportView(chatId, 'all');
        }
        if (data === 'support_view_pending') {
            await bot.answerCallbackQuery(query.id);
            return handleSupportView(chatId, 'pending');
        }
        if (data === 'support_view_completed') {
            await bot.answerCallbackQuery(query.id);
            return handleSupportView(chatId, 'completed');
        }
        if (data && data.startsWith('ticket_')) {
            const ticketId = data.replace('ticket_', '');
            const t = await supportTicketsCol.findOne({ supportTicketId: ticketId });
            if (!t) return bot.answerCallbackQuery(query.id, { text: "Ticket not found." });
            
            await bot.answerCallbackQuery(query.id);

            let details = `🎟 <b>Ticket:</b> ${t.supportTicketId}\n`;
            details += `📦 <b>Request:</b> <code>${t.requestId}</code>\n`;
            details += `📅 <b>Created:</b> ${moment(t.createdAt).format('DD/MM/HH:mm')}\n`;
            details += `📊 <b>Status:</b> ${t.status.toUpperCase()}\n`;
            details += `👤 <b>Source:</b> ${t.source.toUpperCase()}\n`;
            if (t.firstMessage) details += `\n💬 <b>First Message:</b>\n<i>${escapeHtml(t.firstMessage)}</i>\n`;
            
            if (t.handledBy && t.handledBy.length > 0) {
                details += `\n👨‍💻 <b>Handled By:</b>\n`;
                t.handledBy.forEach(h => {
                    details += `- ${h.name} @ ${moment(h.timestamp).format('HH:mm')}\n`;
                });
            }

            return bot.sendMessage(chatId, details, { parse_mode: 'HTML' });
        }

        // matching callbacks
        if (data && data.startsWith('m_')) {
            await handleMatchCallback(query);
            return;
        }

        const fromId = query.from.id;

        // main flows
        if (data === 'flow_sender') return startSenderFlow(chatId);
        if (data === 'flow_traveler') return startTravelerFlow(chatId);
        if (data === 'flow_help') return showHelpMenu(chatId);
        if (data === 'flow_support') {
            const activeReq = await getUserActiveRequest(chatId);
            if (!activeReq) {
                return bot.sendMessage(
                    chatId,
                    "You can chat with support only if you currently have an active service request. If you do not have an active service, please contact us by email at info@airdlivers.com."
                );
            }

            // Persistence check
            let existingTicket = await supportTicketsCol.findOne({ chatId: chatId, status: { $ne: 'closed' } });
            let ticketId = existingTicket ? existingTicket.supportTicketId : null;

            if (!existingTicket) {
                const ticket = await createSupportTicket(chatId, activeReq, "telegram");
                ticketId = ticket.supportTicketId;
            }

            supportSessions[chatId] = {
                type: 'support',
                requestId: activeReq.requestId,
                supportTicketId: ticketId
            };

            const welcomeMsg = existingTicket 
                ? 'Welcome back to AirDlivers support. How can I help you?\n\n<i>Type your message below. Type /end to exit support chat.</i>'
                : 'Welcome to AirDlivers support. How can I help you?\n\n<i>Type your message below. Type /end to exit support chat.</i>';

            return bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'HTML' });
        }
        if (data === 'flow_tracking') {
            userSessions[chatId] = { type: 'tracking', step: 'tracking_phone', data: {} };
            return bot.sendMessage(
                chatId,
                '📍 Enter the phone number used for shipment (format: +911234567890):',
                { parse_mode: 'HTML' }
            );
        }
        if (data === 'flow_my_services') {
            let dbUserId = fromId;
            const user = await usersCol.findOne({ telegramId: fromId });
            if (user) dbUserId = user._id;

            const mySenders = await sendersCol.find({ $or: [{ userId: dbUserId }, { telegramId: fromId }] }).toArray();
            const myTravelers = await travelersCol.find({ $or: [{ userId: dbUserId }, { telegramId: fromId }] }).toArray();

            let servicesText = "📋 <b>My Services</b>\n\n";

            if (mySenders.length === 0 && myTravelers.length === 0) {
                servicesText += "<i>No services found.</i>";
            }

            mySenders.forEach((s) => {
                servicesText += `📦 <b>Sender</b> [<code>${s.requestId}</code>]\n`;
                servicesText += `Route: ${s.data?.pickup || '?'} ➡️ ${s.data?.destination || '?'}\n`;
                servicesText += `Status: ${s.status}\n\n`;
            });

            myTravelers.forEach((t) => {
                servicesText += `🧳 <b>Traveler</b> [<code>${t.requestId}</code>]\n`;
                servicesText += `Route: ${t.data?.departure || '?'} ➡️ ${t.data?.destination || '?'}\n`;
                servicesText += `Status: ${t.status}\n\n`;
            });

            return bot.sendMessage(chatId, servicesText, { parse_mode: 'HTML', ...backToMenuKeyboard });
        }

        if (data === 'back_to_menu') {
            userSessions[chatId] = null;

            const welcome =
                `<b>👋 Welcome to AirDlivers!</b>\n\n` +
                `AirDlivers is a secure communication platform that connects Senders and Airline Travelers for next-day international delivery.\n\n` +
                `Only route, travel date, and package weight are visible for matching.\n\n` +
                `<i>Note: Personal and document details are reviewed by our admin team and never shared.</i>\n\n` +
                `Choose an option below to begin.`;

            return bot.sendMessage(chatId, welcome, {
                parse_mode: 'HTML',
                ...mainMenuInline
            });
        }
        if (data.startsWith('d_canc_')) {
            if (!String(chatId).startsWith("web_")) {
                await bot.editMessageText("❌ Delivery confirmation cancelled.", {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
            }
            return bot.answerCallbackQuery(query.id, { text: "❌ Delivery confirmation cancelled." });
        }

        if (data.startsWith('d_handover_start_')) {
            const reqId = data.replace('d_handover_start_', '');
            const myDoc = await sendersCol.findOne({ requestId: reqId });
            if (!myDoc || myDoc.deliveryCompleted) return bot.answerCallbackQuery(query.id, { text: "Match is no longer active." });

            await sendersCol.updateOne({ requestId: reqId }, { $set: { handoverStarted: true } });

            // Notify Sender
            if (!String(chatId).startsWith("web_")) {
                await bot.editMessageText("✅ <b>Shipment handed over to traveler.</b>", { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
            }

            // Notify Traveler
            const otherDoc = await travelersCol.findOne({ requestId: myDoc.matchedWith });
            if (otherDoc) {
                const travelerId = otherDoc.telegramId || `web_${otherDoc.userId}`;
                const rxKeyboard = {
                    inline_keyboard: [
                        [{ text: "✅ Confirm Received", callback_data: `d_rx_${reqId}` }],
                        [{ text: "❌ Not Received", callback_data: `d_nrx_${reqId}` }]
                    ]
                };
                await notifyPartner(travelerId, `📦 <b>Sender has handed over the shipment to you.</b>\n\nDid you receive the package?`, rxKeyboard);
            }

            // Notify Admin
            await bot.sendMessage(String(ADMIN_GROUP_ID), `🚀 <b>Handover Started</b>\nRequest ID: <code>${reqId}</code>\nSender ID: <code>${myDoc.userId}</code>`, { parse_mode: 'HTML' });
            return bot.answerCallbackQuery(query.id);
        }

        if (data.startsWith('d_rx_')) {
            const reqId = data.replace('d_rx_', '');
            const senderDoc = await sendersCol.findOne({ requestId: reqId });
            if (!senderDoc) return bot.answerCallbackQuery(query.id, { text: "Link expired/Invalid." });

            await sendersCol.updateOne({ requestId: reqId }, { $set: { travelerReceived: true } });
            await travelersCol.updateOne({ requestId: senderDoc.matchedWith }, { $set: { travelerReceived: true } });

            if (!String(chatId).startsWith("web_")) {
                await bot.editMessageText("✅ <b>You confirmed receiving the shipment.</b>", { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
            }

            // Notify Traveler (Self)
            await bot.sendMessage(chatId, "✅ <b>You confirmed that shipment has been picked up from the sender.</b>", { parse_mode: 'HTML' });

            // Notify Sender
            const senderChatId = senderDoc.telegramId || `web_${senderDoc.userId}`;
            await notifyPartner(senderChatId, "📦 <b>Traveler confirmed receiving your shipment.</b>\n\nChat remains open until they reach the final destination.");

            // Ask for notes
            userSessions[chatId] = { type: 'delivery_flow', step: 'handover_note', requestId: reqId };
            await bot.sendMessage(chatId, "📝 <b>Add optional notes or type 'None' to complete reception:</b>", { parse_mode: 'HTML' });

            return bot.answerCallbackQuery(query.id);
        }

        if (data.startsWith('d_nrx_')) {
            const reqId = data.replace('d_nrx_', '');
            const senderDoc = await sendersCol.findOne({ requestId: reqId });
            if (!senderDoc) return bot.answerCallbackQuery(query.id, { text: "Link expired/Invalid." });

            await sendersCol.updateOne({ requestId: reqId }, { $set: { handoverStarted: false } });

            if (!String(chatId).startsWith("web_")) {
                await bot.editMessageText("❌ <b>You reported handover as FAILED (Not Received).</b>", { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
            }

            // Notify Sender
            const senderChatId = senderDoc.telegramId || `web_${senderDoc.userId}`;
            await notifyPartner(senderChatId, "⚠️ <b>Traveler reported shipment NOT received.</b>\n\nYou can try clicking the 'Delivered' button again once the handover is complete.");

            // Notify Admin
            await bot.sendMessage(String(ADMIN_GROUP_ID), `⚠️ <b>Handover Rejected</b>\nRequest ID: <code>${reqId}</code>\nTraveler ID: <code>${senderDoc.matchedWith}</code>`, { parse_mode: 'HTML' });
            return bot.answerCallbackQuery(query.id);
        }

        if (data.startsWith('d_delivery_final_')) {
            const reqId = data.replace('d_delivery_final_', '');
            const travelerDoc = await travelersCol.findOne({ requestId: reqId });
            if (!travelerDoc) return bot.answerCallbackQuery(query.id, { text: "Request not found." });

            if (!String(chatId).startsWith("web_")) {
                await bot.editMessageText("✅ <b>Final delivery initiated. Please provide details...</b>", { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
            }

            // Notify Sender
            const senderDoc = await sendersCol.findOne({ matchedWith: reqId });
            if (senderDoc) {
                const senderChatId = senderDoc.telegramId || `web_${senderDoc.userId}`;
                await notifyPartner(senderChatId, "📦 <b>Traveler has started the final delivery process.</b>\n\nChat will be closed once Admin approves the delivery.");
            }

            // Ask for notes
            userSessions[chatId] = { type: 'delivery_flow', step: 'final_note', requestId: reqId };
            await bot.sendMessage(chatId, "📝 <b>Add optional notes or type 'None' to complete delivery:</b>", { parse_mode: 'HTML' });

            return bot.answerCallbackQuery(query.id);
        }

        if (data.startsWith('d_admin_app_')) {
            const reqId = data.replace('d_admin_app_', '');
            let doc = await travelersCol.findOne({ requestId: reqId });

            if (!doc) return bot.answerCallbackQuery(query.id, { text: "Request not found." });
            if (doc.deliveryCompleted) return bot.answerCallbackQuery(query.id, { text: "Already completed." });

            // Complete Traveler
            await travelersCol.updateOne({ requestId: reqId }, { $set: { status: 'Completed', deliveryCompleted: true, deliveryCompletedAt: new Date(), deliveryPendingApproval: false } });

            // Complete Sender
            const senderDoc = await sendersCol.findOne({ matchedWith: reqId });
            if (senderDoc) {
                await sendersCol.updateOne({ requestId: doc.matchedWith }, { $set: { status: 'Completed', deliveryCompleted: true, deliveryCompletedAt: new Date(), deliveryPendingApproval: false } });
            }

            const closureMsg = "📦 <b>Delivery completed successfully. Chat closed.</b>";

            // Notify Traveler
            const travelerId = doc.telegramId || `web_${doc.userId}`;
            await notifyPartner(travelerId, closureMsg);
            if (!String(travelerId).startsWith("web_")) {
                await bot.sendMessage(travelerId, "🆕 <b>Main Menu</b>", { parse_mode: 'HTML', ...mainMenuInline });
            }

            // Notify Sender
            if (senderDoc) {
                const senderId = senderDoc.telegramId || `web_${senderDoc.userId}`;
                await notifyPartner(senderId, closureMsg);
                if (!String(senderId).startsWith("web_")) {
                    await bot.sendMessage(senderId, "🆕 <b>Main Menu</b>", { parse_mode: 'HTML', ...mainMenuInline });
                }
            }

            await bot.editMessageText(`✅ <b>Approved Delivery!</b>\nIDs: S:${doc.matchedWith} T:${reqId}\nChat closed for both users.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
            return bot.answerCallbackQuery(query.id);
        }

        if (data.startsWith('d_admin_rej_')) {
            const reqId = data.replace('d_admin_rej_', '');
            let doc = await travelersCol.findOne({ requestId: reqId });
            if (!doc) return bot.answerCallbackQuery(query.id, { text: "Request not found." });

            await travelersCol.updateOne({ requestId: reqId }, { $set: { deliveryPendingApproval: false } });

            const rejMsg = "❌ <b>Admin has rejected your final delivery confirmation.</b>\n\nPlease discuss with your partner.";
            const travelerId = doc.telegramId || `web_${doc.userId}`;
            await notifyPartner(travelerId, rejMsg);

            await bot.editMessageText(`❌ <b>Rejected Final Delivery</b>\nID: <code>${reqId}</code>\nChat remains open.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
            return bot.answerCallbackQuery(query.id);
        }

        // categories
        if (data && data.startsWith('cat_')) {

            const session = userSessions[chatId];
            if (!session || session.type !== 'sender') return;

            const value = data.replace('cat_', '');

            if (value === "Other") {

                session.step = 'category_other';

                return bot.sendMessage(
                    chatId,
                    '✏️ Please enter the category type:',
                    { parse_mode: 'HTML' }
                );
            }

            session.data.category = value;
            session.step = 'package_photo';
            session.expectingPhoto = 'package_photo';

            return bot.sendMessage(
                chatId,
                '📷 Upload a photo of the package (mandatory):',
                { parse_mode: 'HTML' }
            );
        }

        // confirmations
        if (data && data.startsWith('confirm_')) {

            const parts = data.split('_');
            if (parts.length < 4) {
                await bot.answerCallbackQuery(query.id, { text: 'Invalid token' });
                return;
            }

            const decision = parts[1];
            const role = parts[2];
            const requestId = parts.slice(3).join('_');
            const sessChatId = chatId;
            const session = userSessions[sessChatId];

            if (!session || session.requestId !== requestId) {
                await bot.answerCallbackQuery(query.id, { text: 'Session expired.' });
                return;
            }

            // ✅ ANSWER TELEGRAM FIRST (CRITICAL)
            await bot.answerCallbackQuery(query.id, { text: 'Submitting...' });

            if (decision === 'no') {
                userSessions[sessChatId] = null;
                return;
            }

            // 🚀 RUN SUBMIT IN BACKGROUND
            setImmediate(async () => {
                if (role === 'sender') {
                    await handleFinalSenderSubmit(sessChatId, session);
                }
                if (role === 'traveler') {
                    await handleFinalTravelerSubmit(sessChatId, session);
                }
            });

            return;
        }

        // Admin actions
        if (
            data &&
            (data.startsWith('approve_') ||
                data.startsWith('reject_') ||
                data.startsWith('reason_') ||
                data.startsWith('requestvisa_'))
        ) {
            const invokedBy = query.from.id;
            const userIsSuper = String(invokedBy) === String(SUPER_ADMIN_ID);
            const userIsLogged = Boolean(adminAuth[invokedBy]?.loggedIn);

            if (!userIsSuper && !userIsLogged) {
                await bot.answerCallbackQuery(query.id, { text: '🔒 Not authorized. Login with /admin (PIN) in admin group.' });
                return;
            }

            if (data.startsWith('approve_')) {

                const reqId = data.replace('approve_', '');

                // ✅ Answer Telegram IMMEDIATELY (UNBLOCKS BOT)
                await bot.answerCallbackQuery(query.id, { text: 'Processing...' });

                // 🚀 Run approval in background
                setImmediate(async () => {
                    await processApprove(reqId, invokedBy, null);
                });

                return;
            }
            if (data.startsWith('reject_')) {
                const reqId = data.replace('reject_', '');
                adminAuth[invokedBy] = { ...adminAuth[invokedBy], awaitingCustomReasonFor: null };
                await bot.sendMessage(query.message.chat.id, '📝 Choose rejection reason:', rejectionReasonsKeyboard(reqId));
                await bot.answerCallbackQuery(query.id);
                return;
            }
            if (data.startsWith('reason_')) {
                const parts = data.split('_');
                const reasonType = parts[1];
                const reqId = parts.slice(2).join('_');
                if (reasonType === 'other') {
                    adminAuth[invokedBy] = { ...adminAuth[invokedBy], awaitingCustomReasonFor: reqId };
                    await bot.sendMessage(query.message.chat.id, '✏️ Please type the custom rejection reason in the group now (one message).');
                    await bot.answerCallbackQuery(query.id);
                    return;
                } else {
                    let msg = '';
                    if (reasonType === 'info') msg = '❌ Rejected: incomplete information.';
                    if (reasonType === 'item') msg = '🚫 Rejected: prohibited item.';
                    if (reasonType === 'doc') msg = '📄 Rejected: invalid or missing documents.';
                    await processReject(reqId, msg, invokedBy, query);
                    return;
                }
            }
            if (data.startsWith('requestvisa_')) {
                const reqId = data.replace('requestvisa_', '');
                await processRequestVisa(reqId, invokedBy, query);
                return;
            }
        }

        await bot.answerCallbackQuery(query.id, { text: 'Action received.' });
    } catch (err) {
        console.error('callback_query handler error', err);
        try { await bot.answerCallbackQuery(query.id, { text: 'Internal error.' }); } catch (e) { }
    }
});

// ------------------- Flow helpers -------------------
function startSenderFlow(chatId) {
    userSessions[chatId] = {
        type: 'sender',
        step: 'sender_name',
        data: {},
        expectingPhoto: null,
        requestId: null
    };
    bot.sendMessage(chatId, '👤 Enter your Full Name:', { parse_mode: 'HTML' });
}

function startTravelerFlow(chatId) {
    userSessions[chatId] = {
        type: 'traveler',
        step: 'traveler_name',
        data: {},
        expectingPhoto: null,
        requestId: null
    };
    bot.sendMessage(chatId, '👤 Enter your Full Name:', { parse_mode: 'HTML' });
}

function showHelpMenu(chatId) {
    const HELP_TEXT =
        `<b>ℹ️ AirDlivers – Help & Support</b>

<b>What is AirDlivers?</b>  
AirDlivers is a secure communication platform that connects Senders with Airline Travelers to coordinate international package delivery using available luggage space.

<b>How it Works</b>  
• Senders submit package & ID details  
• Travelers submit travel route & ID details  
• Admin verifies all documents  
• Only routes, dates & weight are matched  
• Users can confirm or skip matches  
• Once confirmed, users can chat inside the app  
• Personal details remain hidden  
• After delivery, the chat is closed  

<b>Privacy & Safety</b>  
• Only route, date & weight are visible  
• Personal documents are reviewed by admin only  
• No personal data is shared between users & for other uses 
• The inapp chat will not allow you to share any attachments(photos, locations,etc)
• All users are verified  

<b>Safety Enforcement</b>  
Any suspicious activity, unsafe communication, policy violations, or misuse will result in:  
• Immediate chat suspension  
• Account termination  
• Permanent ban from AirDlivers & legal actions will be taken relating to voilations. 

Once banned, the user will NOT be allowed to use the platform again.

<b>Terms of Use</b>  
• AirDlivers is a communication platform only  
• We do NOT handle payments or transport  
• Users are responsible for their own actions  
• Illegal or unsafe items are not allowed  
• Admin may suspend or terminate accounts  

<b>Legal Disclaimer</b>  
AirDlivers does NOT:  
• Transport packages  
• Handle money  
• Act as a courier company  
• Guarantee deliveries  

AirDlivers is not liable for loss, delays, customs issues, or disputes.

<b>Need Support?</b>  
📞 <b>Chat with us:</b> click the button below  
📧 Info@airdlivers.com  

<b>By using AirDlivers, you agree to these rules.</b>`;

    return bot.sendMessage(chatId, HELP_TEXT, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [{ text: '💬 Chat with Support Team', callback_data: 'flow_support' }],
                [{ text: '⬅️ Back to Menu', callback_data: 'back_to_menu' }]
            ]
        }
    });
}

// ------------------- Text message handler -------------------
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const fromId = msg.from.id;
        const text = (msg.text || '').trim();
        if (text.startsWith('/')) {
            console.log('[MESSAGE] command heard:', text, 'from', msg.chat.id);
        }
        const session = userSessions[chatId];
        const supportSession = supportSessions[chatId];

        // 🚫 Suspended user check
        const suspended =
            (await sendersCol.findOne({ userId: chatId, suspended: true })) ||
            (await travelersCol.findOne({ userId: chatId, suspended: true }));

        if (suspended && !text.startsWith('/start')) {
            return bot.sendMessage(
                chatId,
                `🚫 <b>Your account is suspended.</b>\n\n<b>Reason:</b>\n${escapeHtml(
                    suspended.suspendReason || 'Contact support'
                )}${SUPPORT_TEXT}`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );
        }

        // Handle commands with possible bot name (e.g., /support@AirdliversBot)
        const cmd = text.split('@')[0].toLowerCase();

        // /admin or /support
        if (cmd === '/admin' || cmd === '/support' || cmd === '/support_dashboard') {
            const sid = String(SUPPORT_GROUP_ID);
            const aid = String(ADMIN_GROUP_ID);
            const cid = String(chatId);
            
            console.log(`[AUTH] Command: ${cmd}, chatId: ${cid}`);

            // 🔍 Check persistent admin list
            const pAdmin = await adminsCol.findOne({ telegramId: String(fromId) });
            const isSuper = String(fromId) === String(SUPER_ADMIN_ID);

            if (isSuper || pAdmin) {
                const effectiveRole = isSuper ? 'admin' : pAdmin.role;
                
                // Allow login if role matches group context or is super
                const canAdmin = (cid === aid && (effectiveRole === 'admin' || isSuper));
                const canSupport = (cid === sid && (effectiveRole === 'support_member' || effectiveRole === 'admin' || isSuper));

                if (canAdmin || canSupport) {
                    adminAuth[fromId] = { loggedIn: true, role: effectiveRole, name: msg.from.first_name };
                    await bot.sendMessage(chatId, `✅ <b>Logged in as ${effectiveRole}</b> (Persistent Access)`, { parse_mode: 'HTML' });
                    if (canSupport || isSuper) {
                         return bot.sendMessage(chatId, "📊 Support Dashboard", { reply_markup: await getSupportDashboardMarkup() });
                    }
                    return;
                }
            }

            if (cid === aid) {
                adminAuth[fromId] = { awaitingPin: true, targetRole: 'admin', pinBuffer: "" };
                return bot.sendMessage(chatId, "🔐 <b>Admin Login Requested</b>\n\nUse the keypad below to enter your PIN.", { 
                    parse_mode: 'HTML', 
                    reply_markup: getPinPadMarkup("") 
                });
            }
            if (cid === sid) {
                adminAuth[fromId] = { awaitingPin: true, targetRole: 'support_member', pinBuffer: "" };
                return bot.sendMessage(chatId, "🔐 <b>Support Admin Login Requested</b>\n\nUse the keypad below to enter your PIN.", { 
                    parse_mode: 'HTML', 
                    reply_markup: getPinPadMarkup("") 
                });
            }

            return bot.sendMessage(chatId, '🚫 Not authorized in this group.');
        }

        // REMOVED TEXT-BASED PIN HANDLER FOR MAXIMUM SECURITY (USING INLINE PAD INSTEAD)
        // Standalone /end SUP-XXXX command for Admins/Support
        if ((String(chatId) === String(ADMIN_GROUP_ID) || String(chatId) === String(SUPPORT_GROUP_ID)) && text.toLowerCase().startsWith('/end sup-')) {
             const closeTicketId = text.split(' ')[1]?.toUpperCase();
             if (closeTicketId) {
                  const t = await supportTicketsCol.findOne({ supportTicketId: closeTicketId });
                  if (t) {
                      await supportTicketsCol.updateOne({ supportTicketId: closeTicketId }, { $set: { status: 'closed', closedAt: new Date(), updatedAt: new Date() } });
                      delete supportSessions[t.chatId];
                      if (String(t.chatId).startsWith('web_')) {
                          const uid = t.chatId.replace('web_', '');
                          await usersCol.updateOne({ _id: new ObjectId(uid) }, { $unset: { currentSupportTicketId: "" } });
                          webSupportNotifications[uid] = webSupportNotifications[uid] || [];
                          webSupportNotifications[uid].push("✅ This support chat has been closed. If you need further assistance, please start a new support chat.");
                          await usersCol.updateOne({ _id: new ObjectId(uid) }, { $set: { unreadSupport: true } });
                      } else {
                          await bot.sendMessage(t.chatId, "✅ This support chat has been closed. If you need further assistance, please start a new support chat.");
                      }
                      return bot.sendMessage(chatId, `✅ Successfully closed ticket ${closeTicketId}`);
                  }
             }
        }

        if ((String(chatId) === String(ADMIN_GROUP_ID) || String(chatId) === String(SUPPORT_GROUP_ID)) && msg.reply_to_message) {
            const repliedTo = msg.reply_to_message.text || msg.reply_to_message.caption || '';
            // Handle possibility of hidden spaces or HTML entities in Telegram's parsed text
            const matchRef = repliedTo.match(/Ref:\s*([a-zA-Z0-9_]+)/i); 
            const matchTicket = repliedTo.match(/\[(SUP-\d+)\]/);
            
            console.log(`[SUPPORT REPLY] Examining reply to message: "${repliedTo.substring(0, 50)}..."`);
            
            if (matchRef && matchRef[1]) {
                const targetRef = matchRef[1].trim();
                const ticketId = matchTicket ? matchTicket[1] : null;
                console.log(`[SUPPORT REPLY] FOUND! targetRef: ${targetRef}, ticketId: ${ticketId}`);

                // Log reply metadata update
                if (ticketId) {
                    await supportTicketsCol.updateOne(
                        { supportTicketId: ticketId },
                        { 
                            $set: { status: 'open', assignedTo: String(fromId), updatedAt: new Date() },
                            $push: { handledBy: { tgId: String(fromId), name: msg.from.first_name, timestamp: new Date() } }
                        }
                    );
                }
                
                // End chat option (via reply)
                if (text.toLowerCase().startsWith('/end')) {
                    const closeTicketId = text.split(' ')[1] || ticketId;
                    if (closeTicketId) {
                         const t = await supportTicketsCol.findOne({ supportTicketId: closeTicketId });
                         if (t) {
                             await supportTicketsCol.updateOne({ supportTicketId: closeTicketId }, { $set: { status: 'closed', closedAt: new Date(), updatedAt: new Date() } });
                             delete supportSessions[t.chatId];
                             if (String(t.chatId).startsWith('web_')) {
                                  const uid = t.chatId.replace('web_', '');
                                  await usersCol.updateOne({ _id: new ObjectId(uid) }, { $unset: { currentSupportTicketId: "" } });
                                  webSupportNotifications[uid] = webSupportNotifications[uid] || [];
                                  webSupportNotifications[uid].push("✅ This support chat has been closed. If you need further assistance, please start a new support chat.");
                                  await usersCol.updateOne({ _id: new ObjectId(uid) }, { $set: { unreadSupport: true } });
                             } else {
                                  await bot.sendMessage(t.chatId, "✅ This support chat has been closed. If you need further assistance, please start a new support chat.");
                             }
                             return bot.sendMessage(chatId, `✅ Ended support ticket ${closeTicketId}`);
                         }
                    }
                }

                if (String(targetRef).startsWith('web_')) {
                     const uid = targetRef.replace('web_', '');
                     const adminName = msg.from.first_name || 'Admin';
                     webSupportNotifications[uid] = webSupportNotifications[uid] || [];
                     webSupportNotifications[uid].push({ text: `👨‍💻 Support: ${text}`, adminId: String(fromId), adminName, target: "support" });
                     await usersCol.updateOne(
                         { _id: new ObjectId(uid) },
                         { 
                             $push: { chatHistory: { from: 'bot', text: `👨‍💻 Support: ${text}`, target: "support", adminId: String(fromId), adminName, timestamp: new Date() } },
                             $set: { unreadSupport: true }
                         }
                     );
                } else if (String(targetRef).startsWith('tg_')) {
                     const uid = targetRef.replace('tg_', '');
                     await bot.sendMessage(uid, `👨‍💻 Support: ${text}`);
                }
                return; 
            }
        }

        // 🚫 RESTRICT match forwarding from Admin/Support groups
        if (String(chatId) === String(ADMIN_GROUP_ID) || String(chatId) === String(SUPPORT_GROUP_ID)) {
             return; 
        }

        // Support flow (Telegram user) - Priority handling
        if (supportSession?.type === 'support') {
            if (text.toLowerCase() === '/end' || text.toLowerCase() === 'end chat') {
                const ticketId = supportSession.supportTicketId;
                await supportTicketsCol.updateOne({ supportTicketId: ticketId }, { $set: { status: 'closed', closedAt: new Date() } });
                delete supportSessions[chatId];
                return bot.sendMessage(chatId, "✅ Support chat ended. If you need more help, please start a new support chat.", mainMenuInline);
            } else {
                let tgUserTitle = msg.from.first_name || 'Unknown';
                if (msg.from.username) tgUserTitle += ` (@${msg.from.username})`;
                const ticketId = supportSession.supportTicketId;
                const reqId = supportSession.requestId;

                await bot.sendMessage(
                    String(SUPPORT_GROUP_ID),
                    `🆘 <b>Support Request [${ticketId}]</b>\n` +
                    `<b>User:</b> ${escapeHtml(tgUserTitle)}\n` +
                    `<b>Request:</b> <code>${reqId}</code>\n` +
                    `<b>Source:</b> Telegram\n` +
                    `<b>Ref:</b> <code>tg_${chatId}</code>\n\n` +
                    `💬 <i>${escapeHtml(text)}</i>`,
                    { parse_mode: 'HTML' }
                );
                await supportTicketsCol.updateOne(
                    { supportTicketId: ticketId, firstMessage: { $exists: false } },
                    { $set: { firstMessage: text } }
                );
                return bot.sendMessage(chatId, "✅ Message received by support team. Please wait for a reply.");
            }
        }

        // 🟢 ABORT IF NOT TEXT
        if (!msg.text) {
            return;
        }

        // --- 🚛 Delivery Flow Note Capture (Telegram) ---
        if (session?.type === 'delivery_flow') {
            const reqId = session.requestId;
            const note = text.toLowerCase() === 'none' ? '' : text;
            
            if (session.step === 'handover_note') {
                await sendersCol.updateOne({ requestId: reqId }, { $set: { handoverNote: note } });
                await travelersCol.updateOne({ requestId: reqId }, { $set: { handoverNote: note } }); 
                userSessions[chatId] = null;
                await bot.sendMessage(chatId, "✅ Handover note saved. Chat remains open until final delivery.");
                // Notify Admin
                await bot.sendMessage(String(ADMIN_GROUP_ID), `📋 <b>Traveler Confirmed Receipt</b>\nReq: <code>${reqId}</code>\nNote: ${note || 'None'}`, { parse_mode: 'HTML' });
                return;
            } else if (session.step === 'final_note') {
                await travelersCol.updateOne({ requestId: reqId }, { $set: { finalNote: note, deliveryPendingApproval: true } });
                userSessions[chatId] = null;
                await bot.sendMessage(chatId, "✅ Final delivery note saved. Waiting for admin approval.");
                // Notify Admin for approval
                const adminKeyboard = {
                    inline_keyboard: [
                        [{ text: "✅ Approve Delivery", callback_data: `d_admin_app_${reqId}` }],
                        [{ text: "❌ Reject", callback_data: `d_admin_rej_${reqId}` }]
                    ]
                };
                await bot.sendMessage(String(ADMIN_GROUP_ID), `🏁 <b>Final Delivery Completed</b>\nReq: <code>${reqId}</code>\nNote: ${note || 'None'}\nApprove closure?`, { parse_mode: 'HTML', reply_markup: adminKeyboard });
                return;
            }
        }

        // If no session → forward chat if matched
        if (!session) {
            if (!text.startsWith('/')) {
                const handled = await tryForwardChatMessage(chatId, text);
                if (handled) return;
            }
            return;
        }


        // Tracking flow
        if (session.type === 'tracking' && session.step === 'tracking_phone') {
            if (!isValidPhone(text)) {
                return bot.sendMessage(chatId, '❌ Invalid phone number.');
            }

            const doc =
                (await sendersCol.findOne({ 'data.phone': text })) ||
                (await travelersCol.findOne({ 'data.phone': text }));

            if (!doc) {
                return bot.sendMessage(chatId, '❌ No shipment found.');
            }

            return bot.sendMessage(
                chatId,
                `<b>📦 Status:</b> ${escapeHtml(doc.status || 'Pending')}`,
                { parse_mode: 'HTML' }
            );
        }

        // Sender flow
        if (session.type === 'sender') {
            await handleSenderTextStep(chatId, text);
            return;
        }

        // Traveler flow
        if (session.type === 'traveler') {
            await handleTravelerTextStep(chatId, text);
            return;
        }

    } catch (err) {
        console.error('message handler error', err);
    }
});

// ------------------- Photo handler (single, merged) -------------------

bot.on('photo', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const active = await findActiveMatchForUser(chatId);
        if (active && !userSessions[chatId]) {
            return bot.sendMessage(chatId, "⚠️ Attachments are not allowed in private match chat.");
        }
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const session = userSessions[chatId];

        // If in a session expecting a photo (sender/traveler flows)
        if (session) {
            if (session.type === 'sender') {
                if (session.expectingPhoto === 'package_photo') {
                    session.data.packagePhoto = fileId;
                    session.data.packagePhotoUrl = await downloadTelegramFile(fileId, `tg_pkg_${chatId}_${Date.now()}.jpg`);
                    session.expectingPhoto = null;
                    session.step = 'send_date';
                    await bot.sendMessage(chatId, '📅 Enter Send Date (DD-MM-YYYY):', { parse_mode: 'HTML' });
                    return;
                }
                if (session.expectingPhoto === 'selfie_id') {
                    session.data.selfieId = fileId;
                    session.data.selfieIdUrl = await downloadTelegramFile(fileId, `tg_slf_${chatId}_${Date.now()}.jpg`);
                    session.expectingPhoto = null;
                    session.step = 'optional_notes';
                    await bot.sendMessage(chatId, "📝 Add optional notes or type 'None':", { parse_mode: 'HTML' });
                    return;
                }
            }

            if (session.type === 'traveler') {
                if (session.expectingPhoto === 'passport_selfie') {
                    session.data.passportSelfie = fileId;
                    session.data.passportSelfieUrl = await downloadTelegramFile(fileId, `tg_pss_${chatId}_${Date.now()}.jpg`);
                    session.expectingPhoto = 'itinerary_photo';
                    session.step = 'itinerary_photo';
                    await bot.sendMessage(chatId, '📄 Upload your Itinerary Photo (mandatory):', { parse_mode: 'HTML' });
                    return;
                }
                if (session.expectingPhoto === 'itinerary_photo') {
                    session.data.itineraryPhoto = fileId;
                    session.data.itineraryPhotoUrl = await downloadTelegramFile(fileId, `tg_itn_${chatId}_${Date.now()}.jpg`);
                    session.expectingPhoto = null;
                    session.step = 'optional_notes';
                    await bot.sendMessage(chatId, "📝 Add optional notes or type 'None':", { parse_mode: 'HTML' });
                    return;
                }
                if (session.expectingPhoto === 'visa_photo') {
                    session.data.visaPhoto = fileId;
                    session.expectingPhoto = null;
                    session.step = 'optional_notes';
                    await bot.sendMessage(chatId, "📝 Add optional notes or type 'None':", { parse_mode: 'HTML' });
                    return;
                }
            }
        }

        // If not in a "photo expected" step, maybe this is a visa upload after admin requested visa:
        const pendingVisa = await travelersCol.findOne({ userId: chatId, status: 'VisaRequested' });
        if (!pendingVisa) return;

        await travelersCol.updateOne(
            { requestId: pendingVisa.requestId },
            {
                $set: {
                    'data.visaPhoto': fileId,
                    status: 'VisaUploaded',
                    updatedAt: new Date()
                }
            }
        );

        await bot.sendPhoto(String(ADMIN_GROUP_ID), fileId, {
            caption: `🛂 Visa uploaded for ${escapeHtml(pendingVisa.requestId)}`
        });
        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `Admin actions for <code>${escapeHtml(pendingVisa.requestId)}</code>:`,
            {
                parse_mode: 'HTML',
                ...adminActionKeyboardForDoc({
                    requestId: pendingVisa.requestId,
                    role: 'traveler',
                    status: 'VisaUploaded'
                })
            }
        );
        await bot.sendMessage(chatId, '✅ Visa received. Admin will review and approve/reject shortly.', {
            parse_mode: 'HTML'
        });
    } catch (err) {
        console.error('photo handler error', err);
    }
});

// ------------------- Sender text steps -------------------
async function handleSenderTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;
    const data = sess.data;

    switch (sess.step) {
        case 'sender_name':
            if (text.length < 2) return bot.sendMessage(chatId, 'Enter a valid full name (min 2 chars).');
            data.name = text;
            sess.step = 'sender_phone';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(
                chatId,
                '📞 Enter your Phone Number (example: +911234567089):',
                { parse_mode: 'HTML' }
            );

        case 'sender_phone':
            if (!isValidPhone(text)) {
                return bot.sendMessage(chatId, '❌ Invalid phone number. Use like +911234567890');
            }
            data.phone = text.trim();
            sess.step = 'sender_email';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '📧 Enter your Email:', { parse_mode: 'HTML' });

        case 'sender_email':
            if (!isValidEmail(text)) {
                return bot.sendMessage(chatId, '❌ Invalid email. Please enter a valid email.');
            }
            data.email = text.trim();
            sess.step = 'pickup_airport';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(
                chatId,
                '🛫 Enter Pickup Airport (From):\n\n<i>Note:✈️ Please enter the airport clearly.\nExample: "Dubai International Airport" or "DXB".\nAvoid spelling mistakes or nicknames to ensure accurate matching.</i>',
                { parse_mode: 'HTML' }
            );

        case 'pickup_airport':
            if (!text) {
                return bot.sendMessage(chatId, 'Enter pickup airport name clearly as shown in example.');
            }
            data.pickup = text;
            sess.step = 'destination_airport';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(
                chatId,
                '🛬 Enter Destination Airport (To):\n\n<i>Note:✈️ Please enter the airport clearly.\nExample: "Heathrow Airport" or "LHR".\nAvoid spelling mistakes or nicknames to ensure accurate matching.</i>',
                { parse_mode: 'HTML' }
            );

        case 'destination_airport':
            data.destination = text;
            sess.step = 'package_weight';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '⚖️ Enter Package Weight in kg (Max 10kg):', { parse_mode: 'HTML' });

        case 'package_weight': {
            const m = text.match(/(\d+(\.\d+)?)/);
            if (!m) return bot.sendMessage(chatId, 'Invalid weight format. Use numbers (e.g., 2.5).');
            const w = parseFloat(m[1]);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, 'Enter a positive weight.');
            if (w > 10) {
                return bot.sendMessage(
                    chatId,
                    '❌ Weight must be less than or equal to 10kg.\nPlease enter a valid weight:',
                    { parse_mode: 'HTML' }
                );
            }
            data.weight = w;
            sess.step = 'package_category';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            sess.data.category = "";
            return bot.sendMessage(
                chatId,
                '📦 Choose package category:',
                categoryKeyboardSingle()
            );
        }
        case 'package_category':

            if (text.startsWith("cat_")) {

                const value = text.replace("cat_", "");

                if (value === "Other") {

                    sess.step = "category_other";

                    return bot.sendMessage(
                        chatId,
                        "✏️ Please enter the category type:"
                    );
                }

                data.category = value;

                sess.step = 'package_photo';
                sess.expectingPhoto = 'package_photo';

                if (String(chatId).startsWith("web_")) {
                    await usersCol.updateOne(
                        { _id: new ObjectId(sess.webUserId) },
                        {
                            $set: {
                                flowStep: sess.step,
                                flowData: sess.data,
                                flowExpectingPhoto: sess.expectingPhoto || null
                            }
                        }
                    );
                }

                return bot.sendMessage(
                    chatId,
                    '📷 Upload a photo of the package (mandatory):'
                );
            }

            return;
        case 'category_other':

            if (!text || text.length < 2) {
                return bot.sendMessage(
                    chatId,
                    'Please enter valid category type.'
                );
            }

            data.category = text;
            sess.step = 'package_photo';
            sess.expectingPhoto = 'package_photo';

            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }

            return bot.sendMessage(
                chatId,
                '📷 Upload a photo of the package (mandatory):'
            );
        case 'send_date': {

            if (!text || text.trim().length === 0) {
                return; // do nothing, wait for user input
            }

            const d = parseDate_ddmmyyyy(text);

            if (!d) {
                return bot.sendMessage(chatId, 
                    '⚠️ <b>INVALID DATE FORMAT</b>\n\n' +
                    '📅 Please enter the date in <b>DD-MM-YYYY</b> format.\n' +
                    '<i>Example: 20-03-2026</i>', 
                    { parse_mode: 'HTML' }
                );
            }


            if (d < todayStart()) {
                return bot.sendMessage(chatId, 'Send Date cannot be in the past.');
            }

            data.sendDate = moment(d).format('DD-MM-YYYY');
            sess.step = 'arrival_date';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }

            return bot.sendMessage(chatId, '📅 Enter Arrival Date (DD-MM-YYYY):', { parse_mode: 'HTML' });
        }

        case 'arrival_date': {
            const d = parseDate_ddmmyyyy(text);
            if (!d) {
                return bot.sendMessage(chatId, 
                    '⚠️ <b>INVALID DATE FORMAT</b>\n\n' +
                    '📅 Please enter the arrival date in <b>DD-MM-YYYY</b> format.\n' +
                    '<i>Example: 22-03-2026</i>', 
                    { parse_mode: 'HTML' }
                );
            }

            if (d < todayStart()) return bot.sendMessage(chatId, 'Arrival Date cannot be in the past.');
            if (data.sendDate) {
                const sd = moment(data.sendDate, 'DD-MM-YYYY').toDate();
                if (sd && d < sd) return bot.sendMessage(chatId, 'Arrival Date cannot be earlier than Send Date.');
            }
            data.arrivalDate = moment(d).format('DD-MM-YYYY');
            sess.step = 'selfie_id';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            sess.expectingPhoto = 'selfie_id';
            return bot.sendMessage(
                chatId,
                '🪪 Upload a selfie holding your ID (passport/license/tax card) - mandatory:',
                { parse_mode: 'HTML' }
            );
        }

        case 'optional_notes':
            if (!text || text.length < 1) {
                return bot.sendMessage(chatId, "📝 Please type your notes or 'None' to continue.");
            }

            data.notes = (text.toLowerCase() === 'none') ? '' : text;

            sess.requestId = makeRequestId('snd');
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowRequestId: sess.requestId,
                            flowStep: sess.step,
                            flowData: sess.data
                        }
                    }
                );
            }
            sess.step = 'confirm_pending';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data
                        }
                    }
                );
            }

            let html = `<b>🧾 Sender Summary</b>\n\n`;
            html += `<b>Request ID:</b> <code>${escapeHtml(sess.requestId)}</code>\n`;
            html += `<b>Name:</b> ${escapeHtml(data.name)}\n`;
            html += `<b>Phone:</b> ${escapeHtml(data.phone)}\n`;
            html += `<b>Email:</b> ${escapeHtml(data.email)}\n`;
            html += `<b>Pickup:</b> ${escapeHtml(data.pickup)}\n`;
            html += `<b>Destination:</b> ${escapeHtml(data.destination)}\n`;
            html += `<b>Weight:</b> ${escapeHtml(String(data.weight))} kg\n`;
            html += `<b>Category:</b> ${escapeHtml(data.category || "N/A")}\n`;
            html += `<b>Send:</b> ${escapeHtml(data.sendDate)}\n`;
            html += `<b>Arrival:</b> ${escapeHtml(data.arrivalDate)}\n`;
            if (data.notes) html += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            return bot.sendMessage(chatId, html, {
                parse_mode: 'HTML',
                ...confirmKeyboard('sender', sess.requestId)
            });
            return;
    }
}

// ------------------- Traveler text steps -------------------
async function handleTravelerTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;
    const data = sess.data;

    switch (sess.step) {
        case 'traveler_name':
            if (text.length < 2) return bot.sendMessage(chatId, 'Enter valid full name.');
            data.name = text;
            sess.step = 'traveler_phone';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(
                chatId,
                '📞 Enter your Phone Number (example: +911234567089):',
                { parse_mode: 'HTML' }
            );

        case 'traveler_phone':
            if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone format. Use +911234567890');
            data.phone = text.trim();
            sess.step = 'departure_airport';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(
                chatId,
                '🛫 Enter Departure Airport (From):\n\n <i> Note:✈️ Please enter the airport clearly.\nExample: "Mumbai International" or "BOM".\nAvoid spelling mistakes or nicknames to ensure accurate matching.</i>',
                { parse_mode: 'HTML' }
            );

        case 'departure_airport':
            data.departure = text;
            sess.step = 'departure_country';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '🌍 Enter Departure Country (used to determine visa rules):', { parse_mode: 'HTML' });

        case 'departure_country':
            data.departureCountry = text;
            sess.step = 'destination_airport';
            return bot.sendMessage(
                chatId,
                '🛬 Enter Destination Airport (To):\n\n <i> Note:✈️ Please enter the airport clearly.\nExample: "Dubai International Airport" or "DXB".\nAvoid spelling mistakes or nicknames to ensure accurate matching.</i>.',
                { parse_mode: 'HTML' }
            );

        case 'destination_airport':
            data.destination = text;
            sess.step = 'arrival_country';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '🌍 Enter Arrival Country:', { parse_mode: 'HTML' });

        case 'arrival_country':
            data.arrivalCountry = text;
            sess.step = 'departure_time';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '⏰ Enter Departure Date & Time (DD-MM-YYYY HH:mm):', { parse_mode: 'HTML' });

        case 'departure_time': {
            const dt = parseDate_ddmmyyyy_hhmm(text);
            if (!dt) return bot.sendMessage(chatId, '❌ Invalid format. Use DD-MM-YYYY HH:mm');
            data.departureTime = moment(dt).format('DD-MM-YYYY HH:mm');
            sess.step = 'arrival_time';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '⏰ Enter Arrival Date & Time (DD-MM-YYYY HH:mm):', { parse_mode: 'HTML' });
        }

        case 'arrival_time': {
            const dt = parseDate_ddmmyyyy_hhmm(text);
            if (!dt) return bot.sendMessage(chatId, '❌ Invalid format. Use DD-MM-YYYY HH:mm');
            data.arrivalTime = moment(dt).format('DD-MM-YYYY HH:mm');
            sess.step = 'available_weight';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data,
                            flowExpectingPhoto: sess.expectingPhoto || null
                        }
                    }
                );
            }
            return bot.sendMessage(chatId, '⚖️ Enter Available Weight (kg) (Max 10):', { parse_mode: 'HTML' });
        }

        case 'available_weight': {
            const m = text.match(/(\d+(\.\d+)?)/);
            if (!m) return bot.sendMessage(chatId, 'Invalid weight. Enter number in kg.');
            const w = parseFloat(m[1]);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, 'Enter positive weight.');
            if (w > 10) {
                return bot.sendMessage(
                    chatId,
                    '❌ Weight must be less than or equal to 10kg.\nPlease enter a valid weight:',
                    { parse_mode: 'HTML' }
                );
            }
            data.availableWeight = w;
            sess.step = 'passport_number';
            return bot.sendMessage(chatId, '🛂 Enter your Passport Number (example: L7982227):', { parse_mode: 'HTML' });
        }

        case 'passport_number':
            if (!/^[A-Za-z0-9]{7,9}$/.test(text)) {
                return bot.sendMessage(chatId, 'Invalid passport format. Example: L7982227');
            }
            data.passportNumber = text.trim();
            sess.expectingPhoto = 'passport_selfie';
            sess.step = 'passport_selfie';
            return bot.sendMessage(chatId, '📸 Upload a selfie holding your passport (mandatory):', { parse_mode: 'HTML' });

        case 'optional_notes': {

            // First time entering this step → just wait for user input


            // Now validate the actual user reply
            if (!text || text.length < 1) {
                return bot.sendMessage(chatId, "📝 Please type your notes or 'None' to continue.");
            }

            data.notes = (text.toLowerCase() === 'none') ? '' : text;

            sess.requestId = makeRequestId('trv');
            sess.step = 'confirm_pending';
            if (String(chatId).startsWith("web_")) {
                await usersCol.updateOne(
                    { _id: new ObjectId(sess.webUserId) },
                    {
                        $set: {
                            flowStep: sess.step,
                            flowData: sess.data
                        }
                    }
                );
            }
            let html = `<b>🧾 Traveler Summary</b>\n\n`;
            html += `<b>Request ID:</b> <code>${escapeHtml(sess.requestId)}</code>\n`;
            html += `<b>Name:</b> ${escapeHtml(data.name)}\n`;
            html += `<b>Phone:</b> ${escapeHtml(data.phone)}\n`;
            html += `<b>From:</b> ${escapeHtml(data.departure)} (${escapeHtml(data.departureCountry)})\n`;
            html += `<b>To:</b> ${escapeHtml(data.destination)} (${escapeHtml(data.arrivalCountry)})\n`;
            html += `<b>Departure:</b> ${escapeHtml(data.departureTime)}\n`;
            html += `<b>Arrival:</b> ${escapeHtml(data.arrivalTime)}\n`;
            html += `<b>Available Weight:</b> ${escapeHtml(String(data.availableWeight))} kg\n`;
            html += `<b>Passport:</b> ${escapeHtml(data.passportNumber)}\n`;
            if (data.notes) html += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

            await bot.sendMessage(chatId, html, {
                parse_mode: 'HTML',
                ...confirmKeyboard('traveler', sess.requestId)
            });

            return;
        }
    }

}

// ------------------- Final Sender submit -------------------
async function handleFinalSenderSubmit(chatId, session) {
    try {
        const requestId = session.requestId || makeRequestId('snd');
        session.requestId = requestId;

        const isWebUser = String(chatId).startsWith("web_");

        const doc = {
            requestId,
            userId: session.webUserId
                ? new ObjectId(session.webUserId)
                : null,
            telegramId: String(chatId).startsWith("web_") ? null : chatId,
            role: 'sender',
            data: session.data,
            status: 'Pending',
            adminNote: '',
            createdAt: new Date(),
            matchLocked: false,
            pendingMatchWith: null,
            matchedWith: null
        };

        await sendersCol.insertOne(doc);
        await backupSenderToJSON(doc);

        // ✅ Only send confirmation to Telegram users
        if (!isWebUser) {
            await bot.sendMessage(
                chatId,
                `✅ Your package has been submitted for admin approval.\nRequest ID: <code>${escapeHtml(requestId)}</code>\nPlease wait for admin action.`,
                { parse_mode: 'HTML' }
            );
        }

        // ---------------- ADMIN NOTIFICATION ----------------

        let summary = `<b>📦 New Sender Request</b>\n<b>Request ID:</b> <code>${escapeHtml(requestId)}</code>\n`;
        summary += `<b>Name:</b> ${escapeHtml(session.data.name)}\n`;
        summary += `<b>Phone:</b> ${escapeHtml(session.data.phone)}\n`;
        summary += `<b>Pickup:</b> ${escapeHtml(session.data.pickup)}\n`;
        summary += `<b>Destination:</b> ${escapeHtml(session.data.destination)}\n`;
        summary += `<b>Weight:</b> ${escapeHtml(String(session.data.weight))} kg\n`;
        summary += `<b>Category:</b> ${escapeHtml(session.data.category || "N/A")}\n`;
        summary += `<b>Send:</b> ${escapeHtml(session.data.sendDate)}\n`;
        summary += `<b>Arrival:</b> ${escapeHtml(session.data.arrivalDate)}\n`;
        if (session.data.notes) summary += `<b>Notes:</b> ${escapeHtml(session.data.notes)}\n`;

        await bot.sendMessage(String(ADMIN_GROUP_ID), summary, { parse_mode: 'HTML' });

        if (session.data.packagePhoto) {
            await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.packagePhoto, {
                caption: `📦 Package Photo - ${escapeHtml(requestId)}`
            });
        }

        if (session.data.selfieId) {
            await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.selfieId, {
                caption: `🪪 Selfie with ID - ${escapeHtml(requestId)}`
            });
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `Admin actions for <code>${escapeHtml(requestId)}</code>:`,
            { parse_mode: 'HTML', ...adminActionKeyboardForDoc(doc) }
        );

        userSessions[chatId] = null;
        if (isWebUser) {
            await usersCol.updateOne(
                { _id: new ObjectId(session.webUserId) },
                {
                    $set: {
                        flowStep: "waiting_admin_approval",
                        flowActive: false
                    }
                }
            );
        }

    } catch (err) {
        console.error('handleFinalSenderSubmit err', err);

        // ✅ Only notify Telegram users
        if (!String(chatId).startsWith("web_")) {
            await bot.sendMessage(chatId, '❌ Internal error submitting request. Please try again later.');
        }
    }
}
// ------------------- Final Traveler submit -------------------
async function handleFinalTravelerSubmit(chatId, session) {
    try {
        const requestId = session.requestId || makeRequestId('trv');
        session.requestId = requestId;

        const isWebUser = String(chatId).startsWith("web_");

        const doc = {
            requestId,
            userId: session.webUserId
                ? new ObjectId(session.webUserId)
                : null,
            telegramId: String(chatId).startsWith("web_") ? null : chatId,
            role: 'traveler',
            data: session.data,
            status: 'Pending',
            adminNote: '',
            createdAt: new Date(),
            matchLocked: false,
            pendingMatchWith: null,
            matchedWith: null
        };

        await travelersCol.insertOne(doc);
        await backupTravelerToJSON(doc);

        // ✅ Only Telegram users get confirmation
        if (!isWebUser) {
            await bot.sendMessage(
                chatId,
                `✅ Your travel has been listed for admin approval.\nRequest ID: <code>${escapeHtml(requestId)}</code>\nWe will try to match packages on your route.`,
                { parse_mode: 'HTML' }
            );
        }

        // ---------------- ADMIN NOTIFICATION ----------------

        let summary = `<b>🧳 New Traveler Request</b>\n<b>Request ID:</b> <code>${escapeHtml(requestId)}</code>\n`;
        summary += `<b>Name:</b> ${escapeHtml(session.data.name)}\n`;
        summary += `<b>Phone:</b> ${escapeHtml(session.data.phone)}\n`;
        summary += `<b>From:</b> ${escapeHtml(session.data.departure)} (${escapeHtml(session.data.departureCountry)})\n`;
        summary += `<b>To:</b> ${escapeHtml(session.data.destination)} (${escapeHtml(session.data.arrivalCountry)})\n`;
        summary += `<b>Departure:</b> ${escapeHtml(session.data.departureTime)}\n`;
        summary += `<b>Arrival:</b> ${escapeHtml(session.data.arrivalTime)}\n`;
        summary += `<b>Weight:</b> ${escapeHtml(String(session.data.availableWeight))} kg\n`;
        summary += `<b>Passport:</b> ${escapeHtml(session.data.passportNumber)}\n`;
        if (session.data.notes) summary += `<b>Notes:</b> ${escapeHtml(session.data.notes)}\n`;

        await bot.sendMessage(String(ADMIN_GROUP_ID), summary, { parse_mode: 'HTML' });

        if (session.data.passportSelfie) {
            await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.passportSelfie, {
                caption: `🪪 Passport Selfie - ${escapeHtml(requestId)}`
            });
        }

        if (session.data.itineraryPhoto) {
            await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.itineraryPhoto, {
                caption: `📄 Itinerary - ${escapeHtml(requestId)}`
            });
        }

        if (session.data.visaPhoto) {
            await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.visaPhoto, {
                caption: `🛂 Visa - ${escapeHtml(requestId)}`
            });
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `Admin actions for <code>${escapeHtml(requestId)}</code>:`,
            { parse_mode: 'HTML', ...adminActionKeyboardForDoc(doc) }
        );

        userSessions[chatId] = null;

        if (String(chatId).startsWith("web_")) {
            await usersCol.updateOne(
                { _id: new ObjectId(session.webUserId) },
                {
                    $set: {
                        flowStep: "waiting_admin_approval",
                        flowActive: false
                    }
                }
            );
        }

    } catch (err) {
        console.error('handleFinalTravelerSubmit err', err);

        if (!String(chatId).startsWith("web_")) {
            await bot.sendMessage(chatId, '❌ Internal error submitting travel. Please try again later.');
        }
    }
}
// ------------------- Admin: Approve -------------------
async function processApprove(requestId, invokedBy, query) {
    try {
        let found = await sendersCol.findOne({ requestId }) || await travelersCol.findOne({ requestId });
        if (!found) {
            await bot.sendMessage(String(ADMIN_GROUP_ID), `⚠️ Request ${escapeHtml(requestId)} not found.`);
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Request not found.' });
            return;
        }
        if (found.status === 'Approved') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Already approved.' });
            return;
        }
        if (found.status === 'Rejected') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Request was already rejected.' });
            return;
        }

        const col = found.role === 'sender' ? sendersCol : travelersCol;
        await col.updateOne(
            { requestId },
            { $set: { status: 'Approved', adminNote: `Approved by admin ${invokedBy}`, updatedAt: new Date() } }
        );

        const matchLine = found.role === 'sender'
            ? 'Please wait for matching traveler.'
            : 'Please wait for matching sender.';

        try {

            const isWebUser = !found.telegramId;

            if (isWebUser) {
                const uid = found.userId.toString();
                const approvalMsg = `✅ Your request <b>${escapeHtml(requestId)}</b> has been <b>APPROVED</b> by admin.\n${matchLine}`;
                webNotifications[uid] = webNotifications[uid] || [];
                webNotifications[uid].push({ text: approvalMsg, parse_mode: 'HTML' });
                await usersCol.updateOne({ _id: found.userId }, { $set: { unreadService: true } });

            } else {

                try {
                    await bot.sendMessage(
                        found.telegramId,
                        `✅ Your request <code>${requestId}</code> has been APPROVED by admin.
            Please wait for matching traveler.`,
                        { parse_mode: 'HTML' }
                    );
                } catch (e) {
                    console.warn('Could not notify Telegram user', found.telegramId);
                }



            }

        } catch (e) {
            console.warn('Could not notify user', found.userId, e.message);
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `✅ Approved ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>`,
            { parse_mode: 'HTML' }
        );

        await triggerMatchingForRequest(found.role, requestId);
    } catch (err) {
        console.error('processApprove err', err);
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Error during approval.' });
    }
}

// ------------------- Admin: Reject -------------------
async function processReject(requestId, reasonText, invokedBy, query) {
    try {
        let found = await sendersCol.findOne({ requestId }) || await travelersCol.findOne({ requestId });
        if (!found) {
            await bot.sendMessage(String(ADMIN_GROUP_ID), `⚠️ Request ${escapeHtml(requestId)} not found.`);
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Request not found.' });
            return;
        }
        if (found.status === 'Rejected') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Already rejected.' });
            return;
        }
        if (found.status === 'Approved') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Already approved; cannot reject.' });
            return;
        }

        const col = found.role === 'sender' ? sendersCol : travelersCol;
        await col.updateOne(
            { requestId },
            {
                $set: {
                    status: 'Rejected',
                    adminNote: reasonText,
                    updatedAt: new Date()
                },
                $unset: {
                    pendingMatchWith: '',
                    matchedWith: '',
                    matchLocked: ''
                }
            }
        );

        // 🛡️ Close any open support tickets for this rejected request
        await supportTicketsCol.updateMany({ requestId }, { $set: { status: 'closed', closedAt: new Date(), closedBy: 'admin_rejection' } });

        const isWebUser = !found.telegramId;

        if (isWebUser) {
            const uid = found.userId.toString();
            const rejectionMsg = `❌ Your request <b>${escapeHtml(requestId)}</b> was <b>REJECTED</b> by admin.\nReason: ${escapeHtml(reasonText)}`;
            webNotifications[uid] = webNotifications[uid] || [];
            webNotifications[uid].push({ text: rejectionMsg, parse_mode: 'HTML' });
            await usersCol.updateOne({ _id: found.userId }, { $set: { unreadService: true } });

        } else {

            await bot.sendMessage(
                found.telegramId,
                `❌ Your request <code>${escapeHtml(requestId)}</code> was <b>REJECTED</b>.
        Reason: ${escapeHtml(reasonText)}`,
                { parse_mode: 'HTML' }
            );

            await bot.sendMessage(
                found.telegramId,
                '➡️ Back to Main Menu:',
                { parse_mode: 'HTML', ...mainMenuInline }
            );
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `❌ Rejected ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>\nReason: ${escapeHtml(reasonText)}`,
            { parse_mode: 'HTML' }
        );
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Rejection sent.' });
    } catch (err) {
        console.error('processReject err', err);
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Error during rejection.' });
    }
}

// ------------------- Admin: Request Visa -------------------
async function processRequestVisa(requestId, invokedBy, query) {
    try {
        const found = await travelersCol.findOne({ requestId });
        if (!found) {
            await bot.sendMessage(String(ADMIN_GROUP_ID), `⚠️ Traveler ${escapeHtml(requestId)} not found or not a traveler request.`);
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Traveler request not found.' });
            return;
        }
        if (found.status === 'VisaRequested') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Visa already requested.' });
            return;
        }
        if (found.status === 'Approved') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Already approved.' });
            return;
        }
        if (found.status === 'Rejected') {
            if (query) await bot.answerCallbackQuery(query.id, { text: 'Already rejected.' });
            return;
        }

        await travelersCol.updateOne(
            { requestId },
            {
                $set: {
                    status: 'VisaRequested',
                    adminNote: `Visa requested by admin ${invokedBy}`,
                    updatedAt: new Date()
                }
            }
        );

        try {
            const isWebUser = !found.telegramId;

            if (isWebUser) {
                const uid = found.userId.toString();
                const visaMsg = `🛂 Admin has requested your <b>Visa</b> for request <b>${escapeHtml(requestId)}</b>.\nPlease upload a clear photo of your visa in the chat. If you don't have one, type: <i>None</i>`;
                webNotifications[uid] = webNotifications[uid] || [];
                webNotifications[uid].push({ text: visaMsg, parse_mode: 'HTML' });
                await usersCol.updateOne({ _id: found.userId }, { $set: { unreadService: true } });

            } else {

                await bot.sendMessage(
                    found.telegramId,
                    `🛂 Admin has requested your Visa for request <code>${escapeHtml(requestId)}</code>.
            Please upload a clear photo of your visa now (send as photo). If you do not have a visa, type None.`,
                    { parse_mode: 'HTML' }
                );

            }
        } catch (e) {
            console.warn('Could not notify traveler', found.userId);
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `🛂 Visa requested from traveler ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>`,
            { parse_mode: 'HTML' }
        );
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Visa requested.' });
    } catch (err) {
        console.error('processRequestVisa err', err);
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Error during visa request.' });
    }
}

// ------------------- graceful shutdown -------------------
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    try { if (mongoClient) await mongoClient.close(); } catch (e) { }
    process.exit(0);
});

// ------------------- startup log -------------------
console.log('✅ AirDlivers bot (webhook + auto-recovery) is running...');