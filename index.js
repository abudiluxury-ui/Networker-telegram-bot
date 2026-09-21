const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const userSessions = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 1. /start Handler
bot.start((ctx) => {
  const userId = ctx.from.id;
  userSessions[userId] = { step: 'AWAITING_EMAIL' };
  ctx.reply("Welcome to Networker Pro! 🚀\n\nPlease reply with your registered Networker Pro account email address.");
});

// 2. Text Input Handler
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  const text = ctx.message.text.trim();

  if (!session) {
    return ctx.reply("Please type /start to begin subscription setup.");
  }

  if (session.step === 'AWAITING_EMAIL') {
    if (!/\S+@\S+\.\S+/.test(text)) {
      return ctx.reply("❌ Please enter a valid email address.");
    }

    session.email = text.toLowerCase();
    session.step = 'AWAITING_PLAN_SELECTION';

    return ctx.reply(
      `Email set to: *${session.email}*\n\nSelect your subscription plan:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💳 Monthly Pass — 80 ETB', 'plan_monthly')],
          [Markup.button.callback('🌟 Annual Executive Pass — 880 ETB', 'plan_yearly')]
        ])
      }
    );
  }

  if (session.step === 'AWAITING_PAYMENT_DETAILS') {
    session.paymentDetails = text;
    session.step = 'AWAITING_RECEIPT_PHOTO';
    return ctx.reply("Great! Now please send a photo/screenshot of your payment receipt.");
  }
});

// 3. Plan Selection Buttons
bot.action(['plan_monthly', 'plan_yearly'], (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];

  if (!session) return ctx.reply("Session expired. Type /start to restart.");

  const isMonthly = ctx.match[0] === 'plan_monthly';
  session.selectedPlan = isMonthly ? 'Monthly Pass (80 ETB)' : 'Annual Pass (880 ETB)';
  session.planDays = isMonthly ? 30 : 365;
  session.step = 'AWAITING_PAYMENT_DETAILS';

  ctx.reply(
    `Selected Plan: *${session.selectedPlan}*\n\n` +
    `Please transfer payment to one of our personal accounts:\n\n` +
    `• *CBE:* 1000XXXXXXXXX\n` +
    `• *Telebirr:* 09XXXXXXXX\n` +
    `• *M-Pesa:* 07XXXXXXXX\n\n` +
    `After payment, reply to this message with your *Full Name* and *Account Used* (e.g., "Abebe Bikila - Telebirr").`,
    { parse_mode: 'Markdown' }
  );
});

// 4. Screenshot Receipt Upload
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];

  if (!session || session.step !== 'AWAITING_RECEIPT_PHOTO') {
    return ctx.reply("Please type /start to begin.");
  }

  try {
    ctx.reply("Uploading receipt and notifying admin...");

    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Create a secure activation token stored in Supabase
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

    await supabase.from('subscription_tokens').insert({
      token: token,
      email: session.email,
      plan_days: session.planDays,
      is_used: false
    });

    const confirmUrl = `https://your-api-domain.com/api/confirm-subscription?token=${token}`;

    // Send email to networker.prooo@gmail.com
    await transporter.sendMail({
      from: `"Networker Pro Bot" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `🚨 Payment Approval Request: ${session.email}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ccc; border-radius: 8px;">
          <h2>New Subscription Request</h2>
          <p><strong>Email:</strong> ${session.email}</p>
          <p><strong>Plan:</strong> ${session.selectedPlan}</p>
          <p><strong>Sender Info:</strong> ${session.paymentDetails}</p>
          <p><a href="${fileLink.href}" target="_blank">View Receipt Image</a></p>
          <br>
          <a href="${confirmUrl}" style="background: #10B981; color: white; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 5px;">
            CONFIRM & ACTIVATE PLAN
          </a>
        </div>
      `
    });

    session.step = 'COMPLETED';
    ctx.reply("✅ Receipt received! Your payment submission has been dispatched for verification. Your Networker Pro plan will activate once confirmed.");

  } catch (err) {
    console.error("Error processing photo:", err);
    ctx.reply("❌ Error submitting receipt. Please try again.");
  }
});

bot.launch();
console.log("Bot running successfully!");
