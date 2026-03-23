require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri);

let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("edugame");
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB error:", err);
  }
}

function users() {
  return db.collection("users");
}

function stats() {
  return db.collection("stats");
}

let currentUser = null;

////////////////////////
// REGISTER
////////////////////////

app.post("/api/user-register", async (req, res) => {
  const { email, password } = req.body;

  const exists = await users().findOne({ email });

  if (exists) {
    return res.status(400).json({ error: "User exists" });
  }

  const name = email.split("@")[0];

  const newUser = {
    email,
    password,
    name,
    coins: 10,
    streak: 0,
    bestScores: { math: 0, science: 0, english: 0 }
  };

  await users().insertOne(newUser);

  currentUser = email;

  res.json({ success: true });
});

////////////////////////
// LOGIN
////////////////////////

app.post("/api/user-login", async (req, res) => {
  const { email, password } = req.body;

  const user = await users().findOne({ email, password });

  if (!user) {
    return res.status(401).json({ error: "Invalid login" });
  }

  currentUser = email;

  const stat = await stats().findOne({ name: "global" });

  res.json({
    profile: user,
    leaderboard: stat?.leaderboard || [],
    accuracy: stat?.accuracy || {}
  });
});

////////////////////////
// QUIZ RUN (leaderboard + accuracy)
////////////////////////

app.post("/api/quiz-run", async (req, res) => {
  const { name, subject, correct, total } = req.body;

  let stat = await stats().findOne({ name: "global" });

  if (!stat) {
    stat = {
      name: "global",
      leaderboard: [],
      accuracy: {
        totals: { correct: 0, total: 0 },
        subjects: {}
      }
    };
  }

  // accuracy
  stat.accuracy.totals.correct += correct;
  stat.accuracy.totals.total += total;

  if (!stat.accuracy.subjects[subject]) {
    stat.accuracy.subjects[subject] = { correct: 0, total: 0 };
  }

  stat.accuracy.subjects[subject].correct += correct;
  stat.accuracy.subjects[subject].total += total;

  // leaderboard
  stat.leaderboard.unshift({
    name,
    score: correct,
    subject
  });

  stat.leaderboard = stat.leaderboard.slice(0, 10);

  await stats().updateOne(
    { name: "global" },
    { $set: stat },
    { upsert: true }
  );

  res.json(stat);
});

////////////////////////
// GET LEADERBOARD
////////////////////////

app.get("/api/leaderboard", async (req, res) => {
  const stat = await stats().findOne({ name: "global" });

  res.json({
    leaderboard: stat?.leaderboard || [],
    accuracy: stat?.accuracy || {}
  });
});

////////////////////////

const port = process.env.PORT || 3001;

connectDB().then(() => {
  app.listen(port, () => {
    console.log("Server running on", port);
  });
});

app.use(express.static("public"));
app.use(express.json());