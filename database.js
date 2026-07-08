const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'users.json');

// Initialize local JSON database if not exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2), 'utf8');
}

// Read users list from file
function readUsers() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[Database] Error reading users file:', err);
    return [];
  }
}

// Write users list to file
function writeUsers(users) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Error writing users file:', err);
  }
}

// Get user by email
function getUserByEmail(email) {
  if (!email) return null;
  const users = readUsers();
  return users.find(user => user.email.toLowerCase() === email.toLowerCase().trim());
}

// Get user by ID
function getUserById(id) {
  const users = readUsers();
  return users.find(user => user.id === id);
}

// Create a new user
async function createUser({ name, email, password = null, provider = 'email', avatar = null }) {
  const users = readUsers();
  
  // Check duplicate
  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
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
  
  const newUser = {
    id: newUserId,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: passwordHash,
    provider: provider,
    avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
    interests: ['Product Design', 'Cybersecurity', 'AI Ethics'], // Default interests
    history: [], // Default history log
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeUsers(users);

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
function updateUserInterests(userId, interests) {
  const users = readUsers();
  const index = users.findIndex(u => u.id === userId);
  if (index !== -1) {
    users[index].interests = interests;
    writeUsers(users);
    return true;
  }
  return false;
}

// Add call connection history record
function addUserHistoryRecord(userId, record) {
  const users = readUsers();
  const index = users.findIndex(u => u.id === userId);
  if (index !== -1) {
    if (!users[index].history) users[index].history = [];
    users[index].history.unshift(record);
    // Cap at 10 items
    if (users[index].history.length > 10) users[index].history.pop();
    writeUsers(users);
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
