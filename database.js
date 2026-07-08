const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Load configurations to get MONGODB_URI
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
if (fs.existsSync(CONFIG_PATH)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[Database Config] Failed to parse config.json');
  }
}

const MONGODB_URI = process.env.MONGODB_URI || config.MONGODB_URI || 'mongodb://127.0.0.1:27017/safelink';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('[Database] Connected to MongoDB successfully.'))
  .catch(err => console.error('[Database] MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, default: null },
  provider: { type: String, default: 'email' },
  avatar: { type: String },
  interests: { type: [String], default: ['Product Design', 'Cybersecurity', 'AI Ethics'] },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Get user by email
async function getUserByEmail(email) {
  if (!email) return null;
  return await User.findOne({ email: email.toLowerCase().trim() }).lean();
}

// Get user by ID
async function getUserById(id) {
  if (!id) return null;
  return await User.findOne({ id }).lean();
}

// Create a new user
async function createUser({ name, email, password = null, provider = 'email', avatar = null }) {
  // Check duplicate
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    throw new Error('Email is already registered.');
  }

  let passwordHash = null;
  if (provider === 'email' && password) {
    // Hash password with bcryptjs
    const salt = await bcrypt.genSalt(10);
    passwordHash = await bcrypt.hash(password, salt);
  }

  // Create unique ID
  const newUserId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const newUser = new User({
    id: newUserId,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: passwordHash,
    provider: provider,
    avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
    interests: ['Product Design', 'Cybersecurity', 'AI Ethics'], // Default interests
    history: []
  });

  await newUser.save();

  return {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    avatar: newUser.avatar,
    provider: newUser.provider,
    interests: newUser.interests
  };
}

// Verify password
async function verifyPassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false;
  return await bcrypt.compare(plainPassword, passwordHash);
}

// Update user interests
async function updateUserInterests(userId, interests) {
  const result = await User.updateOne({ id: userId }, { $set: { interests } });
  return result.modifiedCount > 0 || result.matchedCount > 0;
}

// Add call connection history record
async function addUserHistoryRecord(userId, record) {
  const user = await User.findOne({ id: userId });
  if (user) {
    if (!user.history) user.history = [];
    user.history.unshift(record);
    // Cap at 10 items
    if (user.history.length > 10) user.history.pop();
    await user.save();
    return user.history;
  }
  return [];
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  verifyPassword,
  updateUserInterests,
  addUserHistoryRecord
};
