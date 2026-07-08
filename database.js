const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'users.json');

// Initialize local JSON database if not exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2), 'utf8');
}

// Read users list from file
function readUsersLocal() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[Local Database] Error reading users file:', err);
    return [];
  }
}

// Write users list to file
function writeUsersLocal(users) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[Local Database] Error writing users file:', err);
  }
}

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

let useMongo = false;

// Attempt MongoDB Connection, fallback to Local JSON Database on failure
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('[Database] Connected to MongoDB successfully. Using Cloud/Local MongoDB.');
    useMongo = true;
  })
  .catch(err => {
    console.warn('[Database] MongoDB connection failed. Falling back to local JSON database (users.json). Error:', err.message);
    useMongo = false;
  });

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
  if (useMongo) {
    try {
      return await User.findOne({ email: email.toLowerCase().trim() }).lean();
    } catch (err) {
      console.warn('[Database] MongoDB query failed, falling back to local search.');
    }
  }
  const users = readUsersLocal();
  return users.find(user => user.email.toLowerCase() === email.toLowerCase().trim()) || null;
}

// Get user by ID
async function getUserById(id) {
  if (!id) return null;
  if (useMongo) {
    try {
      return await User.findOne({ id }).lean();
    } catch (err) {
      console.warn('[Database] MongoDB query failed, falling back to local search.');
    }
  }
  const users = readUsersLocal();
  return users.find(user => user.id === id) || null;
}

// Create a new user
async function createUser({ name, email, password = null, provider = 'email', avatar = null }) {
  // Check duplicate
  const existing = await getUserByEmail(email);
  if (existing) {
    throw new Error('Email is already registered.');
  }

  let passwordHash = null;
  if (provider === 'email' && password) {
    const salt = await bcrypt.genSalt(10);
    passwordHash = await bcrypt.hash(password, salt);
  }

  const newUserId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const userData = {
    id: newUserId,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: passwordHash,
    provider: provider,
    avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
    interests: ['Product Design', 'Cybersecurity', 'AI Ethics'],
    history: [],
    createdAt: new Date().toISOString()
  };

  if (useMongo) {
    try {
      const newUser = new User(userData);
      await newUser.save();
      return {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        avatar: newUser.avatar,
        provider: newUser.provider,
        interests: newUser.interests
      };
    } catch (err) {
      console.warn('[Database] MongoDB save failed, falling back to saving locally.', err.message);
    }
  }

  const users = readUsersLocal();
  users.push(userData);
  writeUsersLocal(users);

  return {
    id: userData.id,
    name: userData.name,
    email: userData.email,
    avatar: userData.avatar,
    provider: userData.provider,
    interests: userData.interests
  };
}

// Verify password
async function verifyPassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false;
  return await bcrypt.compare(plainPassword, passwordHash);
}

// Update user interests
async function updateUserInterests(userId, interests) {
  if (useMongo) {
    try {
      const result = await User.updateOne({ id: userId }, { $set: { interests } });
      return result.modifiedCount > 0 || result.matchedCount > 0;
    } catch (err) {
      console.warn('[Database] MongoDB update failed, falling back to local update.', err.message);
    }
  }

  const users = readUsersLocal();
  const index = users.findIndex(u => u.id === userId);
  if (index !== -1) {
    users[index].interests = interests;
    writeUsersLocal(users);
    return true;
  }
  return false;
}

// Add call connection history record
async function addUserHistoryRecord(userId, record) {
  if (useMongo) {
    try {
      const user = await User.findOne({ id: userId });
      if (user) {
        if (!user.history) user.history = [];
        user.history.unshift(record);
        if (user.history.length > 10) user.history.pop();
        await user.save();
        return user.history;
      }
    } catch (err) {
      console.warn('[Database] MongoDB update history failed, falling back to local update.', err.message);
    }
  }

  const users = readUsersLocal();
  const index = users.findIndex(u => u.id === userId);
  if (index !== -1) {
    if (!users[index].history) users[index].history = [];
    users[index].history.unshift(record);
    if (users[index].history.length > 10) users[index].history.pop();
    writeUsersLocal(users);
    return users[index].history;
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
