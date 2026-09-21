const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userSessions = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Command: /start
bot.start((ctx) => {
  const userId = ctx.from.id;
  userSessions[userId] = { step: 'AWAITING_EMAIL' };
  ctx.reply("Welcome to Networker Pro! 🚀\n\nPlease enter your email address to begin:");
});

// Listen for text input (Email)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];

  if (!session) {
    return ctx.reply("Please send /start to begin.");
  }

  if (session.step === 'AWAITING_EMAIL') {
    const email = ctx.message.text.trim();
    
    if (!email.includes('@') || !email.includes('.')) {
      return ctx.reply("Please enter a valid email address.");
    }

    session.email = email;
    session.step = 'AWAITING_PLAN';

    return ctx.reply(
      "Great! Select a subscription plan:",
      Markup.inlineKeyboard([
        [Markup.button.callback('1 Month - $10', 'PLAN_1_MONTH')],
        [Markup.button.callback('6 Months - $50', 'PLAN_6_MONTHS')],
        [Markup.button.callback('1 Year - $90', 'PLAN_1_YEAR')]
      ])
    );
  }
});

// Listen for plan selection clicks
bot.action(/PLAN_/, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];

  if (!session || session.step !== 'AWAITING_PLAN') {
    return ctx.reply("Session expired. Please start again with /start.");
  }

  const planSelected = ctx.match.input;
  let planName = '1 Month';
  if (planSelected === 'PLAN_6_MONTHS') planName = '6 Months';
  if (planSelected === 'PLAN_1_YEAR') planName = '1 Year';

  session.plan = planName;
  session.step = 'AWAITING_RECEIPT';

  await ctx.answerCbQuery();
  return ctx.reply(`You selected: ${planName}.\n\nPlease send a screenshot/photo of your payment receipt to complete your order.`);
});

// Listen for receipt photo upload
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];

  if (!session || session.step !== 'AWAITING_RECEIPT') {
    return ctx.reply("Please send /start to begin.");
  }

  try {
    const photoArray = ctx.message.photo;
    const highestResPhoto = photoArray[photoArray.length - 1];
    const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);

    // Save token to Supabase
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const { data, error } = await supabase
      .from('subscription_tokens')
      .insert([
        {
          token: token,
          user_id: userId.toString(),
          email: session.email,
          plan: session.plan,
          status: 'pending'
        }
      ]);

    if (error) {
      console.error("Supabase Error:", error);
      return ctx.reply("❌ Database error creating subscription token. Please try again.");
    }

    // Send confirmation email to admin
    const confirmUrl = `https://networker-pro.railway.app/activate?token=${token}`;
    
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.ADMIN_EMAIL,
      subject: 'New Networker Pro Subscription Request',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>New Subscription Request</h2>
          <p><strong>Email:</strong> ${session.email}</p>
          <p><strong>Plan:</strong> ${session.plan}</p>
          <p><strong>Sender Info:</strong> Telegram ID ${userId}</p>
          <p><a href="${fileLink.href}">View Payment Receipt Photo</a></p>
          <br>
          <a href="${confirmUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            CONFIRM & ACTIVATE PLAN
          </a>
        </div>
      `
    });

    session.step = 'COMPLETED';
    ctx.reply("✅ Receipt received! Your payment is being verified by our team.");

  } catch (err) {
    console.error("Error processing photo:", err);
    ctx.reply("❌ Error submitting receipt. Please try again.");
  }
});

// Launch bot and keep process open
bot.launch().then(() => {
  console.log("Bot running successfully!");
}).catch((err) => {
  console.error("Failed to start bot:", err);
});

// Graceful shutdown listeners
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
