const CACHE='lapki-go-shell-v6';
const APP_SHELL=['./','./index.html','./styles.css?v=0.6','./app.js?v=0.6','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lapki-go-shell-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);
 if(url.origin!==self.location.origin)return;
 if(e.request.mode==='navigate'||/\.(html|js|css)$/.test(url.pathname)){
   e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));return;
 }
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
