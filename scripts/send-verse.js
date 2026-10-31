// Sends the daily verse push to every saved device token at noon Denver time.
const admin = require("firebase-admin");
const REFS = ["Psalm 46:10","Joshua 1:9","Philippians 4:13","Isaiah 41:10","Proverbs 3:5-6","Matthew 11:28","1 Peter 5:7","Psalm 23:1","Romans 8:28","Jeremiah 29:11","Psalm 121:1-2","Isaiah 40:31","Philippians 4:6-7","Romans 12:12","Psalm 34:8","John 3:16","John 14:27","2 Corinthians 12:9","Psalm 27:1","Lamentations 3:22-23","Matthew 6:33","Psalm 119:105","Galatians 5:22-23","Hebrews 11:1","Colossians 3:23","Psalm 37:4","Micah 6:8","Ephesians 2:8-9","1 Corinthians 13:4-5","Psalm 91:1-2","Deuteronomy 31:6","Romans 15:13","Psalm 139:14","James 1:2-3","Proverbs 16:3","Psalm 56:3","Isaiah 26:3","Zephaniah 3:17","Psalm 30:5","1 John 4:19"];
const SITE = "https://earlierplane034.github.io/faith-hub/";

(async () => {
  const hour = Number(new Intl.DateTimeFormat("en-US", {timeZone:"America/Denver", hour:"numeric", hour12:false}).format(new Date()));
  const today = new Date().toLocaleDateString("en-CA", {timeZone:"America/Denver"});
  if (process.env.FORCE !== "1" && hour !== 12) { console.log("Not noon in Denver (hour " + hour + "). Skipping."); return; }

  admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
  const db = admin.firestore();
  const flag = db.collection("meta").doc("lastpush");
  if (process.env.FORCE !== "1") {
    const s = await flag.get();
    if (s.exists && s.data().day === today) { console.log("Already sent today."); return; }
  }

  const day = Math.floor(Date.now() / 864e5);
  const ref = REFS[day % REFS.length];
  let text = ref;
  try {
    const r = await fetch("https://bible-api.com/" + encodeURIComponent(ref));
    const j = await r.json();
    if (j && j.text) text = ref + ": " + j.text.trim().replace(/\s*\n\s*/g, " ");
  } catch (e) { console.log("Verse fetch failed, sending reference only."); }
  if (text.length > 220) text = text.slice(0, 217) + "...";

  const snap = await db.collection("tokens").get();
  const tokens = snap.docs.map(d => d.id);
  if (!tokens.length) { console.log("No devices registered yet."); return; }

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {title: "Your verse for today", body: text + "\nTap to open Faith Hub"},
    webpush: {fcmOptions: {link: SITE}, notification: {icon: SITE + "icon-192.png"}}
  });
  console.log("Sent " + res.successCount + ", failed " + res.failureCount);
  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success && r.error && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error.code || "")) dead.push(tokens[i]);
  });
  await Promise.all(dead.map(t => db.collection("tokens").doc(t).delete()));
  if (process.env.FORCE !== "1") await flag.set({day: today, ts: Date.now()});
})().catch(e => { console.error(e); process.exit(1); });
