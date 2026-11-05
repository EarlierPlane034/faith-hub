// Scheduled push notifications for Faith Hub. Runs every ~30 minutes from GitHub Actions.
// Each person picks which ones they want, the time, and their time zone in the app (More > Notifications).
const admin = require("firebase-admin");
const SITE = "https://earlierplane034.github.io/faith-hub/";
const USERS = ["Jayden", "Summer", "Madison"];
const REFS = ["Psalm 46:10","Joshua 1:9","Philippians 4:13","Isaiah 41:10","Proverbs 3:5-6","Matthew 11:28","1 Peter 5:7","Psalm 23:1","Romans 8:28","Jeremiah 29:11","Psalm 121:1-2","Isaiah 40:31","Philippians 4:6-7","Romans 12:12","Psalm 34:8","John 3:16","John 14:27","2 Corinthians 12:9","Psalm 27:1","Lamentations 3:22-23","Matthew 6:33","Psalm 119:105","Galatians 5:22-23","Hebrews 11:1","Colossians 3:23","Psalm 37:4","Micah 6:8","Ephesians 2:8-9","1 Corinthians 13:4-5","Psalm 91:1-2","Deuteronomy 31:6","Romans 15:13","Psalm 139:14","James 1:2-3","Proverbs 16:3","Psalm 56:3","Isaiah 26:3","Zephaniah 3:17","Psalm 30:5","1 John 4:19"];
const DEFAULTS = {
  morning: true, morningT: "12:00", evening: true, eveningT: "20:00", reading: true, readingT: "19:00",
  recap: true, recapT: "09:00", countdown: true, countdownT: "09:00", followup: true, followupT: "10:00",
  monthly: true, monthlyT: "09:00", seasonal: true, seasonalT: "09:00", tz: "America/Denver"
};
const TYPES = ["morning", "evening", "reading", "recap", "countdown", "followup", "monthly", "seasonal"];
const WINDOW = 540; // GitHub timers run late (sometimes 6+ hours), so a run up to 9 hours after the chosen time (same day) may still send; each type sends once per day

function localTime(tz, d = new Date()) {
  let f;
  try { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }); }
  catch (e) { return localTime("America/Denver", d); }
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, y: Number(p.year), m: Number(p.month), d: Number(p.day), min: hour * 60 + Number(p.minute), dow: p.weekday };
}
const toMin = t => { const [h, m] = String(t || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 3) + "..." : s; };
const easter = y => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`; };
const thanksgiving = y => { const first = new Date(Date.UTC(y, 10, 1)).getUTCDay(); const day = 1 + ((4 - first + 7) % 7) + 21; return `${y}-11-${String(day).padStart(2, "0")}`; };
const canSee = (p, u) => p.audience ? p.audience.includes(u.toLowerCase()) : (!(p.priv && p.priv !== u) && !(p.vis && p.author !== u && !p.vis.includes(u)));
const dayNum = () => Math.floor(Date.now() / 864e5);

async function fetchVerse(ref) {
  try {
    const r = await fetch("https://bible-api.com/" + encodeURIComponent(ref));
    const j = await r.json();
    if (j && j.text) return ref + ": " + j.text.trim().replace(/\s*\n\s*/g, " ");
  } catch (e) { console.log("Verse fetch failed for " + ref); }
  return ref;
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  const FORCE = process.env.FORCE || "";
  const forceType = FORCE === "1" ? "morning" : (TYPES.includes(FORCE) ? FORCE : "");

  const [tokSnap, notifDoc, readsDoc, prayerSnap, eventSnap] = await Promise.all([
    db.collection("tokens").get(),
    db.collection("meta").doc("notif").get(),
    db.collection("meta").doc("reads").get(),
    db.collection("items").where("type", "==", "prayer").select("text", "for", "answered", "update", "priv", "vis", "audience", "author", "created", "followupSent").get(),
    db.collection("items").where("type", "==", "event").select("title", "date", "repeat", "priv", "vis", "audience", "author").get()
  ]);
  const tokensBy = {};
  tokSnap.docs.forEach(d => { const u = d.data().user; if (USERS.includes(u)) (tokensBy[u] = tokensBy[u] || []).push(d.id); });
  const notif = notifDoc.exists ? notifDoc.data() : {};
  const reads = readsDoc.exists ? readsDoc.data() : {};
  const prayers = prayerSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const events = eventSnap.docs.map(d => d.data());
  console.log("Devices: " + USERS.map(u => u + "=" + (tokensBy[u] || []).length).join(", "));

  const visiblePrayers = u => prayers.filter(p => !p.answered && canSee(p, u));
  const cache = {};
  const verseFor = async () => cache.v || (cache.v = await fetchVerse(REFS[dayNum() % REFS.length]));

  async function chapterDoc(L) { const s = await db.collection("meta").doc("chap_" + L.date.slice(0, 7)).get(); return s.exists ? s.data() : null; }

  // Each builder returns { title, body } or null (nothing to send).
  const builders = {
    async morning() { return { title: "Your verse for today", body: clip(await verseFor(), 200) + "\nTap to open Faith Hub" }; },
    async evening(u) {
      const l = visiblePrayers(u);
      if (!l.length) return { title: "Evening prayer", body: "Take a quiet minute to pray tonight. 🙏" };
      const p = l[dayNum() % l.length];
      return { title: "Evening prayer 🙏", body: "Pray for: " + clip(p.for || p.text, 120) };
    },
    async reading(u, L) {
      if ((reads[u] || []).includes(L.date)) return null;
      return { title: "Have you read today?", body: "Even one verse counts. Tap to open the app. 📖" };
    },
    async recap(u, L) {
      if (L.dow !== "Sun") return null;
      const since = Date.now() - 7 * 864e5;
      const snap = await db.collection("items").where("created", ">=", since).select("author", "type", "priv", "vis", "audience").get();
      const counts = Object.fromEntries(USERS.map(x => [x, 0]));
      snap.docs.forEach(d => { const a = d.data().author; if (a in counts && d.data().type !== "msg" && !d.data().priv && !d.data().vis && !(d.data().audience && d.data().audience.length < USERS.length)) counts[a]++; });
      const cut = addDays(L.date, -7);
      const rd = x => (reads[x] || []).filter(dt => dt > cut).length;
      const ans = prayers.filter(p => p.answered).length;
      return { title: "Your week in Faith Hub", body: USERS.map(x => `${x}: ${counts[x]} posts, ${rd(x)} reading days`).join(" | ") + (ans ? ` | ${ans} answered prayers 🙏` : "") };
    },
    async countdown(u, L) {
      const tomorrow = addDays(L.date, 1);
      const hit = [];
      events.forEach(e => {
        if (!e.date || !canSee(e, u)) return;
        const md = e.date.slice(5), same = d => e.repeat === "Every year" ? d.slice(5) === md : d === e.date;
        if (same(L.date)) hit.push(`Today: ${e.title || "Event"}`);
        else if (same(tomorrow)) hit.push(`Tomorrow: ${e.title || "Event"}`);
      });
      return hit.length ? { title: "Coming up 📅", body: clip(hit.join(". "), 200) } : null;
    },
    async followup(u, L) {
      const cutoff = Date.now() - 14 * 864e5;
      const p = prayers.find(x => x.author === u && !x.answered && !x.update && !x.followupSent && x.created && x.created < cutoff);
      if (!p) return null;
      if (!FORCE) await p.ref.update({ followupSent: true });
      return { title: "Any update? 🙏", body: "It has been a while since you prayed about: " + clip(p.for || p.text, 100) };
    },
    async monthly(u, L) {
      if (L.d !== 1 && L.d !== 15) return null;
      const c = await chapterDoc(L);
      if (!c || !c.parts) return { title: "One chapter a month 📖", body: L.d === 1 ? "A new month! Pick this month's chapter together." : "No chapter picked yet this month. Pick one to read together." };
      if (L.d === 1) return null;
      const done = c.done || {};
      const left = c.parts.filter((p, i) => !(done[i + 1] || []).includes(u)).length;
      return left ? { title: "Halfway through the month 📖", body: `You have ${left} of ${c.parts.length} parts left in ${c.ref}. You can do it!` } : null;
    },
    async seasonal(u, L) {
      const md = L.date.slice(5);
      const specials = {
        [easter(L.y).slice(5)]: ["Happy Easter ✝️", "He is risen! Matthew 28:6"],
        [thanksgiving(L.y).slice(5)]: ["Happy Thanksgiving 🍂", "Give thanks to the Lord, for he is good. Psalm 107:1"],
        "12-25": ["Merry Christmas 🎄", "For unto us a child is born. Isaiah 9:6"],
        "01-01": ["Happy New Year ✨", "Behold, I make all things new. Revelation 21:5"]
      };
      const s = specials[md];
      return s ? { title: s[0], body: s[1] } : null;
    }
  };

  async function send(user, title, body) {
    const tokens = tokensBy[user] || [];
    if (!tokens.length) { console.log(`[${user}] no devices, skipped "${title}"`); return; }
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: SITE }, notification: { icon: SITE + "icon-192.png" } }
    });
    console.log(`[${user}] "${title}": ${res.successCount} sent, ${res.failureCount} failed`);
    const dead = [];
    res.responses.forEach((r, i) => { if (!r.success && r.error && /not-registered|invalid-registration-token|invalid-argument/.test(r.error.code || "")) dead.push(tokens[i]); });
    await Promise.all(dead.map(t => db.collection("tokens").doc(t).delete()));
  }

  for (const user of USERS) {
    const s = { ...DEFAULTS, ...(notif[user] || {}) };
    const L = localTime(s.tz);
    const logRef = db.collection("pushlog").doc(`${user}_${L.date}`);
    const logSnap = await logRef.get();
    const log = logSnap.exists ? logSnap.data() : {};
    for (const type of TYPES) {
      if (forceType) { if (type !== forceType) continue; }
      else {
        if (!s[type]) continue;
        const t = toMin(s[type + "T"]);
        if (!(L.min >= t && L.min < t + WINDOW)) continue;
        if (log[type]) continue;
      }
      try {
        const msg = await builders[type](user, L);
        if (msg) await send(user, msg.title, msg.body);
        else console.log(`[${user}] ${type}: nothing to send`);
      } catch (e) { console.error(`[${user}] ${type} failed:`, e.message); }
      if (!forceType) await logRef.set({ [type]: Date.now() }, { merge: true });
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
