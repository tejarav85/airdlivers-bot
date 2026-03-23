import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import TelegramBot from 'node-telegram-bot-api';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const SUPPORT_GROUP_ID = process.env.SUPPORT_GROUP_ID;

if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_GROUP_ID) { console.error('ADMIN_GROUP_ID missing'); process.exit(1); }
if (!SUPPORT_GROUP_ID) { console.error('SUPPORT_GROUP_ID missing'); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

async function testGroups() {
    try {
        console.log(`Testing Admin Group ID: ${ADMIN_GROUP_ID}`);
        await bot.sendMessage(String(ADMIN_GROUP_ID), "🚀 <b>Test Message from AirDlivers Bot to Admin Group</b>", { parse_mode: 'HTML' });
        console.log('✅ Admin Group delivery SUCCESSFUL');
    } catch (e) {
        console.error('❌ Admin Group delivery FAILED:', e.message);
    }

    try {
        console.log(`Testing Support Group ID: ${SUPPORT_GROUP_ID}`);
        await bot.sendMessage(String(SUPPORT_GROUP_ID), "🆘 <b>Test Message from AirDlivers Bot to Support Group</b>", { parse_mode: 'HTML' });
        console.log('✅ Support Group delivery SUCCESSFUL');
    } catch (e) {
        console.error('❌ Support Group delivery FAILED:', e.message);
    }
    
    process.exit(0);
}

testGroups();
