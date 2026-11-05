// Sends push notifications for "I need someone", "Please pray for me" and plan invites.
// Runs every 5 minutes from GitHub Actions (.github/workflows/pings.yml).
const admin = require("firebase-admin");
const SITE = "https://earlierplane034.github.io/faith-hub/";
const USERS = ["Jayden", "Summer", "Madison"];
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 3) + "..." : s; };

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  const snap = await db.collection("pings").where("push", "==", true).where("pushed", "==", false).get();
  if (snap.empty) { console.log("No pending pings."); return; }
  const tokSnap = await db.collection("tokens").get();
  const tokensBy = {};
  tokSnap.docs.forEach(d => { const u = d.data().user; if (USERS.includes(u)) (tokensBy[u] = tokensBy[u] || []).push(d.id); });
  for (const doc of snap.docs) {
    const p = doc.data();
    if (Date.now() - (p.ts || 0) > 36 * 3600e3) { await doc.ref.update({ pushed: true }); continue; }
    const from = USERS.includes(p.from) ? p.from : "Someone";
    const to = p.kind === "test" ? [from] : (p.to || []).filter(u => USERS.includes(u) && u !== from);
    let title, body;
    if (p.kind === "test") { title = "🔔 Faith Hub test"; body = "It works! Notifications reach this phone."; }
    else if (p.kind === "support") { title = "💛 " + from + " could use you"; body = p.text ? clip(p.text, 120) : "Please check in with them when you can."; }
    else if (p.kind === "prayer") { title = "🙏 " + from + " asks for prayer"; body = clip(p.text, 140) || "Please pray for them."; }
    else { title = "Faith Hub"; body = from + " " + clip(p.text, 120); }
    for (const u of to) {
      const tokens = tokensBy[u] || [];
      if (!tokens.length) { console.log(`[${u}] no devices, skipped`); continue; }
      const res = await admin.messaging().sendEachForMulticast({
        tokens, notification: { title, body },
        webpush: { headers: { Urgency: "high" }, fcmOptions: { link: SITE }, notification: { icon: SITE + "icon-192.png" } }
      });
      console.log(`[${u}] "${title}": ${res.successCount} sent, ${res.failureCount} failed`);
      const dead = [];
      res.responses.forEach((r, i) => { if (!r.success && r.error && /not-registered|invalid-registration-token|invalid-argument/.test(r.error.code || "")) dead.push(tokens[i]); });
      await Promise.all(dead.map(t => db.collection("tokens").doc(t).delete()));
    }
    await doc.ref.update({ pushed: true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
