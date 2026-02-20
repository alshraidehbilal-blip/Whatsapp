
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// إنشاء WhatsApp Client مع حفظ الجلسة محلياً
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let isReady = false;

// عرض QR Code عند أول تشغيل
client.on('qr', (qr) => {
    console.log('امسح هذا QR Code بواتساب:');
    qrcode.generate(qr, { small: true });
});

// عند الاتصال بنجاح
client.on('ready', () => {
    console.log('✅ WhatsApp متصل وجاهز!');
    isReady = true;
});

client.on('disconnected', () => {
    console.log('❌ WhatsApp انقطع الاتصال');
    isReady = false;
});

// تهيئة العميل
client.initialize();

// ==============================
// API Endpoints
// ==============================

// فحص حالة الاتصال
app.get('/status', (req, res) => {
    res.json({ connected: isReady });
});

// إرسال رسالة موعد جديد
app.post('/send-appointment', async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ error: 'WhatsApp غير متصل' });
    }

    const {
        phone,
        patient_name,
        appointment_date,
        appointment_time,
        procedure,
        total_cost,
        amount_paid,
        remaining_balance
    } = req.body;

    // تنسيق رقم الهاتف (إضافة 966 أو الكود المطلوب)
    const formattedPhone = formatPhone(phone);

    // بناء الرسالة
    let message = `مرحباً ${patient_name} 👋\n\n`;
    message += `📅 *تفاصيل موعدك:*\n`;
    message += `━━━━━━━━━━━━━━━\n`;
    message += `🗓️ التاريخ: ${appointment_date}\n`;
    message += `⏰ الوقت: ${appointment_time}\n`;

    if (procedure) {
        message += `🦷 الإجراء: ${procedure}\n`;
    }

    message += `━━━━━━━━━━━━━━━\n`;
    message += `💰 *الملخص المالي:*\n`;

    if (total_cost && total_cost > 0) {
        message += `📊 إجمالي التكلفة: ${total_cost} ريال\n`;
    }
    if (amount_paid && amount_paid > 0) {
        message += `✅ المبلغ المدفوع: ${amount_paid} ريال\n`;
    }
    if (remaining_balance && remaining_balance > 0) {
        message += `⚠️ المبلغ المتبقي: ${remaining_balance} ريال\n`;
    }

    message += `━━━━━━━━━━━━━━━\n`;
    message += `شكراً لثقتكم بنا 🙏`;

    try {
        await client.sendMessage(formattedPhone, message);
        console.log(`✅ رسالة أُرسلت إلى ${phone}`);
        res.json({ success: true, message: 'تم الإرسال بنجاح' });
    } catch (error) {
        console.error('خطأ في الإرسال:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// Helper Functions
// ==============================
function formatPhone(phone) {
    // إزالة الأحرف غير الرقمية
    let cleaned = phone.replace(/\D/g, '');
    
    // إذا بدأ بـ 0 استبدله بكود الدولة (عدّل حسب بلدك)
    if (cleaned.startsWith('0')) {
        cleaned = '966' + cleaned.substring(1); // السعودية
        // للأردن: cleaned = '962' + cleaned.substring(1);
    }
    
    // إذا لم يبدأ بكود دولة، أضفه
    if (!cleaned.startsWith('9')) {
        cleaned = '966' + cleaned;
    }
    
    return cleaned + '@c.us';
}

// تشغيل السيرفر
const PORT = process.env.WHATSAPP_PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Service يعمل على http://localhost:${PORT}`);
});
