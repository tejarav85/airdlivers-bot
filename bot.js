// bot.js (ES module) - AirDlivers final production
// Ensure package.json has "type": "module"

import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import { MongoClient } from 'mongodb';
import moment from 'moment';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------- __dirname compatibility ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- ENV ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || ''; // optional
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID; // required
const ADMIN_PIN = process.env.ADMIN_PIN; // required for admin login in group
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'airdlivers';

// sanity checks
if (!BOT_TOKEN) { console.error('FATAL: BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error('FATAL: ADMIN_GROUP_ID missing'); process.exit(1); }
if (!ADMIN_PIN) { console.error('FATAL: ADMIN_PIN missing'); process.exit(1); }
if (!MONGO_URI) { console.error('FATAL: MONGO_URI missing'); process.exit(1); }

// ---------- files ----------
const SENDERS_JSON = join(__dirname, 'senders.json');
const TRAVELERS_JSON = join(__dirname, 'travelers.json');
await fs.ensureFile(SENDERS_JSON);
await fs.ensureFile(TRAVELERS_JSON);

// ---------- bot ----------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---------- utilities ----------
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
function parseDate_ddmmyy_hhmm(txt) {
    if (!txt) return null;
    const m = moment(txt, 'DD-MM-YY HH:mm', true);
    return m.isValid() ? m.toDate() : null;
}
function todayStart() { return moment().startOf('day').toDate(); }

// ---------- MongoDB ----------
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

// ---------- JSON backup helpers ----------
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

// ---------- in-memory session/admin state ----------
const userSessions = {}; // chatId -> session
/*
session example:
{
  type: 'sender'|'traveler'|'tracking',
  step: 'sender_name'|...,
  data: {},
  expectingPhoto: null|'package_photo'|'selfie_id'|...
  requestId: 'snd...'
}
*/
const adminAuth = {}; // userId -> { awaitingPin:bool, loggedIn:bool, super:bool, awaitingCustomReasonFor: reqId|null }

// ---------- keyboards ----------
const categoryKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📄 Documents', callback_data: 'cat_Documents' }, { text: '🥇 Gold (with bill)', callback_data: 'cat_Gold' }],
            [{ text: '💊 Medicines (prescription)', callback_data: 'cat_Medicines' }, { text: '👕 Clothes', callback_data: 'cat_Clothes' }],
            [{ text: '🍱 Food (sealed)', callback_data: 'cat_Food' }, { text: '💻 Electronics (with bill)', callback_data: 'cat_Electronics' }],
            [{ text: '🎁 Gifts', callback_data: 'cat_Gifts' }, { text: '⚠️ Prohibited items', callback_data: 'cat_Prohibited' }]
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

// admin action keyboard depends on role/status
function adminActionKeyboardForDoc(doc) {
    // doc is the DB doc containing role and status
    const rid = doc.requestId;
    if (doc.role === 'sender') {
        // sender: only approve/reject
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Approve', callback_data: `approve_${rid}` }, { text: '❌ Reject', callback_data: `reject_${rid}` }]
                ]
            }
        };
    } else {
        // traveler: approve / reject / request visa (if Pending)
        // if VisaRequested state -> only approve/reject
        if (doc.status === 'VisaRequested') {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Approve', callback_data: `approve_${rid}` }, { text: '❌ Reject', callback_data: `reject_${rid}` }]
                    ]
                }
            };
        } else {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Approve', callback_data: `approve_${rid}` }, { text: '❌ Reject', callback_data: `reject_${rid}` }],
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

// ---------- Commands ----------
bot.onText(/\/start/, async (msg) => {
    try {
        const chatId = msg.chat.id;

        // Prevent duplicate menu if bot restarted or Telegram sends deep-link + start
        if (userSessions[chatId] && userSessions[chatId].__startShown) {
            return; // Do not show menu again
        }

        // reset session
        userSessions[chatId] = { __startShown: true };

        const welcome = `<b>👋 Welcome to AirDlivers!</b>\n\nWe connect senders with travelers for fast next-day international delivery using passenger space.\n\nChoose an option below to begin.`;

        await bot.sendMessage(chatId, welcome, { parse_mode: 'HTML', ...mainMenuInline });

    } catch (err) {
        console.error('/start handler err', err);
    }
});

bot.onText(/\/id/, (msg) => {
    const chatId = msg.chat.id;
    const type = msg.chat.type;
    bot.sendMessage(chatId, `🆔 Chat ID: <code>${escapeHtml(String(chatId))}</code>\n💬 Type: ${escapeHtml(type)}`, { parse_mode: 'HTML' });
});

bot.onText(/\/privacy|\/help/, (msg) => {
    const chatId = msg.chat.id;
    const text = `<b>ℹ️ Help / Support</b>\n\nSupport Group: <a href="https://t.me/+CAntejDg9plmNWI0">AirDlivers Support</a>\nSupport Email: support@airdlivers.com\n\nPrivacy: We collect data required to facilitate deliveries (name, contact, IDs when needed). We do not sell data.`;
    bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
});

// ---------- Callback handler ----------
bot.on('callback_query', async (query) => {
    try {
        const data = query.data;
        const chatId = query.message.chat.id;
        const fromId = query.from.id;

        // main flows
        if (data === 'flow_sender') return startSenderFlow(chatId);
        if (data === 'flow_traveler') return startTravelerFlow(chatId);
        if (data === 'flow_tracking') {
            userSessions[chatId] = { type: 'tracking', step: 'tracking_phone', data: {} };
            return bot.sendMessage(chatId, '📍 Enter the phone number used for shipment (format: +911234567890):', { parse_mode: 'HTML' });
        }
        if (data === 'flow_help') return showHelpMenu(chatId);

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

        // confirmations: confirm_yes_role_requestId
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
                // remove inline keyboard from confirmation message if possible
                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id }).catch(() => { });
                await bot.sendMessage(sessChatId, '❌ Submission cancelled. Use /start to begin again.');
                return;
            } else {
                if (role === 'sender') return handleFinalSenderSubmit(sessChatId, session);
                if (role === 'traveler') return handleFinalTravelerSubmit(sessChatId, session);
                return bot.answerCallbackQuery(query.id, { text: 'Unknown role.' });
            }
        }

        // Admin actions: approve_, reject_, reason_, requestvisa_
        if (data && (data.startsWith('approve_') || data.startsWith('reject_') || data.startsWith('reason_') || data.startsWith('requestvisa_'))) {
            const invokedBy = query.from.id;
            const userIsSuper = String(invokedBy) === String(SUPER_ADMIN_ID);
            const userIsLogged = Boolean(adminAuth[invokedBy]?.loggedIn);

            // allow only super or logged admins
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

        // fallback
        await bot.answerCallbackQuery(query.id, { text: 'Action received.' });
    } catch (err) {
        console.error('callback_query handler error', err);
        try { await bot.answerCallbackQuery(query.id, { text: 'Internal error.' }); } catch (e) { }
    }
});

// ---------- Start sender flow ----------
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

// ---------- Start traveler flow ----------
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

// ---------- Help menu ----------
function showHelpMenu(chatId) {
    const text = `<b>ℹ️ Help / Support</b>\n\nSupport Group: <a href="https://t.me/+CAntejDg9plmNWI0">AirDlivers Support</a>\nEmail: support@airdlivers.com\n\nPrivacy: We collect required info (name, contact, IDs).`;
    bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
}

// ---------- Text message handler ----------
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const fromId = msg.from.id;
        const text = (msg.text || '').trim();

        // Admin login flow with /admin
        if (text === '/admin') {
            // super admin in private
            if (String(fromId) === String(SUPER_ADMIN_ID)) {
                adminAuth[fromId] = { loggedIn: true, super: true, awaitingCustomReasonFor: null };
                await bot.sendMessage(chatId, '🧠 Super Admin access granted ✅');
                return;
            }
            // invoked in admin group -> ask PIN
            if (String(chatId) === String(ADMIN_GROUP_ID)) {
                adminAuth[fromId] = { awaitingPin: true, loggedIn: false, super: false, awaitingCustomReasonFor: null };
                await bot.sendMessage(chatId, '🔑 Admin login: please reply in this group with the PIN (admins only).');
                return;
            }
            await bot.sendMessage(chatId, '🚫 You are not authorized to use /admin here.');
            return;
        }

        // admin PIN typed in admin group
        if (String(chatId) === String(ADMIN_GROUP_ID) && adminAuth[fromId]?.awaitingPin) {
            if (text === String(ADMIN_PIN)) {
                adminAuth[fromId] = { awaitingPin: false, loggedIn: true, super: false, awaitingCustomReasonFor: null };
                await bot.sendMessage(chatId, `<b>✅ Admin login successful</b> (admin: <code>${escapeHtml(String(fromId))}</code>)`, { parse_mode: 'HTML' });
            } else {
                adminAuth[fromId] = { awaitingPin: false, loggedIn: false, super: false, awaitingCustomReasonFor: null };
                await bot.sendMessage(chatId, '❌ Invalid PIN.');
            }
            return;
        }

        // Admin typing custom rejection reason in admin group
        if (String(chatId) === String(ADMIN_GROUP_ID) && adminAuth[fromId]?.awaitingCustomReasonFor) {
            const reqId = adminAuth[fromId].awaitingCustomReasonFor;
            const reasonText = text || 'Rejected by admin';
            await processReject(reqId, `❌ Rejected: ${escapeHtml(reasonText)}`, fromId, null);
            adminAuth[fromId].awaitingCustomReasonFor = null;
            return;
        }

        // handle user sessions
        const session = userSessions[chatId];
        if (!session) {
            // ignore other messages
            return;
        }

        if (session.type === 'tracking' && session.step === 'tracking_phone') {
            const phone = text;
            if (!isValidPhone(phone)) return bot.sendMessage(chatId, '❌ Invalid phone. Use +911234567890 format.');
            const doc = await sendersCol.findOne({ 'data.phone': phone }) || await travelersCol.findOne({ 'data.phone': phone });
            if (!doc) return bot.sendMessage(chatId, '❌ No shipment or traveler found for that number.');
            const status = doc.status || 'Pending';
            const note = doc.adminNote || 'N/A';
            return bot.sendMessage(chatId, `<b>📦 Status:</b> ${escapeHtml(status)}\n<b>📝 Admin note:</b> ${escapeHtml(note)}`, { parse_mode: 'HTML' });
        }

        if (session.type === 'sender') {
            await handleSenderTextStep(chatId, text);
            return;
        }
        if (session.type === 'traveler') {
            await handleTravelerTextStep(chatId, text);
            return;
        }

    } catch (err) {
        console.error('message handler error', err);
    }
});

// ---------- Photo handler ----------
bot.on('photo', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const session = userSessions[chatId];
        if (!session) return;

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
                await bot.sendMessage(chatId, "📝 Add optional notes or type 'None':", { parse_mode: 'HTML' });
                return;
            }
            // ignore unexpected photo silently (we removed noisy message)
            return;
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
            // ignore unexpected photo
            return;
        }

    } catch (err) {
        console.error('photo handler error', err);
    }
});

// ---------- Sender text steps ----------
async function handleSenderTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;
    const data = sess.data;

    switch (sess.step) {
        case 'sender_name':
            if (text.length < 2) return bot.sendMessage(chatId, 'Enter a valid full name (min 2 chars).');
            data.name = text;
            sess.step = 'sender_phone';
            return bot.sendMessage(chatId, '📞 Enter your Phone Number (example: +91 8106344793):', { parse_mode: 'HTML' });

        case 'sender_phone':
            if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone number. Use like +911234567890');
            data.phone = text.trim();
            sess.step = 'sender_email';
            return bot.sendMessage(chatId, '📧 Enter your Email:', { parse_mode: 'HTML' });

        case 'sender_email':
            if (!isValidEmail(text)) return bot.sendMessage(chatId, '❌ Invalid email. Please enter a valid email.');
            data.email = text.trim();
            sess.step = 'pickup_airport';
            return bot.sendMessage(chatId, '🛫 Enter Pickup Airport (From):', { parse_mode: 'HTML' });

        case 'pickup_airport':
            if (!text) return bot.sendMessage(chatId, 'Enter pickup airport name.');
            data.pickup = text;
            sess.step = 'destination_airport';
            return bot.sendMessage(chatId, '🛬 Enter Destination Airport (To):', { parse_mode: 'HTML' });

        case 'destination_airport':
            data.destination = text;
            sess.step = 'package_weight';
            return bot.sendMessage(chatId, '⚖️ Enter Package Weight in kg (Max 10kg):', { parse_mode: 'HTML' });

        case 'package_weight': {
            const m = text.match(/(\d+(\.\d+)?)/);
            if (!m) return bot.sendMessage(chatId, 'Invalid weight format. Use numbers (e.g., 2.5).');
            const w = parseFloat(m[1]);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, 'Enter a positive weight.');
            if (w > 10) { userSessions[chatId] = null; return bot.sendMessage(chatId, '❌ Weight > 10kg. Not allowed. Use /start to try again.'); }
            data.weight = w;
            sess.step = 'package_category';
            return bot.sendMessage(chatId, '📦 Choose package category (inline):', categoryKeyboard);
        }

        case 'send_date': {
            const d = parseDate_ddmmyyyy(text);
            if (!d) return bot.sendMessage(chatId, '❌ Invalid Send Date format. Use DD-MM-YYYY.');
            if (d < todayStart()) return bot.sendMessage(chatId, 'Send Date cannot be in the past.');
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
            // next: selfie
            sess.step = 'selfie_id';
            sess.expectingPhoto = 'selfie_id';
            return bot.sendMessage(chatId, '🪪 Upload a selfie holding your ID (passport/license/tax card) - mandatory:', { parse_mode: 'HTML' });
        }

        case 'optional_notes':
            data.notes = (text.toLowerCase() === 'none') ? '' : text;
            sess.requestId = makeRequestId('snd');
            sess.step = 'confirm_pending';
            {
                // build summary
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
                await bot.sendMessage(chatId, html, { parse_mode: 'HTML', ...confirmKeyboard('sender', sess.requestId) });
                return;
            }

        default:
            // do not spam "unexpected" messages; simply ignore unknown steps
            return;
    }
}

// ---------- Traveler text steps ----------
async function handleTravelerTextStep(chatId, text) {
    const sess = userSessions[chatId];
    if (!sess) return;
    const data = sess.data;

    switch (sess.step) {
        case 'traveler_name':
            if (text.length < 2) return bot.sendMessage(chatId, 'Enter valid full name.');
            data.name = text;
            sess.step = 'traveler_phone';
            return bot.sendMessage(chatId, '📞 Enter your Phone Number (example: +91 8106344793):', { parse_mode: 'HTML' });

        case 'traveler_phone':
            if (!isValidPhone(text)) return bot.sendMessage(chatId, '❌ Invalid phone format. Use +911234567890');
            data.phone = text.trim();
            sess.step = 'departure_airport';
            return bot.sendMessage(chatId, '🛫 Enter Departure Airport (From):', { parse_mode: 'HTML' });

        case 'departure_airport':
            data.departure = text;
            sess.step = 'departure_country';
            return bot.sendMessage(chatId, '🌍 Enter Departure Country (used to determine visa rules):', { parse_mode: 'HTML' });

        case 'departure_country':
            data.departureCountry = text;
            sess.step = 'destination_airport';
            return bot.sendMessage(chatId, '🛬 Enter Destination Airport (To):', { parse_mode: 'HTML' });

        case 'destination_airport':
            data.destination = text;
            sess.step = 'arrival_country';
            return bot.sendMessage(chatId, '🌍 Enter Arrival Country:', { parse_mode: 'HTML' });

        case 'arrival_country':
            data.arrivalCountry = text;
            sess.step = 'departure_time';
            return bot.sendMessage(chatId, '⏰ Enter Departure Date & Time (DD-MM-YY HH:mm):', { parse_mode: 'HTML' });

        case 'departure_time': {
            const dt = parseDate_ddmmyy_hhmm(text);
            if (!dt) return bot.sendMessage(chatId, '❌ Invalid format. Use DD-MM-YY HH:mm');
            data.departureTime = moment(dt).format('DD-MM-YY HH:mm');
            sess.step = 'arrival_time';
            return bot.sendMessage(chatId, '⏰ Enter Arrival Date & Time (DD-MM-YY HH:mm):', { parse_mode: 'HTML' });
        }

        case 'arrival_time': {
            const dt = parseDate_ddmmyy_hhmm(text);
            if (!dt) return bot.sendMessage(chatId, '❌ Invalid format. Use DD-MM-YY HH:mm');
            data.arrivalTime = moment(dt).format('DD-MM-YY HH:mm');
            sess.step = 'available_weight';
            return bot.sendMessage(chatId, '⚖️ Enter Available Weight (kg) (Max 10):', { parse_mode: 'HTML' });
        }

        case 'available_weight': {
            const m = text.match(/(\d+(\.\d+)?)/);
            if (!m) return bot.sendMessage(chatId, 'Invalid weight. Enter number in kg.');
            const w = parseFloat(m[1]);
            if (isNaN(w) || w <= 0) return bot.sendMessage(chatId, 'Enter positive weight.');
            if (w > 10) { userSessions[chatId] = null; return bot.sendMessage(chatId, '❌ Weight > 10kg. Not allowed. Use /start.'); }
            data.availableWeight = w;
            sess.step = 'passport_number';
            return bot.sendMessage(chatId, '🛂 Enter your Passport Number (example: L7982227):', { parse_mode: 'HTML' });
        }

        case 'passport_number':
            if (!/^[A-Za-z0-9]{7,9}$/.test(text)) return bot.sendMessage(chatId, 'Invalid passport format. Example: L7982227');
            data.passportNumber = text.trim();
            sess.expectingPhoto = 'passport_selfie';
            sess.step = 'passport_selfie';
            return bot.sendMessage(chatId, '📸 Upload a selfie holding your passport (mandatory):', { parse_mode: 'HTML' });

        case 'optional_notes':
            data.notes = (text.toLowerCase() === 'none') ? '' : text;
            sess.requestId = makeRequestId('trv');
            sess.step = 'confirm_pending';
            {
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
                await bot.sendMessage(chatId, html, { parse_mode: 'HTML', ...confirmKeyboard('traveler', sess.requestId) });
                return;
            }

        default:
            // do not spam
            return;
    }
}

// ---------- Final sender submit (store + send to admin) ----------
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
            createdAt: new Date()
        };
        await sendersCol.insertOne(doc);
        await backupSenderToJSON(doc);

        // notify sender
        await bot.sendMessage(chatId, `✅ Your package has been submitted for admin approval.\nRequest ID: <code>${escapeHtml(requestId)}</code>\nPlease wait for admin action.`, { parse_mode: 'HTML' });

        // send to admin group (summary + photos + action keyboard)
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
        if (session.data.packagePhoto) await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.packagePhoto, { caption: `📦 Package Photo - ${escapeHtml(requestId)}` });
        if (session.data.selfieId) await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.selfieId, { caption: `🪪 Selfie with ID - ${escapeHtml(requestId)}` });
        // admin actions for sender (no request visa)
        await bot.sendMessage(String(ADMIN_GROUP_ID), `Admin actions for <code>${escapeHtml(requestId)}</code>:`, { parse_mode: 'HTML', ...adminActionKeyboardForDoc(doc) });

        userSessions[chatId] = null;
    } catch (err) {
        console.error('handleFinalSenderSubmit err', err);
        await bot.sendMessage(chatId, '❌ Internal error submitting request. Please try again later.');
    }
}

// ---------- Final traveler submit ----------
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
            createdAt: new Date()
        };
        await travelersCol.insertOne(doc);
        await backupTravelerToJSON(doc);

        await bot.sendMessage(chatId, `✅ Your travel has been listed for admin approval.\nRequest ID: <code>${escapeHtml(requestId)}</code>\nWe will try to match packages on your route.`, { parse_mode: 'HTML' });

        // send to admin group
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
        if (session.data.passportSelfie) await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.passportSelfie, { caption: `🪪 Passport Selfie - ${escapeHtml(requestId)}` });
        if (session.data.itineraryPhoto) await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.itineraryPhoto, { caption: `📄 Itinerary - ${escapeHtml(requestId)}` });
        if (session.data.visaPhoto) await bot.sendPhoto(String(ADMIN_GROUP_ID), session.data.visaPhoto, { caption: `🛂 Visa - ${escapeHtml(requestId)}` });

        // admin action keyboard includes Request Visa option for traveler
        await bot.sendMessage(String(ADMIN_GROUP_ID), `Admin actions for <code>${escapeHtml(requestId)}</code>:`, { parse_mode: 'HTML', ...adminActionKeyboardForDoc(doc) });

        userSessions[chatId] = null;
    } catch (err) {
        console.error('handleFinalTravelerSubmit err', err);
        await bot.sendMessage(chatId, '❌ Internal error submitting travel. Please try again later.');
    }
}

// ---------- Admin: Approve ----------
// ---------- Admin: Approve ----------
async function processApprove(requestId, invokedBy, query) {
    try {
        // find either collection
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

        // ----------- CORRECTED MESSAGE LOGIC -----------
        let matchLine = "";
        if (found.role === "sender") {
            matchLine = "Please wait for matching traveler.";
        } else {
            matchLine = "Please wait for matching sender.";
        }

        // notify original user
        try {
            await bot.sendMessage(
                found.userId,
                `✅ Your request <code>${escapeHtml(requestId)}</code> has been <b>APPROVED</b> by admin.\n${matchLine}\n\nIf you need help, join support: <a href="https://t.me/+CAntejDg9plmNWI0">Support Group</a>`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );

            await bot.sendMessage(
                found.userId,
                '➡️ Back to Main Menu:',
                { parse_mode: 'HTML', ...mainMenuInline }
            );
        } catch (e) {
            console.warn('Could not notify user', found.userId, e.message);
        }

        // notify admin group
        await bot.sendMessage(
            String(ADMIN_GROUP_ID),
            `✅ Approved ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>`,
            { parse_mode: 'HTML' }
        );

        if (query) await bot.answerCallbackQuery(query.id, { text: 'Approved.' });

    } catch (err) {
        console.error('processApprove err', err);
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Error during approval.' });
    }
}

// ---------- Admin: Reject ----------
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
        // update
        const col = found.role === 'sender' ? sendersCol : travelersCol;
        await col.updateOne({ requestId }, { $set: { status: 'Rejected', adminNote: reasonText, updatedAt: new Date() } });

        // notify user
        try {
            await bot.sendMessage(found.userId, `❌ Your request <code>${escapeHtml(requestId)}</code> was <b>REJECTED</b>.\nReason: ${escapeHtml(reasonText)}\nIf you think this is a mistake, join support: <a href="https://t.me/+CAntejDg9plmNWI0">Support Group</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });
            await bot.sendMessage(found.userId, '➡️ Back to Main Menu:',
                { parse_mode: 'HTML', ...mainMenuInline }
            );
        } catch (e) {
            console.warn('Could not notify user', found.userId);
        }

        // inform admin
        await bot.sendMessage(String(ADMIN_GROUP_ID), `❌ Rejected ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>\nReason: ${escapeHtml(reasonText)}`, { parse_mode: 'HTML' });
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Rejection sent.' });

        return;
    } catch (err) {
        console.error('processReject err', err);
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Error during rejection.' });
    }
}

// ---------- Admin: Request Visa for traveler ----------
async function processRequestVisa(requestId, invokedBy, query) {
    try {
        // must be traveler
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

        // update status to VisaRequested
        await travelersCol.updateOne({ requestId }, { $set: { status: 'VisaRequested', adminNote: `Visa requested by admin ${invokedBy}`, updatedAt: new Date() } });

        // notify traveler: ask to upload visa (we'll accept photo next)
        try {
            await bot.sendMessage(found.userId, `🛂 Admin has requested your Visa for request <code>${escapeHtml(requestId)}</code>.\nPlease upload a clear photo of your visa now (send as photo). If you do not have a visa, type None.`, { parse_mode: 'HTML' });
        } catch (e) {
            console.warn('Could not notify traveler', found.userId);
        }

        // inform admin group
        await bot.sendMessage(String(ADMIN_GROUP_ID), `🛂 Visa requested from traveler ${escapeHtml(requestId)} by admin <code>${escapeHtml(String(invokedBy))}</code>`, { parse_mode: 'HTML' });
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Visa requested.' });

        return;
    } catch (err) {
        console.error('processRequestVisa err', err);
        if (query) await bot.answerCallbackQuery(query.id, { text: 'Error during visa request.' });
    }
}

// ---------- When traveler uploads visa AFTER VisaRequested ----------
/*
 We will use the photo handler: when a traveler session is not active (userSessions[chatId] === null),
 but there is a DB traveler document in status 'VisaRequested' and the message is a photo,
 then treat that photo as visa upload.
*/
bot.on('photo', async (msg) => {
    // This second photo handler handles visa uploads for already-submitted traveler (out-of-session)
    try {
        const chatId = msg.chat.id;
        const fileId = msg.photo[msg.photo.length - 1].file_id;

        // If there's an active session that expects a photo, first handler above already covers it.
        const session = userSessions[chatId];
        if (session && session.expectingPhoto) return; // handled previously

        // find pending traveler with VisaRequested and userId===chatId
        const pendingVisa = await travelersCol.findOne({ userId: chatId, status: 'VisaRequested' });
        if (!pendingVisa) return; // ignore

        // save visa photo into DB document
        await travelersCol.updateOne({ requestId: pendingVisa.requestId }, { $set: { 'data.visaPhoto': fileId, status: 'VisaUploaded', updatedAt: new Date() } });

        // notify admin group with visa photo and admin action buttons (approve/reject)
        await bot.sendPhoto(String(ADMIN_GROUP_ID), fileId, { caption: `🛂 Visa uploaded for ${escapeHtml(pendingVisa.requestId)}` });
        await bot.sendMessage(String(ADMIN_GROUP_ID), `Admin actions for <code>${escapeHtml(pendingVisa.requestId)}</code>:`, { parse_mode: 'HTML', ...adminActionKeyboardForDoc({ requestId: pendingVisa.requestId, role: 'traveler', status: 'VisaUploaded' }) });

        // notify traveler
        await bot.sendMessage(chatId, `✅ Visa received. Admin will review and approve/reject shortly.`, { parse_mode: 'HTML' });

        return;
    } catch (err) {
        // Already handled in previous photo handler - safe to swallow
        // but we log for debugging
        // console.error('visa photo handler err', err);
        return;
    }
});

// ---------- graceful shutdown ----------
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    try { if (mongoClient) await mongoClient.close(); } catch (e) { }
    process.exit(0);
});

// ---------- startup log ----------
console.log('✅ AirDlivers bot (final production) is running...');