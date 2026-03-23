require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();

const mongoURI = process.env.MONGO_URI;

const client = new MongoClient(mongoURI);

async function connectMongo() {
  try {
    await client.connect();
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

connectMongo();
const DATA_PATH = path.join(__dirname, "admin-store.json");

app.use(cors());
app.use(express.json());

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch (err) {
    console.error("Unable to read store:", err);
    return null;
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Unable to write store:", err);
  }
}

function ensureCurrentUser(store) {
  if (!store.currentUser && store.users && store.users.length > 0) {
    store.currentUser = store.users[0].email || store.users[0].username;
  }
  return store.currentUser;
}

function getUser(store, identifier) {
  return store.users?.find(
    (user) => user.email === identifier || user.username === identifier
  );
}

function getCurrentUser(store) {
  const current = ensureCurrentUser(store);
  return getUser(store, current) || store.users?.[0];
}

function respondSession(res, store) {
  const profileUser = getCurrentUser(store) || {
    email: "",
    username: "",
    coins: 0,
    streak: 0,
    lastPlayed: null,
    bestScores: { math: 0, science: 0, english: 0 }
  };
  return res.json({
    settings: store.settings || { sound: true, notifications: true },
    profile: profileUser,
    bestScores: store.bestScores || { math: 0, science: 0, english: 0 },
    leaderboard: store.leaderboard || [],
    accuracy: store.accuracy || {
      totals: { correct: 0, total: 0 },
      subjects: { math: { correct: 0, total: 0 }, science: { correct: 0, total: 0 }, english: { correct: 0, total: 0 } }
    }
  });
}

app.get("/api/session", (req, res) => {
  const store = readStore();
  if (!store) {
    return res.status(500).json({ error: "Store not found" });
  }
  respondSession(res, store);
});

app.post("/api/admin-login", (req, res) => {
  const { username, password } = req.body;
  const store = readStore();
  if (!store || !store.admin) {
    return res.status(500).json({ error: "Store not configured" });
  }
  if (username === store.admin.username && password === store.admin.password) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Invalid admin credentials" });
});

app.post("/api/user-login", (req, res) => {
  const { email, password } = req.body;
  const store = readStore();
  if (!store || !store.users) {
    return res.status(500).json({ error: "Store not ready" });
  }
  const matching = getUser(store, email);
  if (!matching || matching.password !== password) {
    return res.status(401).json({ error: "Invalid user credentials" });
  }
  store.currentUser = matching.email;
  store.profile = { ...matching };
  writeStore(store);
  return respondSession(res, store);
});

app.post("/api/user-register", (req, res) => {
  const { email, password } = req.body;
  const store = readStore();
  if (!store || !store.users) {
    return res.status(500).json({ error: "Store not ready" });
  }
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Email and strong password required" });
  }
  if (getUser(store, email)) {
    return res.status(409).json({ error: "Account already exists" });
  }
  const username = (email.split("@")[0] || "Player").replace(/[^a-z0-9]/gi, "");
  const newUser = {
    email,
    username,
    password,
    coins: 10,
    streak: 0,
    lastPlayed: null,
    bestScores: { math: 0, science: 0, english: 0 }
  };
  store.users.push(newUser);
  store.currentUser = email;
  store.profile = { ...newUser };
  writeStore(store);
  return respondSession(res, store);
});

app.post("/api/user-coins", (req, res) => {
  const { coins } = req.body;
  const store = readStore();
  if (!store) {
    return res.status(500).json({ error: "Store not ready" });
  }
  const player = getCurrentUser(store);
  if (!player) {
    return res.status(404).json({ error: "Player not found" });
  }
  player.coins = coins;
  store.profile = { ...player };
  writeStore(store);
  respondSession(res, store);
});

app.post("/api/settings", (req, res) => {
  const store = readStore();
  if (!store) {
    return res.status(500).json({ error: "Store not found" });
  }
  store.settings = { ...store.settings, ...req.body };
  writeStore(store);
  res.json(store.settings);
});

app.post("/api/best-score", (req, res) => {
  const { subject, score } = req.body;
  const store = readStore();
  if (!store || !subject || typeof score !== "number") {
    return res.status(400).json({ error: "Invalid payload" });
  }
  store.bestScores[subject] = Math.max(store.bestScores[subject] || 0, score);
  const player = getCurrentUser(store);
  if (player) {
    player.bestScores = player.bestScores || {};
    player.bestScores[subject] = Math.max(player.bestScores[subject] || 0, score);
    player.lastPlayed = new Date().toISOString();
    if (typeof req.body.streak === "number") {
      player.streak = req.body.streak;
    }
    store.profile = { ...player };
  }
  writeStore(store);
  res.json(store.bestScores);
});

app.post("/api/leaderboard", (req, res) => {
  const { name, score, subject } = req.body;
  if (!name || typeof score !== "number") {
    return res.status(400).json({ error: "Name and numeric score required" });
  }
  const store = readStore();
  if (!store) {
    return res.status(500).json({ error: "Store not found" });
  }
  store.leaderboard.unshift({ name, score, subject: subject || "General" });
  store.leaderboard = store.leaderboard.slice(0, 10);
  writeStore(store);
  res.json(store.leaderboard);
});

app.get("/api/leaderboard", (req, res) => {
  const store = readStore();
  if (!store) return res.status(500).json({ error: "Store not found" });
  res.json({ leaderboard: store.leaderboard, accuracy: store.accuracy });
});

app.post("/api/quiz-run", (req, res) => {
  const { name, subject, correct, total } = req.body;
  if (!name || !subject || typeof correct !== "number" || typeof total !== "number") {
    return res.status(400).json({ error: "Invalid run payload" });
  }

  const store = readStore();
  if (!store) return res.status(500).json({ error: "Store not found" });

  const subj = subject.toLowerCase();
  store.accuracy = store.accuracy || {
    totals: { correct: 0, total: 0 },
    subjects: { math: { correct: 0, total: 0 }, science: { correct: 0, total: 0 }, english: { correct: 0, total: 0 } }
  };

  if (!store.accuracy.subjects[subj]) {
    store.accuracy.subjects[subj] = { correct: 0, total: 0 };
  }

  store.accuracy.totals.correct += correct;
  store.accuracy.totals.total += total;
  store.accuracy.subjects[subj].correct += correct;
  store.accuracy.subjects[subj].total += total;

  // leaderboard write-through
  store.leaderboard.unshift({ name, score: correct, subject: subject || "General" });
  store.leaderboard = store.leaderboard.slice(0, 10);

  writeStore(store);
  res.json({ leaderboard: store.leaderboard, accuracy: store.accuracy });
});

app.post("/api/profile", (req, res) => {
  const store = readStore();
  if (!store) {
    return res.status(500).json({ error: "Store not found" });
  }
  store.profile = { ...store.profile, ...req.body };
  const player = getUser(store, store.currentUser);
  if (player) {
    Object.assign(player, store.profile);
  }
  writeStore(store);
  res.json(store.profile);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`EduGame admin server listening on http://localhost:${port}`);
});
