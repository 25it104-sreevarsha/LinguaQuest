# ⚔️ LinguaQuest — Gamified AI Language Learning

> **SIH25104 — Smart Education Theme**
> Powered by **Google Gemini API (FREE — no credit card)**

---

## 🆓 Step 1 — Get your FREE API key (2 minutes)

**No credit card. No payment. Just a Gmail account.**

1. Open → **https://aistudio.google.com**
2. Sign in with any Gmail account
3. Click **"Get API Key"** (top left)
4. Click **"Create API key in new project"**
5. Copy the key — it looks like `AIzaSy...`

> Free limits: **1,000 requests/day, 15/minute** — more than enough for a hackathon demo.

---

## 🚀 Step 2 — Run on your computer

```bash
# Make sure Node.js is installed (https://nodejs.org)
# Then in your project folder:

npm install

# Create your .env file:
cp .env.example .env

# Open .env in any text editor and paste your key:
# VITE_GEMINI_API_KEY=AIzaSy_your_key_here

npm run dev
# → App opens at http://localhost:5173
```

---

## 📤 Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "LinguaQuest - SIH25104"

# Create repo at github.com, then:
git remote add origin https://github.com/YOUR_NAME/linguaquest.git
git branch -M main
git push -u origin main
```

---

## 🌐 Step 4 — Deploy FREE on Vercel

1. Go to **vercel.com** → Sign up with GitHub (free)
2. Click **"New Project"** → import your `linguaquest` repo
3. In **"Environment Variables"** add:
   - Name: `VITE_GEMINI_API_KEY`
   - Value: `AIzaSy_your_key_here`
4. Click **Deploy** → done!

Your live URL: `https://linguaquest-yourname.vercel.app`

---

## 📁 File structure

```
linguaquest/
├── src/
│   ├── App.jsx       ← entire app
│   └── main.jsx      ← entry point
├── index.html
├── vite.config.js
├── package.json
├── .env              ← YOUR key (never commit!)
├── .env.example      ← template
├── .gitignore        ← keeps .env out of GitHub
└── README.md
```

---

## ✅ Features

- 22 languages — pick your native language, then what to learn
- UI text shown in your native language (Hindi, Tamil, Telugu, English)
- Change both languages anytime via ⚙️ settings
- 6 unlockable worlds with AI-generated daily lessons
- RPG branching dialogue scenes with target language NPCs
- Boss battle (10-question HP fight)
- AI Chat partner (4 personas, grammar correction, vocab saving)
- Vocab Vault with flashcards + quiz
- Word Match, Fill the Blank, Typing Race minigames
- XP, coins, streaks, hearts, badges, daily quests
- All progress saved in localStorage

---

## ⚠️ Note on API key safety

The Gemini key is exposed in the browser bundle.
This is **fine for demos and SIH judging**.
For a real production app, move the API call to a backend server.

---

Built for SIH25104 — Smart Education
