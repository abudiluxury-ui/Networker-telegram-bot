const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Setup multer for handling image file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Nodemailer for sending emails
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 1. Endpoint for users to submit payment proof from the app
app.post('/api/submit-payment', upload.single('screenshot'), async (req, res) => {
  try {
    const { userId, fullName, email } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Screenshot is required.' });
    }

    // Upload screenshot to Supabase storage bucket
    const fileName = `${Date.now()}_${userId}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('payment-screenshots')
      .upload(fileName, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    // Get public URL of the uploaded image
    const { data: publicURLData } = supabase.storage
      .from('payment-screenshots')
      .getPublicUrl(fileName);

    const screenshotUrl = publicURLData.publicUrl;

    // Save submission into pending_payments table
    const { data: pendingData, error: dbError } = await supabase
      .from('pending_payments')
      .insert([
        { user_id: userId, full_name: fullName, email: email, screenshot_url: screenshotUrl, status: 'pending' }
      ])
      .select()
      .single();

    if (dbError) throw dbError;

    // Generate confirmation link for admin email
    const confirmLink = `${req.protocol}://${req.get('host')}/api/confirm-payment?id=${pendingData.id}`;

    // Send email to admin
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: 'networker.prooo@gmail.com',
      subject: `New Premium Payment Proof - ${fullName}`,
      html: `
        <h2>New Payment Submission</h2>
        <p><strong>Name:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p><a href="${screenshotUrl}" target="_blank">View Payment Screenshot</a></p>
        <br>
        <a href="${confirmLink}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">CONFIRM THIS PAYMENT</a>
      `,
    });

    res.json({ success: true, message: 'Payment submitted successfully. Awaiting admin review.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 2. Endpoint triggered when admin clicks the confirmation link in the email
app.get('/api/confirm-payment', async (req, res) => {
  try {
    const paymentId = req.query.id;
    if (!paymentId) return res.status(400).send('Invalid request.');

    // Fetch the pending payment record
    const { data: payment, error: pError } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (pError || !payment) return res.status(404).send('Payment record not found.');
    if (payment.status === 'approved') return res.send('<h1>This payment has already been confirmed!</h1>');

    // Calculate 30-day expiration from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Update user's premium status in the users table
    const { error: userError } = await supabase
      .from('users')
      .update({
        is_premium: true,
        premium_expires_at: expiresAt.toISOString(),
      })
      .eq('id', payment.user_id);

    if (userError) throw userError;

    // Mark payment as approved
    await supabase
      .from('pending_payments')
      .update({ status: 'approved' })
      .eq('id', paymentId);

    res.send('<h1>Payment Confirmed Successfully!</h1><p>The user has been upgraded to 30 days of premium access.</p>');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal server error during confirmation.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
