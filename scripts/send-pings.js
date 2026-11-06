// Sends push notifications for pokes, prayer requests, chat, replies and activity.
// Also re-sends a poke once if nobody replied within 10 minutes, and records delivery proof.
// Triggered every minute by cron-job.org (workflow_dispatch) and every 5 minutes by GitHub's own timer.
const admin = require("firebase-admin");
const SITE = "https://earlierplane034.github.io/faith-hub/";
const USERS = ["Jayden", "Summer", "Madison"];
const RESEND_AFTER = 10 * 60e3, RESEND_UNTIL = 90 * 60e3;
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 3) + "..." : s; };

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  const tokSnap = await db.collection("tokens").get();
  const tokensBy = {};
  tokSnap.docs.forEach(d => { const u = d.data().user; if (USERS.includes(u)) (tokensBy[u] = tokensBy[u] || []).push(d.id); });

  function vibFor(u) { const v = ((typeof ncfg !== "undefined" && ncfg[u]) || {}).vib || "gentle"; return v === "off" ? { silent: true } : v === "strong" ? { vibrate: [500, 200, 500, 200, 500] } : { vibrate: [200, 100, 200] }; }
  async function pushTo(u, title, body) {
    const tokens = tokensBy[u] || [];
    if (!tokens.length) { console.log(`[${u}] no devices, skipped`); return 0; }
    const res = await admin.messaging().sendEachForMulticast({
      tokens, notification: { title, body },
      webpush: { headers: { Urgency: "high", TTL: "86400" }, fcmOptions: { link: SITE }, notification: Object.assign({ icon: SITE + "icon-192.png", requireInteraction: true }, vibFor(u)) },
      android: { priority: "high" }
    });
    console.log(`[${u}] "${title}": ${res.successCount} sent, ${res.failureCount} failed`);
    const dead = [];
    res.responses.forEach((r, i) => { if (!r.success && r.error && /not-registered|invalid-registration-token|invalid-argument/.test(r.error.code || "")) dead.push(tokens[i]); });
    await Promise.all(dead.map(t => db.collection("tokens").doc(t).delete()));
    if (res.successCount > 0) await db.collection("meta").doc("delivery").set({ [u]: { ts: Date.now(), title: clip(title, 40), devices: tokens.length - dead.length } }, { merge: true }).catch(() => {});
    return res.successCount;
  }

  // per-user alert preferences (categories + quiet hours)
  const nsnap = await db.collection("meta").doc("notif").get().catch(() => null);
  const ncfg = (nsnap && nsnap.exists ? nsnap.data() : {}) || {};
  const CAT = { chat: "c_chat", activity: "c_activity", prayer: "c_prayer", goodnews: "c_cheer", goodnight: "c_cheer" };
  const URGENT = ["poke", "support", "reply", "askpray", "test", "invite"];
  function allowed(u, kind) {
    if (URGENT.includes(kind)) return true;
    const c = ncfg[u] || {};
    const k = CAT[kind];
    if (k && c[k] === false) return false;
    if (c.quiet === true) {
      let t; try { t = new Date().toLocaleTimeString("en-GB", { timeZone: c.tz || "America/Denver", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return true; }
      const s = c.quietS || "22:00", e = c.quietE || "07:00";
      const inq = s <= e ? (t >= s && t < e) : (t >= s || t < e);
      if (inq) return false;
    }
    return true;
  }

  // heartbeat only every 5 minutes: each write is re-read by every open app tab
  if (new Date().getUTCMinutes() % 5 === 0) await db.collection("meta").doc("heartbeat").set({ pings: Date.now() }, { merge: true }).catch(() => {});
  // 1) New pings
  const snap = await db.collection("pings").where("push", "==", true).where("pushed", "==", false).get();
  for (const doc of snap.docs) {
    const p = doc.data();
    if (Date.now() - (p.ts || 0) > 36 * 3600e3) { await doc.ref.update({ pushed: true }); continue; }
    const from = USERS.includes(p.from) ? p.from : "Someone";
    const to = p.kind === "test" ? [from] : (p.to || []).filter(u => USERS.includes(u) && u !== from);
    let title, body;
    if (p.kind === "test") { title = "🔔 Faith Hub test"; body = "It works! Notifications reach this phone."; }
    else if (p.kind === "poke") { title = "👉 " + from + " poked you"; body = "They want to talk. Tap to open."; }
    else if (p.kind === "support") { title = "💛 " + from + " could use you"; body = p.text ? clip(p.text, 120) : "Please check in with them when you can."; }
    else if (p.kind === "prayer") { title = "🙏 " + from + " asks for prayer"; body = clip(p.text, 140) || "Please pray for them."; }
    else if (p.kind === "reply") { title = "💛 " + from; body = clip(p.text, 120) || "Replied to you"; }
    else if (p.kind === "askpray") { title = "🤍 " + from + " wants to pray for you"; body = "How can they pray for you? Tap to tell them."; }
    else if (p.kind === "goodnight") { title = "🌙 Goodnight from " + from; body = "Praying for you tonight."; }
    else if (p.kind === "goodnews") { title = "🎉 " + from + " has good news"; body = clip(p.text, 140) || "Tap to see."; }
    else if (p.kind === "chat") { title = "💬 " + from; body = clip(p.text, 140) || "Sent a message"; }
    else if (p.kind === "activity") { title = "Faith Hub"; body = from + " " + clip(p.text, 100); }
    else { title = "Faith Hub"; body = from + " " + clip(p.text, 120); }
    for (const u of to) if (allowed(u, p.kind)) await pushTo(u, title, body);
    await doc.ref.update({ pushed: true });
  }

  // 2) Re-send a poke once if nobody answered within 10 minutes
  const recent = await db.collection("pings").where("ts", ">", Date.now() - RESEND_UNTIL).orderBy("ts", "desc").limit(30).get();
  const all = recent.docs.map(d => ({ ref: d.ref, ...d.data() }));
  for (const p of all) {
    if (!["poke", "support"].includes(p.kind) || !p.pushed || p.resent) continue;
    if (Date.now() - p.ts < RESEND_AFTER) continue;
    const from = USERS.includes(p.from) ? p.from : "Someone";
    const to = (p.to || []).filter(u => USERS.includes(u) && u !== from);
    for (const u of to) {
      const replied = all.some(r => r.kind === "reply" && r.from === u && (r.to || []).includes(from) && r.ts > p.ts);
      if (replied) continue;
      await pushTo(u, "👉 " + from + " is still waiting", "They poked you a few minutes ago. Tap to answer.");
    }
    await p.ref.update({ resent: true });
  }
  console.log("Done.");
}
main().catch(e => { console.error(e); process.exit(1); });
