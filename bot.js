// bot.js - AirDlivers production bot (webhook + auto-recovery)
// package.json must have: { "type": "module" }
import fetch from 'node-fetch';
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import { MongoClient } from 'mongodb';
import moment from 'moment';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

// ------------------- __dirname for ES modules -------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ------------------- ENV -------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || ''; // optional
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;       // required
const ADMIN_PIN = process.env.ADMIN_PIN;                 // required
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'airdlivers';


if (!BOT_TOKEN) { console.error('FATAL: BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error('FATAL: ADMIN_GROUP_ID missing'); process.exit(1); }
if (!ADMIN_PIN) { console.error('FATAL: ADMIN_PIN missing'); process.exit(1); }
if (!MONGO_URI) { console.error('FATAL: MONGO_URI missing'); process.exit(1); }
const SUPPORT_TEXT =
    `\n\n📞 <b>Contact Support</b>\n` +
    `🔗 <a href="https://t.me/+CAntejDg9plmNWI0">AirDlivers Support Group</a>\n` +
    `📧 Email: <b>Hrmailsinfo@gmail.com</b>`;
if (!FB_PAGE_TOKEN) { console.error('FATAL: FB_PAGE_TOKEN missing'); process.exit(1); }
if (!FB_VERIFY_TOKEN) { console.error('FATAL: FB_VERIFY_TOKEN missing'); process.exit(1); }

// ------------------- JSON backup files -------------------
const SENDERS_JSON = join(__dirname, 'senders.json');
const TRAVELERS_JSON = join(__dirname, 'travelers.json');
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// ------------------- MongoDB -------------------
let mongoClient, db, sendersCol, travelersCol, trackingCol;
try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);
    sendersCol = db.collection('senders');
    travelersCol = db.collection('travelers');
    trackingCol = db.collection('trackingRequests');
    console.log('✅ MongoDB connected successfully');
} catch (e) {
    console.error('MongoDB connection error:', e);
    process.exit(1);
}

// ------------------- TELEGRAM BOT (webhook only) -------------------
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });


// ------------------- EXPRESS SERVER & WEBHOOK -------------------
const app = express();
app.use(express.json({ limit: '20mb' }));
// ------------------- FACEBOOK MESSENGER WEBHOOK -------------------

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

// Verify webhook
app.get('/messenger', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Receive messages
app.post('/messenger', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const event = entry?.messaging?.[0];
    if (!event || !event.message) return res.sendStatus(200);

    const fakeTelegramMsg = {
      chat: { id: event.sender.id },
      from: { id: event.sender.id },
      text: event.message.text || ''
    };

    // Send into your existing bot logic
    await bot.emit('message', fakeTelegramMsg);

    res.sendStatus(200);
  } catch (err) {
    console.error('Messenger error:', err);
    res.sendStatus(500);
  }
});
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.PUBLIC_URL || null;
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = BASE_URL ? `${BASE_URL}${WEBHOOK_PATH}` : null;

// health check
app.get('/', (req, res) => {
  res.send('🌍 AirDlivers Telegram bot is running (webhook mode).');
});
// test route for Facebook webhook
app.get('/test', (req, res) => {
  res.send('Facebook webhook is reachable');
});

// webhook endpoint
app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// start server + set webhook

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Facebook webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Facebook webhook failed verification');
    res.sendStatus(403);
  }
};
app.listen(PORT, async () => {
  console.log(`🌍 HTTP server listening on port ${PORT}`);

  if (!WEBHOOK_URL) {
    console.error('❌ BASE_URL not detected. Webhook not set.');
    return;
  }

  try {
    await bot.setWebHook(WEBHOOK_URL, { drop_pending_updates: true });
    console.log('✅ Webhook set successfully:', WEBHOOK_URL);
  } catch (err) {
    console.error('❌ Failed to set webhook:', err.message);
  }
});// ------------------- Utilities -------------------
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
    return String(msg.chat.id) === String(ADMIN_GROUP_ID);
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
const userSessions = {}; // chatId -> session
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
const categoryKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '📄 Documents', callback_data: 'cat_Documents' },
                { text: '🥇 Gold (with bill)', callback_data: 'cat_Gold' }
            ],
            [
                { text: '💊 Medicines (prescription)', callback_data: 'cat_Medicines' },
                { text: '👕 Clothes', callback_data: 'cat_Clothes' }
            ],
            [
                { text: '🍱 Food (sealed)', callback_data: 'cat_Food' },
                { text: '💻 Electronics (with bill)', callback_data: 'cat_Electronics' }
            ],
            [
                { text: '🎁 Gifts', callback_data: 'cat_Gifts' },
                { text: '⚠️ Prohibited items', callback_data: 'cat_Prohibited' }
            ]
        ]
    }
};

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

function isSenderTravelerCompatible(senderSnap, travelerSnap) {
    if (!senderSnap || !travelerSnap) return false;
    if (!senderSnap.pickup || !senderSnap.destination || !senderSnap.sendDate) return false;
    if (!travelerSnap.departure || !travelerSnap.destination || !travelerSnap.departureTime) return false;

    if (!airportsMatch(senderSnap.pickup, travelerSnap.departure)) return false;
    if (!airportsMatch(senderSnap.destination, travelerSnap.destination)) return false;
    if (!isWeightCompatible(senderSnap.weight, travelerSnap.availableWeight)) return false;
    if (!areDatesClose(senderSnap.sendDate, travelerSnap.departureTime)) return false;
    if (senderSnap.matchLocked || travelerSnap.matchLocked) return false;
    return true;
}

// ------------------- Match cards -------------------
async function sendMatchCardToSender(senderDoc, travelerDoc) {
    const s = buildSenderSnapshot(senderDoc);
    const t = buildTravelerSnapshot(travelerDoc);
    if (!isSenderTravelerCompatible(s, t)) return;

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

    if (senderDoc.data?.packagePhoto) {
        await bot.sendPhoto(senderDoc.userId, senderDoc.data.packagePhoto, {
            caption: text,
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup
        });
    } else {
        await bot.sendMessage(senderDoc.userId, text, keyboard);
    }
}

async function sendMatchCardToTraveler(travelerDoc, senderDoc) {
    const s = buildSenderSnapshot(senderDoc);
    const t = buildTravelerSnapshot(travelerDoc);
    if (!isSenderTravelerCompatible(s, t)) return;

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

    if (senderDoc.data?.packagePhoto) {
        await bot.sendPhoto(travelerDoc.userId, senderDoc.data.packagePhoto, {
            caption: text,
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup
        });
    } else {
        await bot.sendMessage(travelerDoc.userId, text, keyboard);
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
        const myCol = myRole === 'sender' ? sendersCol : travelersCol;
        const otherCol = myRole === 'sender' ? travelersCol : sendersCol;

        const myDoc = await myCol.findOne({ requestId: myReqId });
        const otherDoc = await otherCol.findOne({ requestId: otherReqId });

        if (!myDoc || !otherDoc) {
            await bot.answerCallbackQuery(query.id, { text: 'Match not found anymore.' });
            return;
        }

        if (String(myDoc.userId) !== String(telegramUserId)) {
            await bot.answerCallbackQuery(query.id, { text: 'This match card is not for you.' });
            return;
        }

        if (myDoc.status !== 'Approved' || otherDoc.status !== 'Approved') {
            await bot.answerCallbackQuery(query.id, { text: 'One of the requests is not approved anymore.' });
            return;
        }

        if (myDoc.matchLocked || otherDoc.matchLocked) {
            await bot.answerCallbackQuery(query.id, { text: 'Already matched with someone else.' });
            return;
        }

        if (myDoc.pendingMatchWith && myDoc.pendingMatchWith !== otherReqId) {
            await bot.answerCallbackQuery(query.id, { text: 'You already confirmed another match.' });
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

            const myLabel = myRole === 'sender' ? 'Sender' : 'Traveler';
            const otherLabel = myRole === 'sender' ? 'Traveler' : 'Sender';

            try {

                await bot.sendMessage(
                    myDoc.userId,
                    `🤝 <b>Match Confirmed!</b>\n\n` +
                    `You are now matched with your partner.\n\n` +
                    `💬 You can now chat here.\n\n` +
                    `<i>⚠️ Note: Do NOT share personal details (phone, email, address, passport, payments).\n` +
                    `Any suspicious activity may lead to suspension or permanent termination.</i>\n\n` +
                    `<i>📦 After delivery is completed, please type <b>/delivered</b> to close the chat.</i>`,
                    { parse_mode: 'HTML' }
                );

                await bot.sendMessage(
                    otherDoc.userId,
                    `🤝 <b>Match Confirmed!</b>\n\n` +
                    `You are now matched with your partner.\n\n` +
                    `💬 You can now chat here.\n\n` +
                    `<i>⚠️ Note: Do NOT share personal details (phone, email, address, passport, payments).\n` +
                    `Any suspicious activity may lead to suspension or permanent termination.</i>\n\n` +
                    `<i>📦 After delivery is completed, please type <b>/delivered</b> to close the chat.</i>`,
                    { parse_mode: 'HTML' }
                );
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

            await bot.answerCallbackQuery(query.id, { text: 'Match confirmed ✅' });
            return;
        } else {
            // first side confirming
            await myCol.updateOne(
                { requestId: myReqId },
                { $set: { pendingMatchWith: otherReqId } }
            );

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
async function findActiveMatchForUser(userId) {
    const senderDoc = await sendersCol.findOne(
        { userId, matchLocked: true, matchedWith: { $exists: true } },
        { sort: { matchFinalizedAt: -1, updatedAt: -1, createdAt: -1 } }
    );
    const travelerDoc = await travelersCol.findOne(
        { userId, matchLocked: true, matchedWith: { $exists: true } },
        { sort: { matchFinalizedAt: -1, updatedAt: -1, createdAt: -1 } }
    );

    if (!senderDoc && !travelerDoc) return null;
    if (senderDoc && !travelerDoc) return senderDoc;
    if (!senderDoc && travelerDoc) return travelerDoc;

    const sTime = senderDoc.matchFinalizedAt || senderDoc.updatedAt || senderDoc.createdAt || new Date(0);
    const tTime = travelerDoc.matchFinalizedAt || travelerDoc.updatedAt || travelerDoc.createdAt || new Date(0);
    return sTime >= tTime ? senderDoc : travelerDoc;
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

        await bot.sendMessage(
            otherDoc.userId,
            `💬 Message from your match:\n${escapeHtml(text)}`,
            { parse_mode: 'HTML' }
        );

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
bot.onText(/^\/(suspend|unsuspend|terminate)\s+(\d+)\s*(.*)?$/i, async (msg, match) => {
    try {
        if (!isAdminMessage(msg)) return;

        const fromId = msg.from.id;
        const isSuper = String(fromId) === String(SUPER_ADMIN_ID);
        const isAdmin = adminAuth[fromId]?.loggedIn;

        if (!isSuper && !isAdmin) {
            return bot.sendMessage(msg.chat.id, '🔒 Admin access required.');
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
//-------------------- Delivered--------------------///
bot.onText(/^\/delivered$/i, async (msg) => {
  try {
    const chatId = msg.chat.id;

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
        'You don’t have any current shipment in process.',
        { parse_mode: 'HTML' }
      );
    }

    // ✅ Mark completed
    const col = myDoc.role === 'sender' ? sendersCol : travelersCol;

    await col.updateOne(
      { requestId: myDoc.requestId },
      { $set: { deliveryCompleted: true, deliveryCompletedAt: new Date() } }
    );

    const otherCol = myDoc.role === 'sender' ? travelersCol : sendersCol;
    const otherDoc = await otherCol.findOne({ requestId: myDoc.matchedWith });

    if (otherDoc) {
      await otherCol.updateOne(
        { requestId: otherDoc.requestId },
        { $set: { deliveryCompleted: true, deliveryCompletedAt: new Date() } }
      );
    }

    // Notify users
    await bot.sendMessage(chatId,
      '📦 <b>Delivery marked as completed.</b>\nThank you for using AirDlivers!',
      { parse_mode: 'HTML', ...mainMenuInline }
    );

    if (otherDoc) {
      await bot.sendMessage(otherDoc.userId,
        '📦 <b>Delivery marked as completed.</b>\nThank you for using AirDlivers!',
        { parse_mode: 'HTML', ...mainMenuInline }
      );
    }

    // 🔔 Notify admin
    await bot.sendMessage(String(ADMIN_GROUP_ID),
      `📦 <b>Delivery Completed</b>\nSender/Traveler ID: <code>${myDoc.requestId}</code>`,
      { parse_mode: 'HTML' }
    );

  } catch (err) {
    console.error('/delivered error', err);
    bot.sendMessage(msg.chat.id, '❌ Error marking delivery as completed.');
  }
});
bot.onText(/\/start/, async (msg) => {
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
        `Support Email: Hrmailsinfo@gmail.com\n\n` +
        `Privacy: We collect data required to facilitate deliveries (name, contact, IDs when needed). We do not sell data.`;
    bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
});
// ------------------- Admin: WHOIS command -------------------
bot.onText(/^\/whois\s+(snd\d+|trv\d+)$/i, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const fromId = msg.from.id;

        // Only admin group allowed
        if (String(chatId) !== String(ADMIN_GROUP_ID)) return;

        const isSuper = String(fromId) === String(SUPER_ADMIN_ID);
        const isAdmin = adminAuth[fromId]?.loggedIn;

        if (!isSuper && !isAdmin) {
            return bot.sendMessage(chatId, '🔒 Admin access required.');
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
        if (data === 'flow_tracking') {
            userSessions[chatId] = { type: 'tracking', step: 'tracking_phone', data: {} };
            return bot.sendMessage(
                chatId,
                '📍 Enter the phone number used for shipment (format: +911234567890):',
                { parse_mode: 'HTML' }
            );
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
        if (data === 'delivery_completed') {
            const myDoc = await findActiveMatchForUser(chatId);
            if (!myDoc) {
                return bot.answerCallbackQuery(query.id, { text: 'No active delivery found.' });
            }

            const otherCol = myDoc.role === 'sender' ? travelersCol : sendersCol;
            const otherDoc = await otherCol.findOne({ requestId: myDoc.matchedWith });

            // Close both sides
            await sendersCol.updateMany(
                { $or: [{ requestId: myDoc.requestId }, { requestId: myDoc.matchedWith }] },
                { $set: { deliveryCompleted: true }, $unset: { matchedWith: '', pendingMatchWith: '' } }
            );

            await travelersCol.updateMany(
                { $or: [{ requestId: myDoc.requestId }, { requestId: myDoc.matchedWith }] },
                { $set: { deliveryCompleted: true }, $unset: { matchedWith: '', pendingMatchWith: '' } }
            );

            // Notify users
            await bot.sendMessage(
                chatId,
                `✅ <b>Delivery marked as completed.</b>\n\nThank you for using AirDlivers.`,
                { parse_mode: 'HTML', ...mainMenuInline }
            );

            if (otherDoc) {
                await bot.sendMessage(
                    otherDoc.userId,
                    `✅ <b>Delivery completed.</b>\n\nThank you for using AirDlivers.`,
                    { parse_mode: 'HTML', ...mainMenuInline }
                );
            }

            // Notify admin
            await bot.sendMessage(
                String(ADMIN_GROUP_ID),
                `📦 <b>Delivery Completed</b>\nSender/Traveler ID: <code>${escapeHtml(myDoc.requestId)}</code>`,
                { parse_mode: 'HTML' }
            );

            return bot.answerCallbackQuery(query.id, { text: 'Delivery closed.' });
        }

        // categories
        if (data && data.startsWith('cat_')) {
            const session = userSessions[chatId];
            if (!session || session.type !== 'sender' || session.step !== 'package_category') {
                return bot.answerCallbackQuery(query.id, { text: 'Category not expected now. Please follow the flow.' });
            }
            const category = data.replace('cat_', '');
            if (category === 'Prohibited') {
                await bot.sendMessage(chatId, '⚠️ Prohibited items are not allowed. See Help / Support for details.');
                return bot.sendMessage(chatId, 'Choose a valid category:', categoryKeyboard);
            }
            session.data.category = category;
            session.step = 'package_photo';
            session.expectingPhoto = 'package_photo';
            await bot.sendMessage(chatId, '📷 Upload a photo of the package (mandatory):', { parse_mode: 'HTML' });
            return bot.answerCallbackQuery(query.id);
        }

        // confirmations
        if (data && data.startsWith('confirm_')) {
            const parts = data.split('_');
            if (parts.length < 4) return bot.answerCallbackQuery(query.id, { text: 'Invalid token' });
            const decision = parts[1];
            const role = parts[2];
            const requestId = parts.slice(3).join('_');
            const sessChatId = chatId;
            const session = userSessions[sessChatId];
            if (!session || session.requestId !== requestId) {
                await bot.answerCallbackQuery(query.id, { text: 'Session mismatch or expired.' });
                return;
            }
            if (decision === 'no') {
                userSessions[sessChatId] = null;
                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                }).catch(() => { });
                await bot.sendMessage(sessChatId, '❌ Submission cancelled. Use /start to begin again.');
                return;
            } else {
                if (role === 'sender') return handleFinalSenderSubmit(sessChatId, session);
                if (role === 'traveler') return handleFinalTravelerSubmit(sessChatId, session);
                return bot.answerCallbackQuery(query.id, { text: 'Unknown role.' });
            }
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
                await processApprove(reqId, invokedBy, query);
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
📞 <a href="https://t.me/+CAntejDg9plmNWI0">AirDlivers Support Group</a>  
📧 Hrmailsinfo@gmail.com  

<b>By using AirDlivers, you agree to these rules.</b>`;

    return bot.sendMessage(chatId, HELP_TEXT, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
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
    const session = userSessions[chatId];

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

    // /admin
    if (text === '/admin') {
      if (String(fromId) === String(SUPER_ADMIN_ID)) {
        adminAuth[fromId] = { loggedIn: true, super: true };
        return bot.sendMessage(chatId, '🧠 Super Admin access granted ✅');
      }

      if (String(chatId) === String(ADMIN_GROUP_ID)) {
        adminAuth[fromId] = { awaitingPin: true };
        return bot.sendMessage(chatId, '🔑 Admin login: reply with PIN.');
      }

      return bot.sendMessage(chatId, '🚫 Not authorized.');
    }

    // Admin PIN
    if (String(chatId) === String(ADMIN_GROUP_ID) && adminAuth[fromId]?.awaitingPin) {
      if (text === String(ADMIN_PIN)) {
        adminAuth[fromId] = { loggedIn: true };
        return bot.sendMessage(chatId, '✅ Admin login successful.');
      } else {
        adminAuth[fromId] = {};
        return bot.sendMessage(chatId, '❌ Invalid PIN.');
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
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const session = userSessions[chatId];

        // If in a session expecting a photo (sender/traveler flows)
        if (session) {
            if (session.type === 'sender') {
                if (session.expectingPhoto === 'package_photo') {
                    session.data.packagePhoto = fileId;
                    session.expectingPhoto = null;
                    session.step = 'send_date';
                    await bot.sendMessage(chatId, '📅 Enter Send Date (DD-MM-YYYY):', { parse_mode: 'HTML' });
                    return;
                }
                if (session.expectingPhoto === 'selfie_id') {
                    session.data.selfieId = fileId;
                    session.expectingPhoto = null;
                    session.step = 'optional_notes';
session.waitingForNotes = true;
await bot.sendMessage(chatId, "📝 Add optional notes or type 'None':", { parse_mode: 'HTML' });
                    return;
                }
            }

            if (session.type === 'traveler') {
                if (session.expectingPhoto === 'passport_selfie') {
                    session.data.passportSelfie = fileId;
                    session.expectingPhoto = 'itinerary_photo';
                    session.step = 'itinerary_photo';
                    await bot.sendMessage(chatId, '📄 Upload your Itinerary Photo (mandatory):', { parse_mode: 'HTML' });
                    return;
                }
                if (session.expectingPhoto === 'itinerary_photo') {
                    session.data.itineraryPhoto = fileId;
                    session.expectingPhoto = null;
                    session.step = 'optional_notes';
                    session.waitingForNotes = true;
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
            return bot.sendMessage(chatId, '📧 Enter your Email:', { parse_mode: 'HTML' });

        case 'sender_email':
            if (!isValidEmail(text)) {
                return bot.sendMessage(chatId, '❌ Invalid email. Please enter a valid email.');
            }
            data.email = text.trim();
            sess.step = 'pickup_airport';
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
            return bot.sendMessage(
                chatId,
                '🛬 Enter Destination Airport (To):\n\n<i>Note:✈️ Please enter the airport clearly.\nExample: "Heathrow Airport" or "LHR".\nAvoid spelling mistakes or nicknames to ensure accurate matching.</i>',
                { parse_mode: 'HTML' }
            );

        case 'destination_airport':
            data.destination = text;
            sess.step = 'package_weight';
            return bot.sendMessage(chatId, '⚖️ Enter Package Weight in kg (Max 10kg):', { parse_mode: 'HTML' });

        case 'package_weight': {
            const m = text.match(/(\d+(\.\d+)?)/);
            if (!m) return bot.sendMessage(chatId, 'Invalid weight format. Use numbers (e.g., 2.5).');
            const w = parseFloat(m[1]);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, 'Enter a positive weight.');
            if (w > 10) {
                userSessions[chatId] = null;
                return bot.sendMessage(chatId, '❌ Weight > 10kg. Not allowed. Use /start to try again.');
            }
            data.weight = w;
            sess.step = 'package_category';
            return bot.sendMessage(chatId, '📦 Choose package category (inline):', categoryKeyboard);
        }

       case 'send_date': {

  if (!text || text.trim().length === 0) {
    return; // do nothing, wait for user input
  }

  const d = parseDate_ddmmyyyy(text);

  if (!d) {
    return bot.sendMessage(chatId, '📅 Please enter Send Date in DD-MM-YYYY format.');
  }

  if (d < todayStart()) {
    return bot.sendMessage(chatId, 'Send Date cannot be in the past.');
  }

  data.sendDate = moment(d).format('DD-MM-YYYY');
  sess.step = 'arrival_date';

  return bot.sendMessage(chatId, '📅 Enter Arrival Date (DD-MM-YYYY):', { parse_mode: 'HTML' });
}

        case 'arrival_date': {
            const d = parseDate_ddmmyyyy(text);
            if (!d) return bot.sendMessage(chatId, '❌ Invalid Arrival Date format. Use DD-MM-YYYY.');
            if (d < todayStart()) return bot.sendMessage(chatId, 'Arrival Date cannot be in the past.');
            if (data.sendDate) {
                const sd = moment(data.sendDate, 'DD-MM-YYYY').toDate();
                if (sd && d < sd) return bot.sendMessage(chatId, 'Arrival Date cannot be earlier than Send Date.');
            }
            data.arrivalDate = moment(d).format('DD-MM-YYYY');
            sess.step = 'selfie_id';
            sess.expectingPhoto = 'selfie_id';
            return bot.sendMessage(
                chatId,
                '🪪 Upload a selfie holding your ID (passport/license/tax card) - mandatory:',
                { parse_mode: 'HTML' }
            );
        }

case 'optional_notes':

  if (sess.waitingForNotes) {
    sess.waitingForNotes = false;
    return; // wait for user reply
  }

  if (!text || text.length < 1) {
    return bot.sendMessage(chatId, "📝 Please type your notes or 'None' to continue.");
  }
 
  data.notes = (text.toLowerCase() === 'none') ? '' : text;
  sess.requestId = makeRequestId('snd');
  sess.step = 'confirm_pending';

  let html = `<b>🧾 Sender Summary</b>\n\n`;
  html += `<b>Request ID:</b> <code>${escapeHtml(sess.requestId)}</code>\n`;
  html += `<b>Name:</b> ${escapeHtml(data.name)}\n`;
  html += `<b>Phone:</b> ${escapeHtml(data.phone)}\n`;
  html += `<b>Email:</b> ${escapeHtml(data.email)}\n`;
  html += `<b>Pickup:</b> ${escapeHtml(data.pickup)}\n`;
  html += `<b>Destination:</b> ${escapeHtml(data.destination)}\n`;
  html += `<b>Weight:</b> ${escapeHtml(String(data.weight))} kg\n`;
  html += `<b>Category:</b> ${escapeHtml(data.category)}\n`;
  html += `<b>Send:</b> ${escapeHtml(data.sendDate)}\n`;
  html += `<b>Arrival:</b> ${escapeHtml(data.arrivalDate)}\n`;
  if (data.notes) html += `<b>Notes:</b> ${escapeHtml(data.notes)}\n`;

  await bot.sendMessage(chatId, html, {
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
            return bot.sendMessage(
                chatId,
                '📞 Enter your Phone Number (example: +911234567089):',
                { parse_mode: 'HTML' }
            );

        case 'traveler_phone':
            if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone format. Use +911234567890');
            data.phone = text.trim();
            sess.step = 'departure_airport';
            return bot.sendMessage(
                chatId,
                '🛫 Enter Departure Airport (From):\n\n <i> Note:✈️ Please enter the airport clearly.\nExample: "Mumbai International" or "BOM".\nAvoid spelling mistakes or nicknames to ensure accurate matching.</i>',
                { parse_mode: 'HTML' }
            );

        case 'departure_airport':
            data.departure = text;
            sess.step = 'departure_country';
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
            return bot.sendMessage(chatId, '🌍 Enter Arrival Country:', { parse_mode: 'HTML' });

        case 'arrival_country':
            data.arrivalCountry = text;
            sess.step = 'departure_time';
            return bot.sendMessage(chatId, '⏰ Enter Departure Date & Time (DD-MM-YYYY HH:mm):', { parse_mode: 'HTML' });

        case 'departure_time': {
            const dt = parseDate_ddmmyyyy_hhmm(text);
            if (!dt) return bot.sendMessage(chatId, '❌ Invalid format. Use DD-MM-YYYY HH:mm');
            data.departureTime = moment(dt).format('DD-MM-YYYY HH:mm');
            sess.step = 'arrival_time';
            return bot.sendMessage(chatId, '⏰ Enter Arrival Date & Time (DD-MM-YYYY HH:mm):', { parse_mode: 'HTML' });
        }

        case 'arrival_time': {
            const dt = parseDate_ddmmyyyy_hhmm(text);
            if (!dt) return bot.sendMessage(chatId, '❌ Invalid format. Use DD-MM-YYYY HH:mm');
            data.arrivalTime = moment(dt).format('DD-MM-YYYY HH:mm');
            sess.step = 'available_weight';
            return bot.sendMessage(chatId, '⚖️ Enter Available Weight (kg) (Max 10):', { parse_mode: 'HTML' });
        }

        case 'available_weight': {
            const m = text.match(/(\d+(\.\d+)?)/);
            if (!m) return bot.sendMessage(chatId, 'Invalid weight. Enter number in kg.');
            const w = parseFloat(m[1]);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, 'Enter positive weight.');
            if (w > 10) {
                userSessions[chatId] = null;
                return bot.sendMessage(chatId, '❌ Weight > 10kg. Not allowed. Use /start.');
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
  if (sess.waitingForNotes) {
    sess.waitingForNotes = false;
    return;
  }

  // Now validate the actual user reply
  if (!text || text.length < 1) {
    return bot.sendMessage(chatId, "📝 Please type your notes or 'None' to continue.");
  }

  data.notes = (text.toLowerCase() === 'none') ? '' : text;

  sess.requestId = makeRequestId('trv');
  sess.step = 'confirm_pending';

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
        const doc = {
            requestId,
            userId: chatId,
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

        await bot.sendMessage(
            chatId,
            `✅ Your package has been submitted for admin approval.\nRequest ID: <code>${escapeHtml(requestId)}</code>\nPlease wait for admin action.`,
            { parse_mode: 'HTML' }
        );

        let summary = `<b>📦 New Sender Request</b>\n<b>Request ID:</b> <code>${escapeHtml(requestId)}</code>\n`;
        summary += `<b>Name:</b> ${escapeHtml(session.data.name)}\n`;
        summary += `<b>Phone:</b> ${escapeHtml(session.data.phone)}\n`;
        summary += `<b>Pickup:</b> ${escapeHtml(session.data.pickup)}\n`;
        summary += `<b>Destination:</b> ${escapeHtml(session.data.destination)}\n`;
        summary += `<b>Weight:</b> ${escapeHtml(String(session.data.weight))} kg\n`;
        summary += `<b>Category:</b> ${escapeHtml(session.data.category)}\n`;
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
    } catch (err) {
        console.error('handleFinalSenderSubmit err', err);
        await bot.sendMessage(chatId, '❌ Internal error submitting request. Please try again later.');
    }
}

// ------------------- Final Traveler submit -------------------
async function handleFinalTravelerSubmit(chatId, session) {
    try {
        const requestId = session.requestId || makeRequestId('trv');
        session.requestId = requestId;
        const doc = {
            requestId,
            userId: chatId,
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

        await bot.sendMessage(
            chatId,
            `✅ Your travel has been listed for admin approval.\nRequest ID: <code>${escapeHtml(requestId)}</code>\nWe will try to match packages on your route.`,
            { parse_mode: 'HTML' }
        );

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
    } catch (err) {
        console.error('handleFinalTravelerSubmit err', err);
        await bot.sendMessage(chatId, '❌ Internal error submitting travel. Please try again later.');
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
            await bot.sendMessage(
                found.userId,
                `✅ Your request <code>${escapeHtml(requestId)}</code> has been <b>APPROVED</b> by admin.\n${matchLine}\n\nIf you need help, join support: <a href="https://t.me/+CAntejDg9plmNWI0">Support Group</a>`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );

        } catch (e) {
            console.warn('Could not notify user', found.userId, e.message);
        }

        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `✅ Approved ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>`,
            { parse_mode: 'HTML' }
        );

        if (query) await bot.answerCallbackQuery(query.id, { text: 'Approved.' });

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

        try {
            await bot.sendMessage(
                found.userId,
                `❌ Your request <code>${escapeHtml(requestId)}</code> was <b>REJECTED</b>.\nReason: ${escapeHtml(reasonText)}\nIf you think this is a mistake, join support: <a href="https://t.me/+CAntejDg9plmNWI0">Support Group</a>`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );
            await bot.sendMessage(found.userId, '➡️ Back to Main Menu:', { parse_mode: 'HTML', ...mainMenuInline });
        } catch (e) {
            console.warn('Could not notify user', found.userId);
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
            await bot.sendMessage(
                found.userId,
                `🛂 Admin has requested your Visa for request <code>${escapeHtml(requestId)}</code>.\nPlease upload a clear photo of your visa now (send as photo). If you do not have a visa, type None.`,
                { parse_mode: 'HTML' }
            );
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
