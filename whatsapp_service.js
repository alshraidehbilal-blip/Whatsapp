const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
app.use(bodyParser.json());

// ── سجل الرسائل ──────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'sent_messages.json');
function loadLogs() {
    try { if (fs.existsSync(LOG_FILE)) return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) {}
    return [];
}
function saveLog(entry) {
    const logs = loadLogs();
    logs.unshift(entry);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs.slice(0, 200), null, 2));
}

// ── WhatsApp (Baileys — بدون Chrome) ─────────────────────────
let sock;
let isReady = false;

async function initWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Dental Clinic', 'Chrome', '1.0.0'],
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n\n📱 ======== امسح هذا الكود من واتساب ========\n');
            qrcode.generate(qr, { small: true });
            console.log('\n============================================');
            console.log('واتساب ← الأجهزة المرتبطة ← ربط جهاز\n');
        }

        if (connection === 'open') {
            console.log('\n✅ WhatsApp متصل وجاهز للإرسال!\n');
            isReady = true;
        }

        if (connection === 'close') {
            isReady = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ انقطع الاتصال. إعادة المحاولة:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => initWhatsApp(), 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ── Helper ────────────────────────────────────────────────────
function formatPhone(phone, countryCode = '962') {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = countryCode + cleaned.substring(1);
    else if (!cleaned.startsWith(countryCode)) cleaned = countryCode + cleaned;
    return cleaned + '@s.whatsapp.net';  // Baileys يستخدم @s.whatsapp.net
}

// ── API ───────────────────────────────────────────────────────
app.get('/status', (req, res) => res.json({ connected: isReady, timestamp: new Date().toISOString() }));
app.get('/messages', (req, res) => res.json(loadLogs()));

app.post('/send-booking', async (req, res) => {
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp غير متصل' });
    const { phone, country_code = '962', patient_name, appointment_date, appointment_time } = req.body;
    if (!phone || !patient_name || !appointment_date || !appointment_time)
        return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    const message = `مرحباً *${patient_name}* 👋\n\n✅ *تم تأكيد موعدك بنجاح*\n\n━━━━━━━━━━━━━━\n📅 التاريخ: *${appointment_date}*\n⏰ الوقت: *${appointment_time}*\n━━━━━━━━━━━━━━\n\nنتطلع لرؤيتك! إذا أردت تغيير الموعد يرجى التواصل معنا.\nشكراً لثقتكم 🙏`;

    try {
        await sock.sendMessage(formatPhone(phone, country_code), { text: message });
        saveLog({ id: Date.now().toString(), type: 'booking', type_label: 'تأكيد موعد', phone, patient_name, appointment_date, appointment_time, sent_at: new Date().toISOString(), status: 'sent' });
        console.log(`📤 [BOOKING] → ${phone} (${patient_name})`);
        res.json({ success: true });
    } catch (error) {
        saveLog({ id: Date.now().toString(), type: 'booking', type_label: 'تأكيد موعد', phone, patient_name, appointment_date, appointment_time, sent_at: new Date().toISOString(), status: 'failed', error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/send-payment', async (req, res) => {
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp غير متصل' });
    const { phone, country_code = '962', patient_name, appointment_date, appointment_time, doctor_name, procedure, total_cost, amount_paid, total_paid, remaining_balance } = req.body;
    if (!phone || !patient_name) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    let message = `مرحباً *${patient_name}* 👋\n\n🧾 *تفاصيل الزيارة والدفع*\n\n━━━━━━━━━━━━━━\n`;
    if (appointment_date) message += `📅 التاريخ: *${appointment_date}*\n`;
    if (appointment_time) message += `⏰ الوقت: *${appointment_time}*\n`;
    if (doctor_name)      message += `👨‍⚕️ الطبيب: *${doctor_name}*\n`;
    if (procedure)        message += `🦷 الإجراء: *${procedure}*\n`;
    message += `━━━━━━━━━━━━━━\n💰 *الملخص المالي:*\n`;
    if (total_cost > 0)        message += `📊 إجمالي التكلفة: *${Number(total_cost).toFixed(2)} JD*\n`;
    if (amount_paid > 0)       message += `✅ المدفوع الآن: *${Number(amount_paid).toFixed(2)} JD*\n`;
    if (total_paid > 0)        message += `💳 إجمالي المدفوع: *${Number(total_paid).toFixed(2)} JD*\n`;
    if (remaining_balance > 0) message += `⚠️ المتبقي: *${Number(remaining_balance).toFixed(2)} JD*\n`;
    else                       message += `✅ *تم سداد المبلغ كاملاً*\n`;
    message += `━━━━━━━━━━━━━━\nشكراً لثقتكم 🙏`;

    try {
        await sock.sendMessage(formatPhone(phone, country_code), { text: message });
        saveLog({ id: Date.now().toString(), type: 'payment', type_label: 'تفاصيل دفع', phone, patient_name, appointment_date, appointment_time, doctor_name, procedure, total_cost, amount_paid, total_paid, remaining_balance, sent_at: new Date().toISOString(), status: 'sent' });
        console.log(`📤 [PAYMENT] → ${phone} (${patient_name})`);
        res.json({ success: true });
    } catch (error) {
        saveLog({ id: Date.now().toString(), type: 'payment', type_label: 'تفاصيل دفع', phone, patient_name, sent_at: new Date().toISOString(), status: 'failed', error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 Server على http://localhost:${PORT}`);
    console.log('🔄 جاري تشغيل WhatsApp (بدون Chrome)...\n');
});

initWhatsApp();
