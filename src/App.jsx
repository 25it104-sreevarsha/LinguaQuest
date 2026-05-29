import { useState, useEffect, useRef, useCallback } from "react";

// =============================================================================
// CONFIG — paste your free GROQ key in .env as VITE_GROQ_API_KEY
// Get it FREE at https://console.groq.com (no credit card required)
// =============================================================================
const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Validate API key on startup
if (!GROQ_KEY) {
  console.warn("⚠️ VITE_GROQ_API_KEY is not set. API calls will fail. Please add it to .env file.");
}

// Call GROQ API. system = instruction string, messages = [{role,content}]
async function ask(system, userText) {
  if (!GROQ_KEY) throw new Error("API key not configured. Add VITE_GROQ_API_KEY to .env");
  
  const body = {
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: system,
      },
      {
        role: "user",
        content: userText,
      },
    ],
    temperature: 0.7,
    max_tokens: 800,
  };

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const d = await res.json();

    if (d.error) throw new Error(d.error.message);
    if (!d.choices || !d.choices[0] || !d.choices[0].message) throw new Error("Invalid API response format");

    return d.choices[0].message.content.trim() || "";
  } catch (e) {
    throw new Error(`API Error: ${e.message}`);
  }
}
// Multi-turn chat with GROQ
async function chat(system, history) {
  if (!GROQ_KEY) throw new Error("API key not configured. Add VITE_GROQ_API_KEY to .env");
  
  const body = {
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: system,
      },
      ...history.slice(-10).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ],
    temperature: 0.8,
    max_tokens: 600,
  };

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const d = await res.json();

    if (d.error) throw new Error(d.error.message);
    if (!d.choices || !d.choices[0] || !d.choices[0].message) throw new Error("Invalid API response format");

    return d.choices[0].message.content.trim() || "";
  } catch (e) {
    throw new Error(`API Error: ${e.message}`);
  }
}

// Parse JSON from AI response - with auto-correction of common errors
function parseJSON(text) {
  if (!text || typeof text !== "string") throw new Error("Invalid input for JSON parsing");
  
  let clean = text.trim();
  
  // Remove markdown code fences and common prefixes
  clean = clean.replace(/```json\s*\n?|```\s*\n?/g, "").trim();
  clean = clean.replace(/^[^[\{]*/, "").trim(); // Remove any prefix before [ or {
  
  // Strategy 1: Try direct parse (works if AI returns perfect JSON)
  try {
    return JSON.parse(clean);
  } catch (e1) {
    // Continue with fixes
  }
  
  // Strategy 2: Extract and clean JSON structure
  let startPos = -1;
  let isArray = false;
  
  // Find first [ or {
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '[') {
      startPos = i;
      isArray = true;
      break;
    } else if (clean[i] === '{') {
      startPos = i;
      isArray = false;
      break;
    }
  }
  
  if (startPos === -1) throw new Error("No JSON structure found");
  
  // Extract JSON by counting brackets
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let endPos = -1;
  
  for (let i = startPos; i < clean.length; i++) {
    const char = clean[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && (i === 0 || clean[i-1] !== '\\')) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === (isArray ? '[' : '{')) {
        bracketCount++;
      } else if (char === (isArray ? ']' : '}')) {
        bracketCount--;
        if (bracketCount === 0) {
          endPos = i + 1;
          break;
        }
      }
    }
  }
  
  if (endPos === -1) throw new Error("Mismatched JSON brackets");
  
  let extracted = clean.substring(startPos, endPos);
  
  // Strategy 3: Fix common JSON errors
  try {
    return JSON.parse(extracted);
  } catch (e2) {
    // Try auto-fixing common issues
    
    // Fix: trailing commas before ] or }
    extracted = extracted.replace(/,\s*([}\]])/g, '$1');
    
    // Fix: single quotes to double quotes (in object keys and some string values)
    extracted = extracted.replace(/'([^']*?)'/g, '"$1"');
    
    // Fix: unescaped quotes within strings (replace " with \" when not already escaped)
    // This is tricky - only fix quotes that appear to be inside string values
    extracted = extracted.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
      let fixed = match.replace(/(?<!\\)"/g, '\\"');
      return fixed;
    });
    
    // Fix: missing commas between array/object elements
    extracted = extracted.replace(/}\s*{/g, '},{');
    extracted = extracted.replace(/]\s*{/g, '],[');
    extracted = extracted.replace(/}\s*\[/g, '},{');
    
    try {
      return JSON.parse(extracted);
    } catch (e3) {
      // Strategy 4: Last resort - try to salvage by removing problematic characters
      let sanitized = extracted
        .replace(/[\n\r\t]/g, ' ') // Remove whitespace chars
        .replace(/\s+/g, ' ') // Normalize spaces
        .replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas again
      
      try {
        return JSON.parse(sanitized);
      } catch (e4) {
        // If all else fails, log and throw with context
        console.error("JSON parse failed after auto-fix attempts");
        console.error("Original:", text.substring(0, 300));
        console.error("Extracted:", extracted.substring(0, 300));
        console.error("Final attempt:", sanitized.substring(0, 300));
        console.error("Errors:", e1.message, e2.message, e3.message, e4.message);
        throw new Error(`JSON parsing failed: ${e4.message}`);
      }
    }
  }
}

// =============================================================================
// DATA
// =============================================================================
const LANGUAGES = [
  { code: "en", label: "English",    native: "English",    flag: "🇬🇧" },
  { code: "hi", label: "Hindi",      native: "हिन्दी",     flag: "🇮🇳" },
  { code: "ta", label: "Tamil",      native: "தமிழ்",      flag: "🇮🇳" },
  { code: "te", label: "Telugu",     native: "తెలుగు",     flag: "🇮🇳" },
  { code: "bn", label: "Bengali",    native: "বাংলা",      flag: "🇧🇩" },
  { code: "mr", label: "Marathi",    native: "मराठी",      flag: "🇮🇳" },
  { code: "kn", label: "Kannada",    native: "ಕನ್ನಡ",      flag: "🇮🇳" },
  { code: "ml", label: "Malayalam",  native: "മലയാളം",     flag: "🇮🇳" },
  { code: "gu", label: "Gujarati",   native: "ગુજરાતી",    flag: "🇮🇳" },
  { code: "pa", label: "Punjabi",    native: "ਪੰਜਾਬੀ",     flag: "🇮🇳" },
  { code: "ur", label: "Urdu",       native: "اردو",       flag: "🇵🇰" },
  { code: "ja", label: "Japanese",   native: "日本語",      flag: "🇯🇵" },
  { code: "ko", label: "Korean",     native: "한국어",      flag: "🇰🇷" },
  { code: "zh", label: "Chinese",    native: "中文",        flag: "🇨🇳" },
  { code: "es", label: "Spanish",    native: "Español",    flag: "🇪🇸" },
  { code: "fr", label: "French",     native: "Français",   flag: "🇫🇷" },
  { code: "de", label: "German",     native: "Deutsch",    flag: "🇩🇪" },
  { code: "ar", label: "Arabic",     native: "العربية",    flag: "🇸🇦" },
  { code: "pt", label: "Portuguese", native: "Português",  flag: "🇧🇷" },
  { code: "ru", label: "Russian",    native: "Русский",    flag: "🇷🇺" },
];

const WORLDS = [
  { id: "basics",   icon: "🏠", name: "Home Town",      color: "#4ECDC4", req: 0,    topic: "basic greetings, introductions, numbers 1-10, colors" },
  { id: "food",     icon: "🍜", name: "Food District",  color: "#FF6B6B", req: 100,  topic: "ordering food, restaurant phrases, common foods, drinks" },
  { id: "travel",   icon: "✈️", name: "Airport",         color: "#A855F7", req: 300,  topic: "travel, directions, hotel check-in, asking for help" },
  { id: "social",   icon: "🎉", name: "Social Hub",     color: "#F59E0B", req: 600,  topic: "making friends, hobbies, slang, casual conversation" },
  { id: "business", icon: "🏢", name: "Business Tower", color: "#3B82F6", req: 1000, topic: "workplace phrases, meetings, emails, professional greetings" },
  { id: "culture",  icon: "🎎", name: "Culture Palace", color: "#EC4899", req: 1500, topic: "culture, festivals, history, traditional phrases" },
];

const BADGES = [
  { id: "first_lesson", icon: "⚡", name: "First Steps"  },
  { id: "streak_3",     icon: "🔥", name: "On Fire"      },
  { id: "vocab_10",     icon: "📖", name: "Word Hoarder" },
  { id: "perfect",      icon: "💯", name: "Perfectionist"},
  { id: "boss_win",     icon: "⚔️",  name: "Boss Slayer"  },
  { id: "rpg_done",     icon: "🎭", name: "Actor"        },
];

// =============================================================================
// GLOBAL STYLES
// =============================================================================
if (!document.getElementById("lq-css")) {
  const s = document.createElement("style");
  s.id = "lq-css";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080812; font-family: 'Nunito', sans-serif; }
    input, button, textarea { outline: none; font-family: 'Nunito', sans-serif; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 2px; }
    @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
    @keyframes float   { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-10px); } }
    @keyframes blink   { 0%,80%,100% { opacity:0; } 40% { opacity:1; } }
    @keyframes shake   { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-8px); } 75% { transform:translateX(8px); } }
    @keyframes spin    { to { transform:rotate(360deg); } }
    .lq-btn { border:none; border-radius:12px; font-weight:700; font-size:14px; cursor:pointer; padding:11px 20px; transition:opacity 0.15s; }
    .lq-btn:hover { opacity:0.85; }
    .lq-btn:disabled { opacity:0.35; cursor:default; }
    .lq-card { background:#0f0f1a; border:1px solid #1e1e30; border-radius:16px; padding:1.25rem; }
    .lq-close { background:#131325; border:1px solid #2a2a3e; color:#888; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:13px; }
    .overlay-bg { position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:50; display:flex; align-items:flex-end; justify-content:center; }
    .overlay-box { background:#0d0d1a; border:1px solid #1e1e30; border-radius:20px 20px 0 0; padding:1.5rem; width:100%; max-width:600px; max-height:88vh; overflow-y:auto; }
  `;
  document.head.appendChild(s);
}

// =============================================================================
// ROOT APP
// =============================================================================
export default function App() {
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };

  const [screen,  setScreen]  = useState(() => ls("lq_screen", "splash"));
  const [native,  setNative]  = useState(() => ls("lq_native", null));   // {code,label,native,flag}
  const [target,  setTarget]  = useState(() => ls("lq_target", null));   // {code,label,native,flag}
  const [setupStep, setSetupStep] = useState("step1");

  const [xp,      setXp]      = useState(() => ls("lq_xp",     0));
  const [coins,   setCoins]   = useState(() => ls("lq_coins",  150));
  const [streak,  setStreak]  = useState(() => ls("lq_streak", 0));
  const [hearts,  setHearts]  = useState(5);
  const [badges,  setBadges]  = useState(() => ls("lq_badges", []));
  const [vault,   setVault]   = useState(() => ls("lq_vault",  []));
  const [wProg,   setWProg]   = useState(() => ls("lq_wprog",  {}));
  const [quests,  setQuests]  = useState(() => ls("lq_quests", [
    { id:"lesson",   icon:"📚", text:"Complete 1 lesson",    xp:30, done:false },
    { id:"chat",     icon:"💬", text:"Chat with AI partner", xp:25, done:false },
    { id:"minigame", icon:"🎮", text:"Play a minigame",      xp:15, done:false },
    { id:"vocab",    icon:"📝", text:"Save 3 words",         xp:20, done:false },
  ]));

  const [tab,       setTab]     = useState("map");
  const [selWorld,  setSelWorld]= useState("basics");
  const [overlay,   setOverlay] = useState(null); // {type:"lesson"|"rpg"|"boss", world?}
  const [toast,     setToast]   = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const level     = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  const unlocked  = WORLDS.filter(w => xp >= w.req);

  // Persist
  useEffect(() => { localStorage.setItem("lq_screen",  JSON.stringify(screen));  }, [screen]);
  useEffect(() => { localStorage.setItem("lq_native",  JSON.stringify(native));  }, [native]);
  useEffect(() => { localStorage.setItem("lq_target",  JSON.stringify(target));  }, [target]);
  useEffect(() => { localStorage.setItem("lq_xp",      JSON.stringify(xp));      }, [xp]);
  useEffect(() => { localStorage.setItem("lq_coins",   JSON.stringify(coins));   }, [coins]);
  useEffect(() => { localStorage.setItem("lq_streak",  JSON.stringify(streak));  }, [streak]);
  useEffect(() => { localStorage.setItem("lq_badges",  JSON.stringify(badges));  }, [badges]);
  useEffect(() => { localStorage.setItem("lq_vault",   JSON.stringify(vault));   }, [vault]);
  useEffect(() => { localStorage.setItem("lq_wprog",   JSON.stringify(wProg));   }, [wProg]);
  useEffect(() => { localStorage.setItem("lq_quests",  JSON.stringify(quests));  }, [quests]);

  // Splash
  useEffect(() => {
    if (screen === "splash") {
      const t = setTimeout(() => setScreen(native && target ? "home" : "setup"), 2000);
      return () => clearTimeout(t);
    }
  }, [screen, native, target]);

  const notify = useCallback((msg, type = "xp") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const earnXp = useCallback((n) => { setXp(p => p + n); notify(`+${n} XP ✨`); }, [notify]);
  const earnCoins = useCallback((n) => setCoins(p => p + n), []);

  const grantBadge = useCallback((id) => {
    setBadges(prev => {
      if (prev.includes(id)) return prev;
      const b = BADGES.find(x => x.id === id);
      if (b) setToast({ msg: `🏆 Badge: ${b.name}!`, type: "badge" });
      return [...prev, id];
    });
  }, []);

  const doneQuest = useCallback((id) => {
    setQuests(prev => prev.map(q => {
      if (q.id === id && !q.done) {
        setXp(p => p + q.xp);
        setToast({ msg: `⚡ Quest done! +${q.xp} XP`, type: "quest" });
        return { ...q, done: true };
      }
      return q;
    }));
  }, []);

  const saveWord = useCallback((word, meaning) => {
    setVault(prev => {
      if (prev.find(v => v.word === word)) return prev;
      const next = [...prev, { word, meaning, ts: Date.now() }];
      if (next.length >= 3) doneQuest("vocab");
      if (next.length >= 10) grantBadge("vocab_10");
      return next;
    });
    notify(`📖 "${word}" saved!`, "vocab");
  }, [doneQuest, grantBadge, notify]);

  if (screen === "splash") return <Splash />;
  if (screen === "setup") return (
    <Setup step={setupStep} native={native}
      onNative={l => { setNative(l); setSetupStep("step2"); }}
      onTarget={l => { setTarget(l); setStreak(1); setScreen("home"); }}
      onBack={() => setSetupStep("step1")}
    />
  );

  const aw = WORLDS.find(w => w.id === selWorld);

  return (
    <div style={{ height:"100vh", background:"#080812", color:"#fff", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* ── HUD ── */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:"#0f0f1a", borderBottom:"1px solid #1e1e30", flexShrink:0 }}>
        <span style={{ padding:"3px 8px", borderRadius:8, background:"#ff6b1a22", border:"1px solid #ff6b1a44", fontSize:12, fontWeight:700, color:"#ff9b4e" }}>🔥{streak}</span>
        <div style={{ display:"flex", gap:1 }}>{[...Array(5)].map((_,i) => <span key={i} style={{ fontSize:12, opacity:i<hearts?1:0.2 }}>❤️</span>)}</div>
        <div style={{ flex:1, padding:"0 6px" }}>
          <div style={{ fontSize:10, color:"#888", textAlign:"center", marginBottom:2 }}>Lv.{level} · {xpInLevel}/100 XP</div>
          <div style={{ height:5, background:"#1e1e30", borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", background:"linear-gradient(90deg,#6ee7b7,#3b82f6)", width:`${xpInLevel}%`, transition:"width 0.5s" }} />
          </div>
        </div>
        <span style={{ padding:"3px 8px", borderRadius:8, background:"#f59e0b22", border:"1px solid #f59e0b44", fontSize:12, fontWeight:700, color:"#f59e0b" }}>🪙{coins}</span>
        <button onClick={() => setShowSettings(true)} style={{ background:"transparent", border:"none", fontSize:18, cursor:"pointer", color:"#666" }}>⚙️</button>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ flex:1, overflowY:"auto" }}>
        {tab === "map"      && <MapTab worlds={WORLDS} unlocked={unlocked} selWorld={selWorld} setSelWorld={setSelWorld} wProg={wProg} quests={quests} onLesson={() => setOverlay({type:"lesson", world:aw})} onRPG={() => setOverlay({type:"rpg", world:aw})} />}
        {tab === "chat"     && <ChatTab native={native} target={target} onXp={earnXp} onSaveWord={saveWord} onDoneQuest={doneQuest} />}
        {tab === "vocab"    && <VaultTab vault={vault} target={target} onXp={earnXp} />}
        {tab === "minigame" && <GamesTab native={native} target={target} onXp={earnXp} onCoins={earnCoins} onDoneQuest={doneQuest} onBadge={grantBadge} onBoss={() => setOverlay({type:"boss"})} />}
        {tab === "profile"  && <ProfileTab xp={xp} coins={coins} streak={streak} level={level} badges={badges} quests={quests} vault={vault} native={native} target={target} />}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{ display:"flex", background:"#0f0f1a", borderTop:"1px solid #1e1e30", flexShrink:0 }}>
        {[["map","🗺️","Map"],["chat","💬","Chat"],["vocab","📖","Vault"],["minigame","🎮","Games"],["profile","👤","Profile"]].map(([id,icon,label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ flex:1, padding:"10px 4px 8px", display:"flex", flexDirection:"column", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", borderTop: tab===id ? "2px solid #6ee7b7" : "2px solid transparent" }}>
            <span style={{ fontSize:20 }}>{icon}</span>
            <span style={{ fontSize:9, marginTop:2, color:tab===id?"#6ee7b7":"#555" }}>{label}</span>
          </button>
        ))}
      </div>

      {/* ── OVERLAYS ── */}
      {overlay?.type === "lesson" && (
        <LessonOverlay world={overlay.world} native={native} target={target}
          onClose={() => setOverlay(null)}
          onDone={(score) => {
            earnXp(40 + Math.round(score * 40));
            earnCoins(10 + Math.round(score * 15));
            setWProg(p => ({ ...p, [overlay.world.id]: (p[overlay.world.id]||0)+1 }));
            doneQuest("lesson");
            if (score === 1) grantBadge("perfect");
            grantBadge("first_lesson");
            setOverlay(null);
          }}
        />
      )}
      {overlay?.type === "rpg" && (
        <RPGOverlay world={overlay.world} native={native} target={target}
          onClose={() => setOverlay(null)}
          onDone={() => { earnXp(80); earnCoins(25); grantBadge("rpg_done"); setOverlay(null); }}
        />
      )}
      {overlay?.type === "boss" && (
        <BossOverlay native={native} target={target}
          onClose={() => setOverlay(null)}
          onDone={(won) => { if(won){earnXp(100);earnCoins(40);grantBadge("boss_win");} doneQuest("minigame"); setOverlay(null); }}
        />
      )}

      {/* ── SETTINGS ── */}
      {showSettings && (
        <SettingsModal native={native} target={target}
          onSave={(n,tg) => { setNative(n); setTarget(tg); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{ position:"fixed", top:60, left:"50%", transform:"translateX(-50%)", padding:"9px 20px", borderRadius:24, fontWeight:700, fontSize:13, whiteSpace:"nowrap", zIndex:999, pointerEvents:"none", animation:"fadeUp 0.3s ease",
          background: toast.type==="badge"?"#a855f7": toast.type==="quest"?"#f59e0b": toast.type==="vocab"?"#3b82f6":"#6ee7b7",
          color: toast.type==="xp"?"#064e3b":"#fff" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SPLASH
// =============================================================================
function Splash() {
  return (
    <div style={{ height:"100vh", background:"#080812", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:72, animation:"float 1.8s ease-in-out infinite" }}>⚔️</div>
      <div style={{ fontSize:"clamp(2rem,8vw,3.5rem)", fontWeight:900, background:"linear-gradient(135deg,#6ee7b7,#3b82f6,#a855f7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>LinguaQuest</div>
      <div style={{ color:"#888", fontSize:15 }}>Level up your language</div>
      <div style={{ display:"flex", gap:6, marginTop:16 }}>{[0,1,2].map(i=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:"#6ee7b7",animation:`blink 1.2s ease ${i*0.2}s infinite` }}/>)}</div>
    </div>
  );
}

// =============================================================================
// SETUP — choose native then target
// =============================================================================
function Setup({ step, native, onNative, onTarget, onBack }) {
  const isStep1 = step === "step1";
  const langs   = isStep1 ? LANGUAGES : LANGUAGES.filter(l => l.code !== native?.code);
  const title   = isStep1 ? "What language do you speak?" : "What do you want to learn?";
  const sub     = isStep1 ? "Your native language" : `You speak ${native?.label} — now pick your target`;

  return (
    <div style={{ minHeight:"100vh", background:"#080812", color:"#fff", overflowY:"auto" }}>
      <div style={{ maxWidth:640, margin:"0 auto", padding:"2rem 1rem" }}>
        {/* Steps */}
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:"1.5rem" }}>
          {[1,2].map(n => <div key={n} style={{ height:8, width: (isStep1?n===1:n===2)?28:8, borderRadius:4, background:(isStep1?n<=1:n<=2)?"#6ee7b7":"#1e1e30", transition:"all 0.3s" }}/>)}
        </div>
        {!isStep1 && <button onClick={onBack} style={{ marginBottom:14 }} className="lq-close">← Back</button>}
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <div style={{ fontSize:"clamp(1.4rem,5vw,2rem)", fontWeight:900, background:"linear-gradient(135deg,#6ee7b7,#3b82f6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>{title}</div>
          <p style={{ color:"#888", fontSize:14, marginTop:6 }}>{sub}</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))", gap:10 }}>
          {langs.map(l => (
            <div key={l.code} onClick={() => isStep1 ? onNative(l) : onTarget(l)}
              style={{ background:"#0f0f1a", borderRadius:14, padding:"1.1rem 0.8rem", textAlign:"center", cursor:"pointer", border:"2px solid #1e1e30", transition:"all 0.18s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor="#6ee7b7"}
              onMouseLeave={e => e.currentTarget.style.borderColor="#1e1e30"}>
              <div style={{ fontSize:30 }}>{l.flag}</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#fff", marginTop:6 }}>{l.native}</div>
              <div style={{ fontSize:11, color:"#888", marginTop:2 }}>{l.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SETTINGS MODAL
// =============================================================================
function SettingsModal({ native, target, onSave, onClose }) {
  const [sn, setSn] = useState(native);
  const [st, setSt] = useState(target);
  const [open, setOpen] = useState(null);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }} onClick={onClose}>
      <div style={{ background:"#0d0d1a", border:"1px solid #1e1e30", borderRadius:20, padding:"1.5rem", width:"min(460px,100%)", maxHeight:"80vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontWeight:700, fontSize:16 }}>⚙️ Settings</span>
          <button onClick={onClose} className="lq-close">✕</button>
        </div>
        {[{label:"Native language", val:sn, set:setSn, key:"n"},{label:"Learning language", val:st, set:setSt, key:"t"}].map(item => (
          <div key={item.key} style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#666", marginBottom:5 }}>{item.label}</div>
            <button onClick={() => setOpen(open===item.key?null:item.key)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:10, background:"#131325", border:"1px solid #2a2a3e", color:"#fff", cursor:"pointer" }}>
              <span style={{ fontSize:22 }}>{item.val?.flag}</span>
              <span style={{ flex:1, textAlign:"left", fontSize:14 }}>{item.val?.native} ({item.val?.label})</span>
              <span style={{ color:"#555" }}>{open===item.key?"▴":"▾"}</span>
            </button>
            {open===item.key && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginTop:6, maxHeight:200, overflowY:"auto" }}>
                {LANGUAGES.filter(l => item.key==="t" ? l.code!==sn?.code : true).map(l => (
                  <div key={l.code} onClick={() => { item.set(l); setOpen(null); }}
                    style={{ padding:"8px 4px", borderRadius:8, textAlign:"center", cursor:"pointer", background:item.val?.code===l.code?"#6ee7b722":"#1e1e30", border:`1px solid ${item.val?.code===l.code?"#6ee7b7":"#2a2a3e"}` }}>
                    <div style={{ fontSize:20 }}>{l.flag}</div>
                    <div style={{ fontSize:10, color:"#ccc", marginTop:2 }}>{l.native}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <button className="lq-btn" onClick={() => sn&&st&&sn.code!==st.code&&onSave(sn,st)}
          style={{ background:"#6ee7b7", color:"#064e3b", width:"100%", marginTop:6 }}>
          Save Changes
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// MAP TAB
// =============================================================================
function MapTab({ worlds, unlocked, selWorld, setSelWorld, wProg, quests, onLesson, onRPG }) {
  const aw = worlds.find(w => w.id === selWorld);
  const isUnlocked = !!unlocked.find(w => w.id === selWorld);

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ fontSize:13, color:"#aaa", marginBottom:10 }}>🗺️ World Map</div>
      {/* World scroll */}
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8, marginBottom:14 }}>
        {worlds.map(w => {
          const ok = !!unlocked.find(u => u.id===w.id);
          const prog = Math.min((wProg[w.id]||0)*10, 100);
          return (
            <div key={w.id} onClick={() => ok && setSelWorld(w.id)}
              style={{ flexShrink:0, width:90, textAlign:"center", padding:"10px 6px", borderRadius:14, cursor:ok?"pointer":"default", opacity:ok?1:0.4,
                border:`2px solid ${selWorld===w.id?w.color:"#1e1e30"}`, background:selWorld===w.id?w.color+"22":"#0f0f1a", transition:"all 0.2s" }}>
              <div style={{ fontSize:26 }}>{ok?w.icon:"🔒"}</div>
              <div style={{ fontSize:10, color:"#ccc", marginTop:4, fontWeight:700 }}>{w.name}</div>
              {!ok && <div style={{ fontSize:9, color:"#555", marginTop:2 }}>{w.req} XP</div>}
              {ok && prog>0 && <div style={{ marginTop:4, height:3, background:"#1e1e30", borderRadius:2 }}><div style={{ height:"100%", background:w.color, width:`${prog}%`, borderRadius:2 }}/></div>}
            </div>
          );
        })}
      </div>
      {/* Active world */}
      {aw && isUnlocked && (
        <div className="lq-card" style={{ border:`1px solid ${aw.color}44`, marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <span style={{ fontSize:32 }}>{aw.icon}</span>
            <div>
              <div style={{ fontSize:17, fontWeight:800, color:aw.color }}>{aw.name}</div>
              <div style={{ fontSize:12, color:"#888" }}>{aw.topic}</div>
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#666", marginBottom:3 }}>Progress: {wProg[aw.id]||0}/10</div>
            <div style={{ height:5, background:"#1e1e30", borderRadius:3 }}>
              <div style={{ height:"100%", background:aw.color, width:`${Math.min((wProg[aw.id]||0)*10,100)}%`, borderRadius:3, transition:"width 0.5s" }}/>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <button className="lq-btn" onClick={onLesson} style={{ background:aw.color, color:"#000" }}>📚 Daily Lesson</button>
            <button className="lq-btn" onClick={onRPG}    style={{ background:"#1e1e30", color:aw.color, border:`1px solid ${aw.color}` }}>⚔️ RPG Scene</button>
          </div>
        </div>
      )}
      {/* Daily quests */}
      <div className="lq-card">
        <div style={{ fontSize:13, fontWeight:700, color:"#f59e0b", marginBottom:10 }}>⚡ Daily Quests</div>
        {quests.map(q => (
          <div key={q.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:"1px solid #131325" }}>
            <span style={{ fontSize:16, opacity:q.done?0.4:1 }}>{q.icon}</span>
            <span style={{ flex:1, fontSize:13, color:q.done?"#555":"#ccc", textDecoration:q.done?"line-through":"none" }}>{q.text}</span>
            <span style={{ fontSize:12, color:q.done?"#444":"#f59e0b" }}>+{q.xp}</span>
            {q.done && <span>✅</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// LESSON OVERLAY  — questions in native language, options in target language
// =============================================================================
function LessonOverlay({ world, native, target, onClose, onDone }) {
  const [phase, setPhase]     = useState("loading");
  const [qs,    setQs]        = useState([]);
  const [idx,   setIdx]       = useState(0);
  const [sel,   setSel]       = useState(null);
  const [ok,    setOk]        = useState(0);
  const [showA, setShowA]     = useState(false);
  const [shake, setShake]     = useState(false);
  const [err,   setErr]       = useState("");

  useEffect(() => {
    const sys = `Generate 5 multiple-choice questions. CRITICAL RULES:
- Return ONLY a JSON array
- NO other text before or after JSON
- NO markdown code blocks
- Each question object must have: q, options (array of 4), answer (0-3), explanation
- NEVER use unescaped quotes in strings
- NEVER add commas after the last array element
- Question in ${native.label}
- Options in ${target.label} (all 4 options)
- Explanation in ${native.label}
- Topic: ${world.topic}

Output format EXACTLY:
[{"q":"Q1","options":["A","B","C","D"],"answer":0,"explanation":"E1"},{"q":"Q2","options":["A","B","C","D"],"answer":1,"explanation":"E2"}]`;

    ask(sys, `Generate 5 questions. Languages: ${native.label} and ${target.label}.`)
      .then(text => {
        try {
          const data = parseJSON(text);
          if (!Array.isArray(data) || data.length === 0) {
            throw new Error("Response is not a valid array");
          }
          // Validate each question has required fields
          for (let i = 0; i < data.length; i++) {
            const q = data[i];
            if (!q.q || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.answer !== "number" || !q.explanation) {
              throw new Error(`Question ${i} is invalid: missing required fields`);
            }
          }
          setQs(data.slice(0, 5));
          setPhase("quiz");
        } catch (parseErr) {
          console.error("Lesson parse error:", parseErr.message);
          console.error("Raw response first 500 chars:", text.substring(0, 500));
          throw parseErr;
        }
      })
      .catch(e => { 
        setErr(e.message); 
        setPhase("error"); 
      });
  }, [native.label, target.label, world.topic]);

  const q      = qs[idx];
  const isLast = idx === qs.length - 1;
  const score  = qs.length > 0 ? ok / qs.length : 0;

  const pick = (i) => {
    if (sel !== null) return;
    setSel(i); setShowA(true);
    if (i === q.answer) setOk(c => c + 1);
    else { setShake(true); setTimeout(() => setShake(false), 500); }
  };

  const next = () => {
    if (isLast) setPhase("result");
    else { setIdx(i => i+1); setSel(null); setShowA(false); }
  };

  return (
    <div className="overlay-bg">
      <div className="overlay-box">
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"1.2rem" }}>
          <button onClick={onClose} className="lq-close">✕ Close</button>
          <span style={{ flex:1, fontWeight:700, color:world.color, fontSize:14 }}>{world.icon} {world.name} — Lesson</span>
          {phase==="quiz" && <span style={{ fontSize:12, color:"#888" }}>{idx+1}/{qs.length}</span>}
        </div>

        {phase==="loading" && <Loader text="Generating your lesson..." />}
        {phase==="error"   && <ErrBox msg={err} onRetry={onClose} />}

        {phase==="quiz" && q && (
          <div style={{ animation:"fadeUp 0.3s ease" }}>
            <div style={{ height:4, background:"#1e1e30", borderRadius:2, marginBottom:18, overflow:"hidden" }}>
              <div style={{ height:"100%", background:world.color, width:`${(idx/qs.length)*100}%`, transition:"width 0.4s" }}/>
            </div>
            {/* Question is in native language */}
            <div style={{ fontSize:13, color:"#888", marginBottom:4 }}>Translate to {target.label}:</div>
            <div style={{ fontSize:20, fontWeight:800, color:"#fff", marginBottom:18, lineHeight:1.4 }}>{q.q}</div>
            {/* Options in target language */}
            <div style={{ display:"flex", flexDirection:"column", gap:9, animation:shake?"shake 0.4s ease":"none" }}>
              {q.options.map((opt, i) => {
                let bg="#131325", border="#2a2a3e", col="#ccc";
                if (showA) {
                  if (i===q.answer)           { bg="#064e3b"; border="#6ee7b7"; col="#6ee7b7"; }
                  else if (i===sel && i!==q.answer) { bg="#450a0a"; border="#f87171"; col="#f87171"; }
                }
                return (
                  <button key={i} onClick={() => pick(i)}
                    style={{ padding:"13px 16px", borderRadius:12, background:bg, border:`2px solid ${border}`, color:col, fontSize:16, cursor:sel===null?"pointer":"default", textAlign:"left", transition:"all 0.2s" }}>
                    <b style={{ marginRight:8 }}>{["A","B","C","D"][i]}.</b>{opt}
                  </button>
                );
              })}
            </div>
            {showA && (
              <>
                <div style={{ marginTop:14, padding:"10px 14px", borderRadius:10, fontSize:13,
                  background:sel===q.answer?"#064e3b":"#450a0a", color:sel===q.answer?"#6ee7b7":"#f87171" }}>
                  {sel===q.answer ? "✅ Correct! " : `❌ Wrong. Answer: ${q.options[q.answer]}. `}
                  {q.explanation}
                </div>
                <button className="lq-btn" onClick={next}
                  style={{ background:world.color, color:"#000", width:"100%", marginTop:12, padding:"13px" }}>
                  {isLast ? "See Results →" : "Next →"}
                </button>
              </>
            )}
          </div>
        )}

        {phase==="result" && (
          <div style={{ textAlign:"center", animation:"fadeUp 0.4s ease" }}>
            <div style={{ fontSize:64 }}>{score>=0.8?"🏆":score>=0.5?"⭐":"💪"}</div>
            <div style={{ fontSize:26, fontWeight:800, color:world.color, margin:"10px 0" }}>{ok}/{qs.length} correct</div>
            <div style={{ fontSize:14, color:"#aaa", marginBottom:22 }}>
              {score>=0.8?"Outstanding! You're crushing it!":score>=0.5?"Good work! Keep going!":"Don't give up — practice makes perfect!"}
            </div>
            <div style={{ display:"flex", gap:12, justifyContent:"center", marginBottom:22 }}>
              <Stat icon="⚡" val={`+${40+Math.round(score*40)}`} label="XP" />
              <Stat icon="🪙" val={`+${10+Math.round(score*15)}`} label="Coins" />
            </div>
            <button className="lq-btn" onClick={() => onDone(score)}
              style={{ background:world.color, color:"#000", width:"100%", fontSize:16, padding:"14px" }}>
              🎉 Claim Rewards!
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// RPG OVERLAY
// =============================================================================
function RPGOverlay({ world, native, target, onClose, onDone }) {
  const [phase,  setPhase]  = useState("loading");
  const [hist,   setHist]   = useState([]);
  const [opts,   setOpts]   = useState([]);
  const [input,  setInput]  = useState("");
  const [busy,   setBusy]   = useState(false);
  const [rep,    setRep]    = useState(50);
  const [err,    setErr]    = useState("");
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [hist, busy]);

  const SYS = `You are an RPG scenario master for immersive language learning.

World/Setting: ${world.name} — ${world.topic}
Player speaks: ${native.label}
Learning: ${target.label}

CRITICAL RULES:
1. NPC dialogue MUST be in ${target.label} only
2. Add [${native.label} translation] after dialogue in square brackets
3. Situation and all choices MUST be in ${native.label} only
4. After 4-5 exchanges, set completed: true
5. mood options: happy, neutral, suspicious, friendly
6. rep: number -10 to 10 (reputation change)

Return ONLY valid JSON object format (no markdown, no extra text):
{"npc":"NPC name","dialogue":"${target.label} text [${native.label} translation]","situation":"situation in ${native.label}","choices":["choice in ${native.label}","choice 2","choice 3"],"mood":"happy","rep":0,"completed":false}`;

  useEffect(() => {
    ask(SYS, "Start the scenario now.")
      .then(text => {
        try {
          const d = parseJSON(text);
          if (!d.dialogue || !Array.isArray(d.choices) || !d.situation) {
            throw new Error("Missing required fields in response");
          }
          setHist([{ from:"npc", ...d }]);
          setOpts(d.choices || []);
          setPhase("scene");
        } catch (parseErr) {
          console.error("RPG Parse error:", parseErr.message, "Raw:", text.substring(0, 300));
          throw parseErr;
        }
      })
      .catch(e => { setErr(e.message); setPhase("error"); });
  }, [native.label, target.label, world.name, world.topic]);

  const reply = async (choice) => {
    if (busy) return;
    setBusy(true);
    const newHist = [...hist, { from:"player", text: choice }];
    setHist(newHist);
    setOpts([]);
    try {
      const msgs = newHist.map(h => ({
        role: h.from==="player" ? "user" : "assistant",
        content: h.from==="player" ? h.text : JSON.stringify(h),
      }));
      const text = await chat(SYS, msgs);
      const d = parseJSON(text);
      setHist(h => [...h, { from:"npc", ...d }]);
      setOpts(d.choices || []);
      setRep(r => Math.max(0, Math.min(100, r + (d.rep||0))));
      if (d.completed) setPhase("done");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const mood = { happy:"😊", neutral:"😐", suspicious:"🤨", friendly:"😄" };

  return (
    <div className="overlay-bg">
      <div className="overlay-box" style={{ maxHeight:"88vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"0.75rem", flexShrink:0 }}>
          <button onClick={onClose} className="lq-close">✕</button>
          <span style={{ flex:1, fontWeight:700, color:world.color, fontSize:13 }}>⚔️ {world.name} — RPG</span>
          <span style={{ fontSize:11, color:"#aaa" }}>Rep: {rep}</span>
          <div style={{ width:50, height:5, background:"#1e1e30", borderRadius:3 }}>
            <div style={{ height:"100%", borderRadius:3, width:`${rep}%`, background:rep>60?"#6ee7b7":rep>30?"#f59e0b":"#f87171", transition:"width 0.3s" }}/>
          </div>
        </div>

        {phase==="loading" && <Loader text="Setting the scene..." />}
        {phase==="error"   && <ErrBox msg={err} onRetry={onClose} />}

        {(phase==="scene"||phase==="done") && (
          <>
            <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:12, marginBottom:10 }}>
              {hist.map((h,i) => h.from==="npc" ? (
                <div key={i} style={{ animation:"fadeUp 0.25s ease" }}>
                  {h.situation && <div style={{ fontSize:10, color:"#555", textAlign:"center", fontStyle:"italic", marginBottom:5 }}>📍 {h.situation}</div>}
                  <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                    <div style={{ width:32,height:32,borderRadius:"50%",background:world.color+"33",border:`2px solid ${world.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0 }}>
                      {mood[h.mood]||"🧑"}
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:world.color, marginBottom:3, fontWeight:700 }}>{h.npc}</div>
                      <div style={{ background:"#131325", border:"1px solid #2a2a3e", borderRadius:"0 12px 12px 12px", padding:"9px 13px", fontSize:14, color:"#fff", lineHeight:1.6 }}>
                        {h.dialogue}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={i} style={{ display:"flex", justifyContent:"flex-end", animation:"fadeUp 0.25s ease" }}>
                  <div style={{ background:world.color, borderRadius:"12px 12px 0 12px", padding:"9px 14px", fontSize:14, color:"#000", fontWeight:600, maxWidth:"75%" }}>{h.text}</div>
                </div>
              ))}
              {busy && <div style={{ display:"flex", gap:4, padding:"9px 13px", background:"#131325", borderRadius:12, width:58 }}>{[0,1,2].map(i=><span key={i} style={{ width:6,height:6,borderRadius:"50%",background:world.color,display:"block",animation:`blink 1.2s ease ${i*0.2}s infinite` }}/>)}</div>}
              <div ref={endRef}/>
            </div>
            {phase==="scene" && !busy && opts.length>0 && (
              <div style={{ flexShrink:0 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:8 }}>
                  {opts.map((c,i) => (
                    <button key={i} onClick={() => reply(c)}
                      style={{ padding:"9px 14px", borderRadius:10, background:"#131325", border:`1px solid ${world.color}44`, color:"#ccc", fontSize:13, cursor:"pointer", textAlign:"left" }}>
                      {["🅐","🅑","🅒"][i]} {c}
                    </button>
                  ))}
                </div>
                <div style={{ display:"flex", gap:7 }}>
                  <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&input.trim()){reply(input.trim());setInput("");}}}
                    placeholder={`Type your own response in ${target.label}...`}
                    style={{ flex:1, background:"#131325", border:"1px solid #2a2a3e", borderRadius:10, padding:"8px 12px", color:"#fff", fontSize:13 }}/>
                  <button className="lq-btn" onClick={()=>{if(input.trim()){reply(input.trim());setInput("");}}}
                    style={{ background:world.color, color:"#000", padding:"8px 14px" }}>→</button>
                </div>
              </div>
            )}
            {phase==="done" && (
              <div style={{ flexShrink:0, textAlign:"center", paddingTop:"0.75rem" }}>
                <div style={{ fontSize:36, marginBottom:8 }}>🎊</div>
                <div style={{ fontWeight:700, color:world.color, marginBottom:12 }}>Scene Complete! Rep: {rep}/100</div>
                <button className="lq-btn" onClick={onDone} style={{ background:world.color, color:"#000", width:"100%", padding:"12px" }}>Claim +80 XP 🎉</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// BOSS BATTLE
// =============================================================================
function BossOverlay({ native, target, onClose, onDone }) {
  const [phase, setPhase]    = useState("loading");
  const [qs,    setQs]       = useState([]);
  const [idx,   setIdx]      = useState(0);
  const [sel,   setSel]      = useState(null);
  const [showA, setShowA]    = useState(false);
  const [php,   setPhp]      = useState(100);
  const [bhp,   setBhp]      = useState(100);
  const [err,   setErr]      = useState("");

  useEffect(() => {
    const sys = `Generate 10 hard language quiz questions. CRITICAL RULES:
- Return ONLY a JSON array
- NO other text before or after JSON
- NO markdown code blocks
- Each question object must have: q, options (array of 4), answer (0-3), explanation
- NEVER use unescaped quotes in strings
- NEVER add commas after the last array element
- Question in ${native.label}
- Options in ${target.label} (all 4 options)
- Explanation in ${native.label}

Output format EXACTLY:
[{"q":"Q1","options":["A","B","C","D"],"answer":0,"explanation":"E1"},{"q":"Q2","options":["A","B","C","D"],"answer":1,"explanation":"E2"}]`;

    ask(sys, `10 hard questions. Languages: ${native.label} and ${target.label}.`)
      .then(text => { 
        try {
          const data = parseJSON(text);
          if (!Array.isArray(data) || data.length < 5) {
            throw new Error("Expected at least 5 questions, got " + data.length);
          }
          // Validate structure
          for (let i = 0; i < data.length; i++) {
            const q = data[i];
            if (!q.q || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.answer !== "number" || !q.explanation) {
              throw new Error(`Question ${i} has invalid structure`);
            }
          }
          setQs(data.slice(0, 10)); 
          setPhase("battle"); 
        } catch (parseErr) {
          console.error("Boss parse error:", parseErr.message);
          console.error("Raw response first 500 chars:", text.substring(0, 500));
          throw parseErr;
        }
      })
      .catch(e => { setErr(e.message); setPhase("error"); });
  }, [native.label, target.label]);

  const q = qs[idx];

  const pick = (i) => {
    if (sel!==null) return;
    setSel(i); setShowA(true);
    if (i===q.answer) setBhp(h => Math.max(0, h-10));
    else setPhp(h => Math.max(0, h-15));
  };

  const next = () => {
    if (idx>=qs.length-1 || php<=0 || bhp<=0) { setPhase("done"); return; }
    setIdx(i=>i+1); setSel(null); setShowA(false);
  };

  const won = bhp <= 0 || (phase==="done" && bhp < php);

  return (
    <div className="overlay-bg">
      <div className="overlay-box">
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"1rem" }}>
          <button onClick={onClose} className="lq-close">✕</button>
          <span style={{ flex:1, fontWeight:700, color:"#a855f7" }}>👹 Boss Battle</span>
        </div>
        {phase==="loading" && <Loader text="Summoning the boss..." />}
        {phase==="error"   && <ErrBox msg={err} onRetry={onClose} />}
        {phase==="battle"  && q && (
          <>
            <div style={{ display:"flex", gap:10, marginBottom:16 }}>
              {[{l:"You",hp:php,c:"#6ee7b7"},{l:"Boss 👹",hp:bhp,c:"#f87171"}].map(s=>(
                <div key={s.l} style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:"#aaa", marginBottom:3 }}>{s.l} {s.hp}%</div>
                  <div style={{ height:8, background:"#1e1e30", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", background:s.c, width:`${s.hp}%`, transition:"width 0.4s" }}/>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11, color:"#888", marginBottom:5 }}>Q {idx+1}/10</div>
            <div style={{ fontSize:16, fontWeight:700, color:"#fff", marginBottom:14, lineHeight:1.4 }}>{q.q}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {q.options.map((opt,i) => {
                let bg="#131325", border="#2a2a3e", col="#ccc";
                if(showA){ if(i===q.answer){bg="#064e3b";border="#6ee7b7";col="#6ee7b7";}else if(i===sel){bg="#450a0a";border="#f87171";col="#f87171";} }
                return (
                  <button key={i} onClick={()=>pick(i)}
                    style={{ padding:"11px 14px", borderRadius:10, background:bg, border:`2px solid ${border}`, color:col, fontSize:14, cursor:sel===null?"pointer":"default", textAlign:"left" }}>
                    {["A","B","C","D"][i]}. {opt}
                  </button>
                );
              })}
            </div>
            {showA && (
              <>
                <div style={{ marginTop:12, padding:"9px 13px", borderRadius:10, fontSize:13,
                  background:sel===q.answer?"#064e3b":"#450a0a", color:sel===q.answer?"#6ee7b7":"#f87171" }}>
                  {sel===q.answer?"✅ Hit! ":"❌ Miss! "}{q.explanation}
                </div>
                <button className="lq-btn" onClick={next} style={{ background:"#a855f7", color:"#fff", width:"100%", padding:"12px", marginTop:10 }}>
                  {idx>=qs.length-1||php<=0||bhp<=0?"End Battle":"Next Attack →"}
                </button>
              </>
            )}
          </>
        )}
        {phase==="done" && (
          <div style={{ textAlign:"center", animation:"fadeUp 0.4s ease" }}>
            <div style={{ fontSize:56 }}>{won?"🏆":"💀"}</div>
            <div style={{ fontSize:20, fontWeight:800, color:"#a855f7", margin:"10px 0" }}>{won?"Boss Defeated!":"You fell in battle!"}</div>
            <div style={{ fontSize:13, color:"#aaa", marginBottom:20 }}>{won?"Amazing! +100 XP!":"Keep training and try again!"}</div>
            <button className="lq-btn" onClick={()=>onDone(won)} style={{ background:"#a855f7", color:"#fff", width:"100%", padding:"12px" }}>
              {won?"Claim +100 XP 🎉":"Close"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CHAT TAB
// =============================================================================
function ChatTab({ native, target, onXp, onSaveWord, onDoneQuest }) {
  const [msgs,    setMsgs]    = useState([]);
  const [input,   setInput]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [persona, setPersona] = useState("friend");
  const [chatted, setChatted] = useState(false);
  const endRef = useRef(null);

  const personas = [
    { id:"friend",      icon:"😊", label:"Friend"      },
    { id:"teacher",     icon:"👨‍🏫", label:"Teacher"     },
    { id:"shopkeeper",  icon:"🛍️", label:"Shopkeeper"  },
    { id:"interviewer", icon:"💼", label:"Interviewer" },
  ];

  useEffect(() => {
    setMsgs([{ role:"assistant", content:`${target?.flag} Hi! I'm your ${persona} for learning ${target?.label}. I'll speak in ${native?.label} but teach you ${target?.label} words naturally. What would you like to talk about?` }]);
  }, [persona, native, target]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, busy]);

  const SYS = `You are a ${persona} helping a student learn ${target?.label}. The student's native language is ${native?.label}.
RULES:
1. Respond in ${native?.label} (the student's native language)
2. Naturally teach ${target?.label} words by embedding them with translation: write the ${target?.label} word followed by [${native?.label} meaning]
3. If student writes something in ${target?.label} and makes a mistake, correct it gently: [Correction: ...]
4. Highlight key vocabulary: 🔑 ${target?.label}_WORD = ${native?.label}_MEANING
5. Be warm, encouraging, keep responses under 4 sentences.`;

  const send = async () => {
    if (!input.trim() || busy) return;
    const text = input.trim(); setInput("");
    if (!chatted) { onDoneQuest("chat"); setChatted(true); }
    const newMsgs = [...msgs, { role:"user", content:text }];
    setMsgs(newMsgs);
    setBusy(true);
    try {
      const reply = await chat(SYS, newMsgs);
      setMsgs(m => [...m, { role:"assistant", content:reply }]);
      onXp(5);
      // Extract saved word
      const m = reply.match(/🔑\s+(.+?)\s*=\s*(.+)/);
      if (m) { onSaveWord(m[1].trim(), m[2].trim()); onDoneQuest("vocab"); }
    } catch(e) {
      setMsgs(m => [...m, { role:"assistant", content:`Connection error: ${e.message}` }]);
    }
    setBusy(false);
  };

  const fmt = (t) => t
    .replace(/\[Correction: (.*?)\]/g, '<span style="color:#f87171;font-size:12px;display:block;margin-top:3px">📝 $1</span>')
    .replace(/🔑\s+(.+?)\s*=\s*(.+)/g, '<span style="background:#6ee7b720;border:1px solid #6ee7b744;border-radius:5px;padding:1px 7px;font-size:12px;color:#6ee7b7">🔑 $1 = $2</span>')
    .replace(/\n/g,"<br/>");

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", padding:"0 1rem 1rem" }}>
      <div style={{ display:"flex", gap:6, paddingTop:"0.75rem", paddingBottom:"0.75rem", overflowX:"auto", flexShrink:0 }}>
        {personas.map(p => (
          <button key={p.id} onClick={() => setPersona(p.id)}
            style={{ flexShrink:0, padding:"6px 12px", borderRadius:20, background:persona===p.id?"#6ee7b722":"#0f0f1a", border:`1px solid ${persona===p.id?"#6ee7b7":"#1e1e30"}`, color:persona===p.id?"#6ee7b7":"#888", fontSize:12, cursor:"pointer" }}>
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, marginBottom:10 }}>
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", animation:"fadeUp 0.25s ease" }}>
            <div style={{ maxWidth:"82%", padding:"10px 14px", fontSize:14, lineHeight:1.6,
              borderRadius: m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",
              background: m.role==="user"?"#6ee7b7":"#0f0f1a",
              border: m.role==="user"?"none":"1px solid #1e1e30",
              color: m.role==="user"?"#064e3b":"#fff" }}
              dangerouslySetInnerHTML={{ __html:fmt(m.content) }}/>
          </div>
        ))}
        {busy && <div style={{ display:"flex",gap:4,padding:"10px 13px",background:"#0f0f1a",borderRadius:12,width:58,border:"1px solid #1e1e30" }}>{[0,1,2].map(i=><span key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#6ee7b7",display:"block",animation:`blink 1.2s ease ${i*0.2}s infinite` }}/>)}</div>}
        <div ref={endRef}/>
      </div>
      <div style={{ display:"flex", gap:8, flexShrink:0 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder={`Message your ${persona} (in any language)...`}
          style={{ flex:1, background:"#131325", border:"1px solid #1e1e30", borderRadius:12, padding:"10px 14px", color:"#fff", fontSize:14 }}/>
        <button className="lq-btn" onClick={send} disabled={!input.trim()||busy}
          style={{ background:input.trim()&&!busy?"#6ee7b7":"#1e1e30", color:"#064e3b", padding:"10px 16px" }}>→</button>
      </div>
    </div>
  );
}

// =============================================================================
// VOCAB VAULT
// =============================================================================
function VaultTab({ vault, target, onXp }) {
  const [flipped, setFlipped] = useState({});
  const [quiz,    setQuiz]    = useState(false);
  const [qi,      setQi]      = useState(0);
  const [ans,     setAns]     = useState("");
  const [res,     setRes]     = useState(null);

  if (vault.length === 0) return (
    <div style={{ padding:"2.5rem 1rem", textAlign:"center" }}>
      <div style={{ fontSize:64 }}>📖</div>
      <div style={{ fontSize:18, fontWeight:700, color:"#fff", margin:"14px 0 8px" }}>Vault is Empty</div>
      <div style={{ fontSize:14, color:"#888", lineHeight:1.6 }}>Chat with the AI partner and it will automatically save 🔑 vocab words here for you.</div>
    </div>
  );

  if (quiz) {
    const w = vault[qi % vault.length];
    const check = () => { const ok = ans.toLowerCase().trim().includes(w.meaning.toLowerCase().split(" ")[0]); setRes(ok); if(ok) onXp(10); };
    return (
      <div style={{ padding:"1rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18 }}>
          <button onClick={()=>setQuiz(false)} className="lq-close">← Back</button>
          <span style={{ fontWeight:600, fontSize:14 }}>Quick Quiz · {(qi%vault.length)+1}/{vault.length}</span>
        </div>
        <div className="lq-card" style={{ textAlign:"center", padding:"2rem", marginBottom:14 }}>
          <div style={{ fontSize:13, color:"#888", marginBottom:8 }}>What does this {target?.label} word mean?</div>
          <div style={{ fontSize:34, fontWeight:800, color:"#6ee7b7" }}>{w.word}</div>
        </div>
        <input value={ans} onChange={e=>setAns(e.target.value)} onKeyDown={e=>e.key==="Enter"&&res===null&&check()}
          placeholder="Type the meaning..." style={{ width:"100%", background:"#131325", border:"1px solid #1e1e30", borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:14, marginBottom:10 }}/>
        {res!==null && <div style={{ padding:"9px 13px", borderRadius:10, marginBottom:10, background:res?"#064e3b":"#450a0a", color:res?"#6ee7b7":"#f87171" }}>{res?"✅ Correct!":` ❌ It means: ${w.meaning}`}</div>}
        {res===null
          ? <button className="lq-btn" onClick={check} style={{ background:"#a855f7", color:"#fff", width:"100%" }}>Check →</button>
          : <button className="lq-btn" onClick={()=>{setQi(i=>i+1);setAns("");setRes(null);}} style={{ background:"#6ee7b7", color:"#064e3b", width:"100%" }}>Next →</button>
        }
      </div>
    );
  }

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontSize:13, color:"#aaa" }}>{vault.length} words · {target?.label}</span>
        <button className="lq-btn" onClick={()=>setQuiz(true)} style={{ background:"#a855f7", color:"#fff", padding:"6px 14px", fontSize:12 }}>🎯 Quiz Me</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {vault.map((w,i) => (
          <div key={i} onClick={()=>setFlipped(f=>({...f,[i]:!f[i]}))} className="lq-card"
            style={{ cursor:"pointer", minHeight:80, display:"flex", flexDirection:"column", justifyContent:"center" }}>
            {!flipped[i]
              ? <><div style={{ fontSize:20, fontWeight:700, color:"#6ee7b7" }}>{w.word}</div><div style={{ fontSize:11, color:"#555", marginTop:3 }}>tap to reveal</div></>
              : <><div style={{ fontSize:12, color:"#aaa" }}>{w.word}</div><div style={{ fontSize:16, fontWeight:600, color:"#fff", marginTop:4 }}>{w.meaning}</div></>}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// GAMES TAB
// =============================================================================
function GamesTab({ native, target, onXp, onCoins, onDoneQuest, onBadge, onBoss }) {
  const [active, setActive] = useState(null);

  const done = (score, xpBase) => { onXp(xpBase + score*8); onCoins(5); onDoneQuest("minigame"); setActive(null); };

  if (active==="match")   return <WordMatch target={target} native={native} onDone={s=>done(s,15)} onBack={()=>setActive(null)} />;
  if (active==="fill")    return <FillBlank target={target} native={native} onDone={s=>done(s,20)} onBack={()=>setActive(null)} />;
  if (active==="typing")  return <Typing    target={target} native={native} onDone={s=>done(s,25)} onBack={()=>setActive(null)} />;

  const games = [
    { id:"match",  icon:"🔗", name:"Word Match",    desc:"Match words to meanings", color:"#6ee7b7" },
    { id:"fill",   icon:"📝", name:"Fill the Blank",desc:"Complete the sentence",   color:"#3b82f6" },
    { id:"typing", icon:"⌨️", name:"Typing Race",   desc:"Type fast translations",  color:"#f59e0b" },
  ];

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ fontSize:13, color:"#aaa", marginBottom:12 }}>Choose a game</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        {games.map(g => (
          <div key={g.id} onClick={()=>setActive(g.id)} className="lq-card"
            style={{ border:`1px solid ${g.color}44`, cursor:"pointer", transition:"all 0.2s" }}
            onMouseEnter={e=>e.currentTarget.style.borderColor=g.color}
            onMouseLeave={e=>e.currentTarget.style.borderColor=g.color+"44"}>
            <div style={{ fontSize:32, marginBottom:8 }}>{g.icon}</div>
            <div style={{ fontSize:15, fontWeight:700, color:g.color, marginBottom:4 }}>{g.name}</div>
            <div style={{ fontSize:12, color:"#888" }}>{g.desc}</div>
          </div>
        ))}
        {/* Boss button */}
        <div onClick={onBoss} className="lq-card"
          style={{ border:"1px solid #a855f744", cursor:"pointer", background:"linear-gradient(135deg,#1a0033,#2d0040)", transition:"all 0.2s" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>👹</div>
          <div style={{ fontSize:15, fontWeight:700, color:"#a855f7", marginBottom:4 }}>Boss Battle</div>
          <div style={{ fontSize:12, color:"#888" }}>10 hard questions, +100 XP</div>
        </div>
      </div>
    </div>
  );
}

// Word Match game
function WordMatch({ target, native, onDone, onBack }) {
  // Static pairs that work for any target language — we use the AI to get pairs
  const [pairs,    setPairs]    = useState(null);
  const [sel,      setSel]      = useState([]);
  const [matched,  setMatched]  = useState([]);
  const [attempts, setAttempts] = useState(0);
  const [err,      setErr]      = useState("");

  useEffect(() => {
    const sys = `Generate 6 basic ${target?.label} words with ${native?.label} meanings for vocabulary matching game.

Requirements:
1. Each word is common and useful for beginners
2. Provide exactly one ${native?.label} translation per word
3. Keep translations short (1-3 words)
4. Use simple, clear language

Return ONLY valid JSON array (no other text):
[
  {"t":"${target?.label} word","n":"${native?.label} meaning"},
  {"t":"${target?.label} word","n":"${native?.label} meaning"}
]`;
    ask(sys, `Generate 6 basic words in ${target?.label}`)
      .then(text => {
        try {
          const data = parseJSON(text);
          if (!Array.isArray(data) || data.length === 0) throw new Error("Invalid response");
          setPairs(data.slice(0, 6));
        } catch (parseErr) {
          console.error("WordMatch parse error:", parseErr.message);
          // Use fallback if parsing fails
          setPairs([
            {t:"Hello",n:"Hi"},{t:"Thank you",n:"Thanks"},{t:"Goodbye",n:"Bye"},
            {t:"Yes",n:"Yes"},{t:"No",n:"No"},{t:"Water",n:"Water"}
          ]);
        }
      })
      .catch(() => setPairs([
        {t:"Hello",n:"Hi"},{t:"Thank you",n:"Thanks"},{t:"Goodbye",n:"Bye"},
        {t:"Yes",n:"Yes"},{t:"No",n:"No"},{t:"Water",n:"Water"}
      ]));
  }, [target?.label, native?.label]);

  const cards = pairs ? (() => {
    const all = [
      ...pairs.map((p,i) => ({ id:`n${i}`, text:p.n, pair:i, side:"n" })),
      ...pairs.map((p,i) => ({ id:`t${i}`, text:p.t, pair:i, side:"t" })),
    ];
    return all.sort(() => Math.random()-0.5);
  })() : [];

  const tap = (card) => {
    if (!pairs || matched.includes(card.pair) || sel.find(s=>s.id===card.id)) return;
    const ns = [...sel, card];
    if (ns.length===2) {
      setAttempts(a=>a+1);
      if (ns[0].pair===ns[1].pair && ns[0].side!==ns[1].side) {
        const nm = [...matched, card.pair];
        setMatched(nm);
        setSel([]);
        if (nm.length===pairs.length) onDone(Math.max(0,6-attempts));
      } else setTimeout(()=>setSel([]),700);
    } else setSel(ns);
  };

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
        <button onClick={onBack} className="lq-close">← Back</button>
        <span style={{ fontWeight:600, fontSize:14 }}>🔗 Word Match · {matched.length}/{pairs?.length||6}</span>
      </div>
      {!pairs ? <Loader text="Loading words..." /> : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {cards.map(c => {
            const isSel=!!sel.find(s=>s.id===c.id), isDone=matched.includes(c.pair);
            return (
              <div key={c.id} onClick={()=>tap(c)}
                style={{ padding:"11px 6px", borderRadius:10, textAlign:"center", fontSize:13, fontWeight:600, cursor:"pointer", transition:"all 0.2s",
                  background:isDone?"#064e3b":isSel?"#6ee7b722":"#131325",
                  border:`2px solid ${isDone?"#6ee7b7":isSel?"#6ee7b7":"#2a2a3e"}`,
                  color:isDone?"#6ee7b7":isSel?"#6ee7b7":"#ccc" }}>
                {c.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Fill the Blank game
function FillBlank({ target, native, onDone, onBack }) {
  const [qs,    setQs]    = useState(null);
  const [idx,   setIdx]   = useState(0);
  const [input, setInput] = useState("");
  const [res,   setRes]   = useState(null);
  const [score, setScore] = useState(0);
  const [err,   setErr]   = useState("");

  useEffect(() => {
    const sys = `Generate 5 fill-in-the-blank sentences for learning ${target?.label}.

Requirements:
1. Each sentence is a complete phrase in ${target?.label}
2. One word is replaced with ___
3. Provide the answer: the exact ${target?.label} word that fills the blank
4. Provide a hint in ${native?.label}
5. Keep sentences simple and practical

Return ONLY valid JSON array (no other text):
[
  {"sentence":"The ___ is red in ${target?.label}","answer":"apple","hint":"hint in ${native?.label}"},
  {"sentence":"I ___ to school in ${target?.label}","answer":"go","hint":"hint in ${native?.label}"}
]`;
    ask(sys, `Generate 5 fill-in-the-blank exercises for ${target?.label}`)
      .then(text => {
        try {
          const data = parseJSON(text);
          if (!Array.isArray(data) || data.length === 0) {
            throw new Error("Response is not a valid array");
          }
          setQs(data.slice(0, 5));
        } catch (parseErr) {
          console.error("FillBlank parse error:", parseErr.message, "Raw:", text.substring(0, 300));
          setErr(parseErr.message);
          setQs([]);
        }
      })
      .catch(e => { setErr(e.message); setQs([]); });
  }, [target?.label, native?.label]);

  const q = qs?.[idx];
  const isLast = idx >= (qs?.length||1)-1;

  const check = () => {
    if (!q) return;
    const ok = input.trim().toLowerCase() === q.answer.toLowerCase();
    setRes(ok); if(ok) setScore(s=>s+1);
  };

  if (!qs) return <Loader text="Generating sentences..." />;
  if (err || qs.length===0) return <ErrBox msg={err||"Could not load"} onRetry={onBack} />;

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18 }}>
        <button onClick={onBack} className="lq-close">← Back</button>
        <span style={{ fontWeight:600, fontSize:14 }}>📝 Fill the Blank · {idx+1}/{qs.length}</span>
      </div>
      <div className="lq-card" style={{ marginBottom:14, textAlign:"center", padding:"1.5rem" }}>
        <div style={{ fontSize:20, fontWeight:700, color:"#fff", letterSpacing:0.5, lineHeight:1.6 }}>
          {res!==null ? q.sentence.replace("___", `[${res?q.answer:input}]`) : q.sentence}
        </div>
        <div style={{ fontSize:12, color:"#888", marginTop:8 }}>Hint: {q.hint}</div>
      </div>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&res===null&&check()}
        disabled={res!==null}
        placeholder={`Type the missing ${target?.label} word...`}
        style={{ width:"100%", background:"#131325", border:"1px solid #1e1e30", borderRadius:10, padding:"12px 14px", color:"#fff", fontSize:15, marginBottom:10 }}/>
      {res!==null && <div style={{ padding:"9px 13px", borderRadius:10, marginBottom:10, background:res?"#064e3b":"#450a0a", color:res?"#6ee7b7":"#f87171" }}>{res?"✅ Correct!":` ❌ Answer: ${q.answer}`}</div>}
      {res===null
        ? <button className="lq-btn" onClick={check} style={{ background:"#3b82f6", color:"#fff", width:"100%" }}>Check →</button>
        : <button className="lq-btn" onClick={()=>{ if(isLast)onDone(score); else{setIdx(i=>i+1);setInput("");setRes(null);} }}
            style={{ background:"#6ee7b7", color:"#064e3b", width:"100%" }}>
            {isLast?"Finish 🎉":"Next →"}
          </button>
      }
    </div>
  );
}

// Typing Race game
function Typing({ target, native, onDone, onBack }) {
  const [words,   setWords]   = useState(null);
  const [idx,     setIdx]     = useState(0);
  const [input,   setInput]   = useState("");
  const [score,   setScore]   = useState(0);
  const [timer,   setTimer]   = useState(30);
  const [started, setStarted] = useState(false);
  const [flash,   setFlash]   = useState(null); // "ok"|"bad"
  const tiRef = useRef(null);

  useEffect(() => {
    const sys = `Generate 12 common ${target?.label} words with ${native?.label} translations for a typing race game.

Requirements:
1. Words are beginner-friendly and practical
2. Each word is 2-10 characters long
3. Provide exact ${native?.label} translation
4. Variations: nouns, verbs, adjectives

Return ONLY valid JSON array (no other text):
[
  {"word":"${target?.label} word","meaning":"${native?.label} meaning"},
  {"word":"${target?.label} word","meaning":"${native?.label} meaning"}
]`;
    ask(sys, `Generate 12 words for typing game in ${target?.label}`)
      .then(text => {
        try {
          const data = parseJSON(text);
          if (!Array.isArray(data) || data.length === 0) throw new Error("Invalid response");
          setWords(data.slice(0, 12));
        } catch (parseErr) {
          console.error("Typing game parse error:", parseErr.message);
          setWords([{word:"Hello",meaning:"Hi"},{word:"Thanks",meaning:"Thank you"},{word:"Goodbye",meaning:"Bye"}]);
        }
      })
      .catch(() => setWords([{word:"Hello",meaning:"Hi"},{word:"Thanks",meaning:"Thank you"},{word:"Goodbye",meaning:"Bye"}]));
  }, [target?.label, native?.label]);

  useEffect(() => {
    if (!started) return;
    if (timer <= 0) { onDone(score); return; }
    tiRef.current = setTimeout(() => setTimer(t=>t-1), 1000);
    return () => clearTimeout(tiRef.current);
  }, [started, timer, score]);

  const w = words?.[idx % (words?.length||1)];

  const submit = () => {
    if (!started || !w) return;
    const ok = input.trim() === w.word;
    setFlash(ok?"ok":"bad");
    if(ok) setScore(s=>s+1);
    setTimeout(() => { setFlash(null); setIdx(i=>i+1); setInput(""); }, 400);
  };

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        <button onClick={onBack} className="lq-close">← Back</button>
        <span style={{ flex:1, fontWeight:600, fontSize:14 }}>⌨️ Typing Race</span>
        <span style={{ fontSize:20, fontWeight:800, color:timer<10?"#f87171":"#6ee7b7" }}>⏱{timer}s</span>
        <span style={{ fontSize:14, color:"#f59e0b" }}>✓{score}</span>
      </div>
      {!words ? <Loader text="Loading words..." /> : !started ? (
        <div style={{ textAlign:"center", padding:"2rem 0" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>⌨️</div>
          <div style={{ fontSize:14, color:"#aaa", marginBottom:20 }}>See the {native?.label} meaning → type the {target?.label} word. 30 seconds!</div>
          <button className="lq-btn" onClick={()=>setStarted(true)} style={{ background:"#f59e0b", color:"#000", padding:"12px 28px", fontSize:16 }}>Start!</button>
        </div>
      ) : (
        <>
          <div className="lq-card" style={{ textAlign:"center", marginBottom:14, border:`2px solid ${flash==="ok"?"#6ee7b7":flash==="bad"?"#f87171":"#1e1e30"}`, transition:"border-color 0.2s" }}>
            <div style={{ fontSize:13, color:"#888", marginBottom:4 }}>Type this in {target?.label}:</div>
            <div style={{ fontSize:26, fontWeight:800, color:"#fff" }}>{w?.meaning}</div>
          </div>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
            autoFocus placeholder={`Type in ${target?.label}...`}
            style={{ width:"100%", background:"#131325", border:"1px solid #1e1e30", borderRadius:10, padding:"12px 14px", color:"#fff", fontSize:16, marginBottom:10 }}/>
          <button className="lq-btn" onClick={submit} style={{ background:"#f59e0b", color:"#000", width:"100%" }}>Submit →</button>
        </>
      )}
    </div>
  );
}

// =============================================================================
// PROFILE TAB
// =============================================================================
function ProfileTab({ xp, coins, streak, level, badges, quests, vault, native, target }) {
  const earned = new Set(badges);
  return (
    <div style={{ padding:"1rem" }}>
      <div className="lq-card" style={{ textAlign:"center", marginBottom:14 }}>
        <div style={{ width:68,height:68,borderRadius:"50%",background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",margin:"0 auto 10px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30 }}>
          {target?.flag}
        </div>
        <div style={{ fontSize:18, fontWeight:800 }}>Level {level}</div>
        <div style={{ fontSize:13, color:"#888", marginTop:3 }}>{native?.label} → {target?.label} · 🔥{streak} day streak</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
        {[["⚡",xp,"Total XP"],["🪙",coins,"Coins"],["📖",vault.length,"Words"]].map(([icon,val,label])=>(
          <div key={label} className="lq-card" style={{ textAlign:"center", padding:"12px 6px" }}>
            <div style={{ fontSize:18 }}>{icon}</div>
            <div style={{ fontSize:20, fontWeight:800 }}>{val}</div>
            <div style={{ fontSize:10, color:"#888" }}>{label}</div>
          </div>
        ))}
      </div>
      <div className="lq-card" style={{ marginBottom:14 }}>
        <div style={{ fontWeight:700, marginBottom:12 }}>🏅 Badges ({badges.length}/{BADGES.length})</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
          {BADGES.map(b=>(
            <div key={b.id} style={{ textAlign:"center", padding:"10px 6px", borderRadius:10, background:"#131325", border:`1px solid ${earned.has(b.id)?"#f59e0b44":"#1e1e30"}`, opacity:earned.has(b.id)?1:0.3 }}>
              <div style={{ fontSize:22 }}>{b.icon}</div>
              <div style={{ fontSize:10, color:"#ccc", marginTop:3 }}>{b.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="lq-card">
        <div style={{ fontWeight:700, color:"#f59e0b", marginBottom:10 }}>⚡ Daily Quests</div>
        {quests.map(q=>(
          <div key={q.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:"1px solid #131325" }}>
            <span style={{ fontSize:14, opacity:q.done?0.4:1 }}>{q.icon}</span>
            <span style={{ flex:1, fontSize:13, color:q.done?"#555":"#ccc", textDecoration:q.done?"line-through":"none" }}>{q.text}</span>
            <span style={{ fontSize:12, color:q.done?"#444":"#f59e0b" }}>+{q.xp}</span>
            {q.done && <span>✅</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// SHARED HELPERS
// =============================================================================
function Loader({ text }) {
  return (
    <div style={{ textAlign:"center", padding:"3rem 0" }}>
      <div style={{ width:32,height:32,border:"3px solid #6ee7b7",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 14px" }}/>
      <div style={{ color:"#888", fontSize:14 }}>{text}</div>
    </div>
  );
}
function ErrBox({ msg, onRetry }) {
  return (
    <div style={{ padding:"1.5rem", textAlign:"center" }}>
      <div style={{ fontSize:40, marginBottom:10 }}>⚠️</div>
      <div style={{ color:"#f87171", fontSize:14, marginBottom:16 }}>Error: {msg}</div>
      <button className="lq-btn" onClick={onRetry} style={{ background:"#f87171", color:"#fff" }}>Close & Retry</button>
    </div>
  );
}
function Stat({ icon, val, label }) {
  return (
    <div style={{ padding:"12px 20px", borderRadius:12, background:"#0f0f1a", border:"1px solid #1e1e30", textAlign:"center" }}>
      <div style={{ fontSize:22, fontWeight:800, color:"#6ee7b7" }}>{icon} {val}</div>
      <div style={{ fontSize:11, color:"#888" }}>{label}</div>
    </div>
  );
}