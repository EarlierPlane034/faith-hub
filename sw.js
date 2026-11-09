importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey:"AIzaSyDhwY77B-wZL7f4077kEC_tn0K2AgJ6bIs",
  authDomain:"faith-hub-71ae2.firebaseapp.com",
  projectId:"faith-hub-71ae2",
  storageBucket:"faith-hub-71ae2.firebasestorage.app",
  messagingSenderId:"560019176489",
  appId:"1:560019176489:web:8b6f70aa76bcdac3f53038"
});
const messaging = firebase.messaging();
// Messages sent with a "notification" payload are shown automatically by the browser.

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {};
  const fm = (d.FCM_MSG && d.FCM_MSG.data) || d;
  const go = e.action === "snooze" ? "snooze1" : (fm.go || "");
  const base = (d.FCM_MSG && d.FCM_MSG.notification && d.FCM_MSG.notification.click_action) || "./";
  const url = go ? "./?go=" + encodeURIComponent(go) : base;
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list => {
    for (const c of list) { if ("focus" in c) { try { c.postMessage({fhGo: go}); } catch (x) {} return c.focus(); } }
    return clients.openWindow(url);
  }));
});

const CACHE = "faith-hub-v5-30";
const CORE = ["./", "index.html", "today.html", "manifest.json", "manifest-today.json", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.hostname.includes("firestore") || u.hostname.endsWith("googleapis.com") || u.hostname.includes("bible-api") || u.hostname.includes("gstatic") || u.hostname.includes("esv.org") || u.hostname.includes("open-meteo.com") || u.hostname.includes("firebaseapp.com")) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
