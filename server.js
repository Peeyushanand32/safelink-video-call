const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('./database');
const fs = require('fs');

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

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session token.' });
    }
    
    const user = db.getUserById(decoded.id);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    
    req.user = user;
    next();
  });
}

// ==================== AUTHENTICATION API ROUTES ====================

// 1. Email/Password Signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields (name, email, password) are required.' });
  }

  try {
    const existing = db.getUserByEmail(email);
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
    const user = db.getUserByEmail(email);
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
    let user = db.getUserByEmail(payload.email);
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
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
      interests: req.user.interests,
      history: req.user.history || []
    }
  });
});

// 5. Update user interests in database
app.post('/api/auth/interests', authenticateToken, (req, res) => {
  const { interests } = req.body;
  if (!Array.isArray(interests)) {
    return res.status(400).json({ error: 'Interests must be a valid array of strings.' });
  }

  const success = db.updateUserInterests(req.user.id, interests);
  if (success) {
    res.json({ message: 'Interests updated successfully.', interests });
  } else {
    res.status(500).json({ error: 'Failed to update interests.' });
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
  socket.on('join-matchmaking', (data) => {
    const { token } = data;
    let userId = null;
    let userName = 'Anonymous';
    let userAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`;
    let interests = data.interests || [];

    // Authenticate token if present
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.getUserById(decoded.id);
        if (user) {
          userId = user.id;
          userName = user.name;
          userAvatar = user.avatar;
          interests = user.interests || interests;
        }
      } catch (err) {
        console.warn(`[Socket Server] Token verification failed for socket ${socket.id}:`, err.message);
      }
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
  socket.on('log-call-history', (data) => {
    const { token, record } = data;
    if (token && record) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const historyLogs = db.addUserHistoryRecord(decoded.id, record);
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
