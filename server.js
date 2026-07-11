const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('./database');
const fs = require('fs');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');

// Load configurations
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { JWT_SECRET: 'default_secret', GOOGLE_CLIENT_ID: '' };
if (fs.existsSync(CONFIG_PATH)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[Config] Failed to parse config.json, using defaults.');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || config.JWT_SECRET || 'safelink_jwt_super_secret_session_token_key_change_me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || config.GOOGLE_CLIENT_ID || '';

// SMTP Configuration
const SMTP_HOST = process.env.SMTP_HOST || config.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || config.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || config.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || config.SMTP_PASS || '';

// Razorpay Configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || config.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || config.RAZORPAY_KEY_SECRET || 'placeholder_secret';

let razorpay = null;
try {
  // Initialize Razorpay client only if it's not a placeholder key
  if (RAZORPAY_KEY_ID && !RAZORPAY_KEY_ID.includes('placeholder')) {
    razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
    console.log('[Razorpay] Configured with key:', RAZORPAY_KEY_ID);
  } else {
    console.log('[Razorpay] Simulator Mode active (default placeholder keys configured).');
  }
} catch (err) {
  console.error('[Razorpay] Initialization error:', err.message);
}

// Temporary OTP Memory Storage
let otpStore = {}; // { email: { otp: string, expiresAt: number } }

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware to check JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
  
  if (!token) {
    return res.status(401).json({ error: 'Access token missing.' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session token.' });
    }
    
    try {
      const user = await db.getUserById(decoded.id);
      if (!user) {
        return res.status(404).json({ error: 'User account not found.' });
      }
      
      req.user = user;
      next();
    } catch (dbErr) {
      console.error('[Auth Middleware] Database error:', dbErr);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });
}

// ==================== AUTHENTICATION API ROUTES ====================

// 0. Send Email OTP
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  try {
    // Check if user already exists
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email is already registered.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email.toLowerCase().trim()] = {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    };

    console.log(`[OTP] Generated OTP for ${email}: ${otp}`);

    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      // Send real email via SMTP
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS
        },
        debug: true,
        logger: true
      });

      const mailOptions = {
        from: `"SafeLink Security" <${SMTP_USER}>`,
        to: email,
        subject: 'SafeLink Verification Code (OTP)',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #14b8a6; text-align: center;">SafeLink Verification</h2>
            <p>Hello,</p>
            <p>Thank you for choosing SafeLink! To complete your registration, please verify your email address using this verification code:</p>
            <div style="text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0b1326; background: #f0fdfa; padding: 15px 30px; border-radius: 8px; border: 1px dashed #14b8a6; display: inline-block;">
                ${otp}
              </span>
            </div>
            <p style="color: #666; font-size: 14px;">This OTP is valid for 5 minutes. If you did not request this code, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee;" />
            <p style="color: #999; font-size: 12px; text-align: center;">SafeLink Secure Peer-to-Peer Video Call</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`[OTP] Verification email sent to: ${email}`);
      res.json({ message: 'Verification OTP sent to your email.' });
    } else {
      // Simulator Fallback Mode
      console.log(`[OTP Simulator] Real SMTP host not configured. Simulated OTP for ${email} is: ${otp}`);
      res.json({
        message: 'Verification OTP generated (Simulator Mode).',
        isSimulated: true,
        simulatedOtp: otp
      });
    }
  } catch (err) {
    console.error('[OTP Send Error]:', err);
    res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
  }
});

// 1. Email/Password Signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, otp } = req.body;
  
  if (!name || !email || !password || !otp) {
    return res.status(400).json({ error: 'All fields (name, email, password, otp) are required.' });
  }

  const emailKey = email.toLowerCase().trim();
  const record = otpStore[emailKey];

  if (!record) {
    return res.status(400).json({ error: 'No verification request found for this email. Please send OTP first.' });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[emailKey];
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }

  if (record.otp !== otp.trim()) {
    return res.status(400).json({ error: 'Invalid verification OTP. Please check and try again.' });
  }

  // Clear OTP on successful match
  delete otpStore[emailKey];

  try {
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email is already registered.' });
    }

    const newUser = await db.createUser({
      name,
      email,
      password,
      provider: 'email'
    });

    // Generate JWT Session Token
    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Signup successful',
      token,
      user: newUser
    });
  } catch (err) {
    console.error('[Auth Signup] Error:', err);
    res.status(500).json({ error: err.message || 'Server error during signup.' });
  }
});

// 2. Email/Password Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await db.getUserByEmail(email);
    if (!user || user.provider !== 'email') {
      return res.status(401).json({ error: 'Invalid email or password credentials.' });
    }

    const isValid = await db.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password credentials.' });
    }

    // Generate JWT Token
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        interests: user.interests
      }
    });
  } catch (err) {
    console.error('[Auth Login] Error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// 3. Google Sign-In Verification
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Google credential token is missing.' });
  }

  try {
    let payload = null;

    // Check if Google Client ID is configured
    if (GOOGLE_CLIENT_ID) {
      console.log('[Google Auth] Verifying real token with Client ID:', GOOGLE_CLIENT_ID);
      const client = new OAuth2Client(GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      // DEV MODE / SIMULATOR FALLBACK: If token starts with mock, parse simulated attributes
      console.log('[Google Auth] Simulator mode fallback active.');
      if (credential.startsWith('mock_google_token_')) {
        const decodedString = Buffer.from(credential.replace('mock_google_token_', ''), 'base64').toString('utf8');
        payload = JSON.parse(decodedString);
      } else {
        return res.status(400).json({ 
          error: 'Google Client ID is not configured on this server, and the token is not a valid mock.' 
        });
      }
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Failed to retrieve Google profile attributes.' });
    }

    // Retrieve or create Google user
    let user = await db.getUserByEmail(payload.email);
    if (!user) {
      console.log(`[Google Auth] Creating new Google SSO user for: ${payload.email}`);
      user = await db.createUser({
        name: payload.name || payload.email.split('@')[0],
        email: payload.email,
        provider: 'google',
        avatar: payload.picture
      });
    } else if (user.provider !== 'google') {
      // Account exists but registered via password. Link them or block? 
      // Link: Update user to support SSO, or return error. 
      return res.status(409).json({ 
        error: 'This email is already registered via password. Please login using email & password.' 
      });
    }

    // Generate JWT Token
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Google login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        interests: user.interests
      }
    });

  } catch (err) {
    console.error('[Google Auth] Error during validation:', err);
    res.status(400).json({ error: 'Authentication failed. Please try again.' });
  }
});

// 4. Retrieve logged in user info (Me)
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const subStatus = db.checkSubscriptionStatus(req.user);
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
      interests: req.user.interests,
      history: req.user.history || [],
      trialExpiresAt: req.user.trialExpiresAt,
      subscriptionExpiresAt: req.user.subscriptionExpiresAt,
      subscription: subStatus
    }
  });
});

// 5. Update user interests in database
app.post('/api/auth/interests', authenticateToken, async (req, res) => {
  const { interests } = req.body;
  if (!Array.isArray(interests)) {
    return res.status(400).json({ error: 'Interests must be a valid array of strings.' });
  }

  const success = await db.updateUserInterests(req.user.id, interests);
  if (success) {
    res.json({ message: 'Interests updated successfully.', interests });
  } else {
    res.status(500).json({ error: 'Failed to update interests.' });
  }
});

// 5.5 Razorpay Payments: Create Order
app.post('/api/payment/create-order', authenticateToken, async (req, res) => {
  try {
    const amount = 100; // 1 INR in paise
    const currency = 'INR';

    // Check if we are running in Simulator Mode (placeholder or unconfigured Razorpay client)
    if (!razorpay) {
      const mockOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      console.log(`[Payment] Creating Simulated Order: ${mockOrderId}`);
      return res.json({
        id: mockOrderId,
        currency,
        amount,
        isMock: true,
        key: RAZORPAY_KEY_ID
      });
    }

    // Otherwise, create actual Razorpay order
    const options = {
      amount: amount,
      currency: currency,
      receipt: `rcpt_${req.user.id.replace('usr_', '')}`,
      notes: {
        website_name: "SafeLink Video Call"
      }
    };

    const order = await razorpay.orders.create(options);
    console.log(`[Payment] Razorpay Order Created: ${order.id}`);
    res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      isMock: false,
      key: RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error('[Payment Create Order Error]:', err);
    // If order creation fails (e.g. invalid keys), fallback to simulation sandbox
    const mockOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    console.log(`[Payment] Failed to create live order, falling back to simulated: ${mockOrderId}`);
    res.json({
      id: mockOrderId,
      currency: 'INR',
      amount: 100,
      isMock: true,
      key: RAZORPAY_KEY_ID,
      warning: 'Fallback to simulator: ' + err.message
    });
  }
});

// 5.6 Razorpay Payments: Verify Signature and Renew Subscription
app.post('/api/payment/verify-payment', authenticateToken, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Payment details missing.' });
  }

  try {
    let isValid = false;

    // Check if it's a simulated order
    if (razorpay_order_id.startsWith('order_mock_') && razorpay_payment_id.startsWith('pay_mock_')) {
      console.log('[Payment] Verifying Mock Payment for order:', razorpay_order_id);
      isValid = true;
    } else if (razorpay) {
      // Real signature verification
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
      hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
      const generated_signature = hmac.digest('hex');
      isValid = generated_signature === razorpay_signature;
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Payment verification failed. Invalid signature.' });
    }

    // Success: Renew user subscription by 30 days
    const newExpiry = await db.renewSubscription(req.user.id);
    if (!newExpiry) {
      return res.status(500).json({ error: 'Failed to update subscription in database.' });
    }

    console.log(`[Payment] Success! User ${req.user.name} subscription renewed until ${newExpiry}`);
    res.json({
      success: true,
      message: 'Subscription successfully activated for 1 month!',
      subscriptionExpiresAt: newExpiry
    });

  } catch (err) {
    console.error('[Payment Verification Error]:', err);
    res.status(500).json({ error: 'Internal server error during verification.' });
  }
});

// 6. Get public auth configurations (Google Client ID)
app.get('/api/auth/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== WEBRTC SOCKET SIGNALING MANAGEMENT ====================

// Queue shape: { id: socket.id, socket: socket, userId: string, name: string, avatar: string, interests: Array<string>, joinedAt: number }
let matchmakingQueue = [];

io.on('connection', (socket) => {
  console.log(`[Socket Server] Connection opened: ${socket.id}`);

  // When a user requests matchmaking
  socket.on('join-matchmaking', async (data) => {
    const { token } = data;
    
    if (!token) {
      socket.emit('subscription-required', {
        message: 'Authentication is required to enter matchmaking.'
      });
      return;
    }

    let userId = null;
    let userName = 'Anonymous';
    let userAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`;
    let interests = data.interests || [];

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await db.getUserById(decoded.id);
      if (user) {
        // Enforce active subscription/trial check
        const subStatus = db.checkSubscriptionStatus(user);
        if (!subStatus.active) {
          socket.emit('subscription-required', {
            message: 'Your 1-day free trial or subscription has expired. Please renew your subscription to access matchmaking.',
            subscription: subStatus
          });
          return;
        }

        userId = user.id;
        userName = user.name;
        userAvatar = user.avatar;
        interests = user.interests || interests;
      } else {
        socket.emit('subscription-required', {
          message: 'User account not found. Access denied.'
        });
        return;
      }
    } catch (err) {
      console.warn(`[Socket Server] Token verification failed for socket ${socket.id}:`, err.message);
      socket.emit('subscription-required', {
        message: 'Invalid or expired session. Please log in again.'
      });
      return;
    }

    console.log(`[Socket Server] ${userName} (${socket.id}) entering matchmaking queue.`);

    // Purge socket if already in queue
    matchmakingQueue = matchmakingQueue.filter(user => user.id !== socket.id);

    const queueUser = {
      id: socket.id,
      socket: socket,
      userId: userId,
      name: userName,
      avatar: userAvatar,
      interests: interests,
      joinedAt: Date.now()
    };

    // Find a match
    let match = null;

    // Try finding another peer sharing interests
    if (interests.length > 0) {
      match = matchmakingQueue.find(peer => {
        if (peer.id === socket.id) return false;
        return peer.interests.some(interest =>
          interests.map(i => i.toLowerCase().trim()).includes(interest.toLowerCase().trim())
        );
      });
    }

    // Fallback: match with first waiting peer
    if (!match && matchmakingQueue.length > 0) {
      match = matchmakingQueue[0];
    }

    if (match) {
      // Remove match from queue
      matchmakingQueue = matchmakingQueue.filter(user => user.id !== match.id);

      const roomId = `room-${socket.id}-${match.id}`;
      console.log(`[Socket Server] Match established! ${userName} & ${match.name} -> Room: ${roomId}`);

      // Associate connection settings
      socket.roomId = roomId;
      socket.peerId = match.id;
      socket.peerName = match.name;
      socket.peerAvatar = match.avatar;
      
      match.socket.roomId = roomId;
      match.socket.peerId = socket.id;
      match.socket.peerName = userName;
      match.socket.peerAvatar = userAvatar;

      socket.join(roomId);
      match.socket.join(roomId);

      // Notify peers
      socket.emit('match-found', {
        roomId: roomId,
        peerId: match.id,
        peerName: match.name,
        peerAvatar: match.avatar,
        initiator: true,
        peerInterests: match.interests
      });

      match.socket.emit('match-found', {
        roomId: roomId,
        peerId: socket.id,
        peerName: userName,
        peerAvatar: userAvatar,
        initiator: false,
        peerInterests: interests
      });
    } else {
      matchmakingQueue.push(queueUser);
      console.log(`[Socket Server] Matchmaking queue size: ${matchmakingQueue.length}`);
    }
  });

  // Cancel matchmaking
  socket.on('leave-matchmaking', () => {
    matchmakingQueue = matchmakingQueue.filter(user => user.id !== socket.id);
  });

  // Relay signals
  socket.on('signal', (data) => {
    const { to, signalData } = data;
    const targetSocket = io.sockets.sockets.get(to);
    if (targetSocket) {
      targetSocket.emit('signal', {
        from: socket.id,
        signalData: signalData
      });
    }
  });

  // Log active call record directly to database when finished
  socket.on('log-call-history', async (data) => {
    const { token, record } = data;
    if (token && record) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const historyLogs = await db.addUserHistoryRecord(decoded.id, record);
        socket.emit('history-logged', { history: historyLogs });
      } catch (err) {
        console.warn('[Socket Server] Failed to log call history:', err.message);
      }
    }
  });

  // End Call
  socket.on('end-call', () => {
    handleCallTermination(socket);
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    matchmakingQueue = matchmakingQueue.filter(user => user.id !== socket.id);
    handleCallTermination(socket);
  });
});

function handleCallTermination(socket) {
  const { roomId, peerId } = socket;
  if (roomId && peerId) {
    const peerSocket = io.sockets.sockets.get(peerId);
    if (peerSocket) {
      peerSocket.emit('peer-left');
      peerSocket.roomId = null;
      peerSocket.peerId = null;
      peerSocket.peerName = null;
      peerSocket.peerAvatar = null;
      peerSocket.leave(roomId);
    }
    socket.roomId = null;
    socket.peerId = null;
    socket.peerName = null;
    socket.peerAvatar = null;
    socket.leave(roomId);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] SafeLink signaling server running on http://localhost:${PORT}`);
});
