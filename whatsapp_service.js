const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

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

// ── مسار Chromium ─────────────────────────────────────────────
// Render يثبّت Chromium على /usr/bin/chromium عبر render.yaml
const CHROMIUM_PATHS = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
];

function findChromium() {
    for (const p of CHROMIUM_PATHS) {
        if (p && fs.existsSync(p)) {
            console.log('✅ Chromium found:', p);
            return p;
        }
    }
    throw new Error('Chromium not found! Check render.yaml build command.');
}

// ── WhatsApp Client ──────────────────────────────────────────
let client;
let isReady = false;

function initClient() {
    const executablePath = findChromium();

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
        puppeteer: {
            executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            headless: true
        }
    });

    client.on('qr', (qr) => {
        console.log('\n\n📱 ======== امسح هذا الكود من واتساب ========\n');
        qrcode.generate(qr, { small: true });
        console.log('\n============================================\n');
        console.log('واتساب ← الأجهزة المرتبطة ← ربط جهاز\n');
    });

    client.on('ready', () => {
        console.log('\n✅ WhatsApp متصل وجاهز للإرسال!\n');
        isReady = true;
    });

    client.on('disconnected', (reason) => {
        console.log('❌ انقطع الاتصال:', reason);
        isReady = false;
        setTimeout(() => { console.log('🔄 إعادة الاتصال...'); client.initialize(); }, 10000);
    });

    client.on('auth_failure', () => { console.log('❌ فشل المصادقة'); isReady = false; });

    client.initialize();
}

// ── Helper ────────────────────────────────────────────────────
function formatPhone(phone, countryCode = '962') {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = countryCode + cleaned.substring(1);
    else if (!cleaned.startsWith(countryCode)) cleaned = countryCode + cleaned;
    return cleaned + '@c.us';
}

// ── API ───────────────────────────────────────────────────────
app.get('/status', (req, res) => res.json({ connected: isReady, timestamp: new Date().toISOString() }));
app.get('/messages', (req, res) => res.json(loadLogs()));

app.post('/send-booking', async (req, res) => {
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp غير متصل' });
    const { phone, country_code = '962', patient_name, appointment_date, appointment_time } = req.body;
    if (!phone || !patient_name || !appointment_date || !appointment_time)
        return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    const message =
`مرحباً *${patient_name}* 👋

✅ *تم تأكيد موعدك بنجاح*

━━━━━━━━━━━━━━
📅 التاريخ: *${appointment_date}*
⏰ الوقت: *${appointment_time}*
━━━━━━━━━━━━━━

نتطلع لرؤيتك! إذا أردت تغيير الموعد يرجى التواصل معنا.
شكراً لثقتكم 🙏`;

    try {
        await client.sendMessage(formatPhone(phone, country_code), message);
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
        await client.sendMessage(formatPhone(phone, country_code), message);
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
    console.log('🔄 جاري تشغيل WhatsApp...\n');
    try {
        initClient();
    } catch (err) {
        console.error('❌ فشل:', err.message);
        process.exit(1);
    }
});
