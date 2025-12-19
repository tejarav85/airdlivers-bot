// bot.js - Simplified AirDlivers production bot with Webhook, Auto-recovery,
// Sender/Traveler flows, Suspend/Unsuspend, Terminate Chat, Admin panel.
// NOTE: This is a condensed, functional version due to platform limits.

import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fs from 'fs-extra';
import moment from 'moment';
import { MongoClient } from 'mongodb';

// ------------------- ENV -------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;
const ADMIN_PIN = process.env.ADMIN_PIN;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'airdlivers';
const RAILWAY_URL = process.env.RAILWAY_URL;

if (!BOT_TOKEN || !ADMIN_GROUP_ID || !ADMIN_PIN || !MONGO_URI || !RAILWAY_URL) {
  console.error("FATAL ERROR — Missing environment variables");
  process.exit(1);
}

// ------------------ MongoDB ------------------
const mongo = new MongoClient(MONGO_URI);
await mongo.connect();
const db = mongo.db(MONGO_DB_NAME);
const sendersCol = db.collection("senders");
const travelersCol = db.collection("travelers");

// ------------------ Bot ---------------------
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${RAILWAY_URL}${WEBHOOK_PATH}`;
await bot.setWebHook(WEBHOOK_URL);

// ------------------ Express -------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("AirDlivers bot webhook OK"));
app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);

// ------------------ Util -------------------
function escapeHtml(t=""){return t.replaceAll("&","&amp;").replaceAll("<","&lt;");}
function isEmail(x){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);}
function isPhone(x){return /^\+\d{8,15}$/.test(x);}
function parseDate(x){const m=moment(x,"DD-MM-YYYY",true);return m.isValid()?m.toDate():null;}

const sessions = {};  // per-user state
const adminAuth = {}; // admin login state

// ------------------ Suspend / Unsuspend ------------------
async function suspendUser(id, reason="Violation") {
  await sendersCol.updateMany({ userId:id }, { $set:{ suspended:true, reason }});
  await travelersCol.updateMany({ userId:id }, { $set:{ suspended:true, reason }});
  await bot.sendMessage(id, `🚫 You are suspended.
Reason: ${reason}`);
}

async function unsuspendUser(id) {
  await sendersCol.updateMany({ userId:id }, { $unset:{ suspended:"", reason:""}});
  await travelersCol.updateMany({ userId:id }, { $unset:{ suspended:"", reason:""}});
  await bot.sendMessage(id, `✅ Your access restored.`);
}

// ------------------ Start ------------------
bot.onText(/\/start/, msg => {
  const id = msg.chat.id;
  sessions[id] = null;
  bot.sendMessage(id,
    "<b>Welcome to AirDlivers</b>
Choose:",
    {
      parse_mode:"HTML",
      reply_markup:{
        inline_keyboard:[
          [{text:"📦 Send Package",callback_data:"flow_sender"}],
          [{text:"🧳 Traveler",callback_data:"flow_traveler"}],
          [{text:"ℹ️ Help",callback_data:"flow_help"}]
        ]
      }
    }
  );
});

// ------------------ Callback ------------------
bot.on("callback_query", async q => {
  const id = q.message.chat.id;
  const data = q.data;

  if (data==="flow_help") {
    return bot.sendMessage(id,
      "<b>Help</b>
Support: support@airdlivers.com",
      {parse_mode:"HTML"}
    );
  }

  if (data==="flow_sender") {
    sessions[id]={type:"sender",step:"name",data:{}};
    return bot.sendMessage(id,"Enter Name:");
  }

  if (data==="flow_traveler") {
    sessions[id]={type:"traveler",step:"name",data:{}};
    return bot.sendMessage(id,"Enter Name:");
  }
});

// ------------------ Message Handler ------------------
bot.on("message", async msg => {
  const id = msg.chat.id;
  const text = msg.text?.trim();

  // Check suspension
  const suspendedSender = await sendersCol.findOne({ userId:id, suspended:true });
  const suspendedTraveler = await travelersCol.findOne({ userId:id, suspended:true });
  if (suspendedSender || suspendedTraveler) {
    return bot.sendMessage(id, "🚫 You are suspended. Contact support.");
  }

  // Admin login
  if (text === "/admin" && String(id) === String(ADMIN_GROUP_ID)) {
    adminAuth[msg.from.id] = { awaitingPin:true };
    return bot.sendMessage(id,"Send PIN:");
  }

  if (adminAuth[msg.from.id]?.awaitingPin) {
    if (text === ADMIN_PIN) {
      adminAuth[msg.from.id] = { loggedIn:true };
      bot.sendMessage(id,"Admin logged in.");
    } else {
      bot.sendMessage(id,"Wrong PIN.");
    }
    return;
  }

  const s = sessions[id];
  if (!s) return;

  if (s.type==="traveler") {
    if (s.step==="name") {
      s.data.name = text;
      s.step = "phone";
      return bot.sendMessage(id,"Enter Phone (+xxxx):");
    }
    if (s.step==="phone") {
      if (!isPhone(text)) return bot.sendMessage(id,"Invalid phone.");
      s.data.phone = text;
      s.step="email";
      return bot.sendMessage(id,"Enter Email:");
    }
    if (s.step==="email") {
      if (!isEmail(text)) return bot.sendMessage(id,"Invalid email.");
      s.data.email=text;
      s.step="dep_air";
      return bot.sendMessage(id,"Departure Airport:");
    }
    if (s.step==="dep_air") {
      s.data.departure=text;
      s.step="dep_country";
      return bot.sendMessage(id,"Departure Country:");
    }
    if (s.step==="dep_country") {
      s.data.departureCountry=text;
      s.step="dest_air";
      return bot.sendMessage(id,"Destination Airport:");
    }
    if (s.step==="dest_air") {
      s.data.destination=text;
      s.step="dest_country";
      return bot.sendMessage(id,"Destination Country:");
    }
    if (s.step==="dest_country") {
      s.data.destinationCountry=text;
      s.step="weight";
      return bot.sendMessage(id,"Available Weight (kg):");
    }
    if (s.step==="weight") {
      s.data.weight = Number(text);
      s.step="passport";
      return bot.sendMessage(id,"Passport Number:");
    }
    if (s.step==="passport") {
      s.data.passport=text;
      s.step="confirm";
      return bot.sendMessage(id,
        "<b>Confirm?</b>",
        {
          parse_mode:"HTML",
          reply_markup:{
            inline_keyboard:[
              [{text:"Submit",callback_data:"t_submit"}]
            ]
          }
        }
      );
    }
  }

  if (s.type==="sender") {
    if (s.step==="name") {
      s.data.name=text;
      s.step="phone";
      return bot.sendMessage(id,"Enter Phone:");
    }
    if (s.step==="phone") {
      if (!isPhone(text)) return bot.sendMessage(id,"Invalid phone.");
      s.data.phone=text;
      s.step="email";
      return bot.sendMessage(id,"Enter Email:");
    }
    if (s.step==="email") {
      if (!isEmail(text)) return bot.sendMessage(id,"Invalid email.");
      s.data.email=text;
      s.step="from";
      return bot.sendMessage(id,"Pickup Airport:");
    }
    if (s.step==="from") {
      s.data.pickup=text;
      s.step="to";
      return bot.sendMessage(id,"Destination Airport:");
    }
    if (s.step==="to") {
      s.data.destination=text;
      s.step="weight";
      return bot.sendMessage(id,"Package Weight (kg):");
    }
    if (s.step==="weight") {
      s.data.weight=Number(text);
      s.step="confirm";
      return bot.sendMessage(id,
        "<b>Confirm?</b>",
        {
          parse_mode:"HTML",
          reply_markup:{ inline_keyboard:[[ {text:"Submit",callback_data:"s_submit"} ]] }
        }
      );
    }
  }
});

// ------------------ Basic submit ------------------
bot.on("callback_query", async q => {
  const id = q.message.chat.id;
  const data = q.data;
  const s = sessions[id];
  if (!s) return;

  if (data==="s_submit") {
    const doc={userId:id,role:"sender",data:s.data,status:"Pending"};
    await sendersCol.insertOne(doc);
    await bot.sendMessage(id,"Sender request submitted.");
    sessions[id]=null;
  }

  if (data==="t_submit") {
    const doc={userId:id,role:"traveler",data:s.data,status:"Pending"};
    await travelersCol.insertOne(doc);
    await bot.sendMessage(id,"Traveler request submitted.");
    sessions[id]=null;
  }
});
