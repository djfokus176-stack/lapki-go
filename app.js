/* Łapki GO MVP v0.2: browser-only prototype, no public publishing. */
'use strict';
const $ = (id) => document.getElementById(id);
const DB_NAME = 'lapki-go-v1';
const STORE = 'dogs';
const DOG_CONFIDENCE_MIN = 0.55;
let dbPromise, dogs = [], cameraStream = null, captured = null, modelPromise = null;
let processingPhoto = false;
let leafletMap = null, markersLayer = null, leafletPromise = null;
const cardUrls = new Map();

const datePL = timestamp => new Date(timestamp).toLocaleDateString('pl-PL', {day:'2-digit',month:'short',year:'numeric'});
const setStatus = (message) => { $('camera-message').textContent = message; };
const setAiStatus = (message, kind='') => {
  $('ai-check').textContent = message;
  $('ai-check').className = 'ai-status'+(kind?' '+kind:'');
};

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function inStore(mode, fn) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode), store=tx.objectStore(STORE);
    let request;
    try {request=fn(store);} catch(err) {reject(err);return;}
    if (request) {request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);}
    else {tx.oncomplete=()=>resolve();}
    tx.onerror=()=>reject(tx.error);
  });
}
async function reloadDogs() {
  dogs = (await inStore('readonly',s=>s.getAll())).sort((a,b)=>b.createdAt-a.createdAt);
  renderAll();
}
function navigate(view) {
  for (const node of document.querySelectorAll('.view')) node.classList.toggle('active',node.id===`view-${view}`);
  for (const node of document.querySelectorAll('[data-navigate].nav-button')) node.classList.toggle('active',node.dataset.navigate===view);
  if (view!=='catch') stopCamera();
  if (view==='map') setTimeout(renderMap,100);
  if (view==='collection') renderCollection();
  window.scrollTo({top:0,behavior:'auto'});
}
function cardFor(dog, urlBucket) {
  const card=document.createElement('article'); card.className='dog-card';
  const image=document.createElement('img'); image.className='dog-photo';
  const url=URL.createObjectURL(dog.photoBlob);urlBucket.push(url);
  image.src=url; image.alt=`Zdjęcie psa: ${dog.name}`; image.loading='lazy';
  const body=document.createElement('div');body.className='dog-card-body';
  const name=document.createElement('h3');name.className='dog-name';name.textContent=dog.name;
  const meta=document.createElement('p');meta.className='dog-meta';meta.textContent=`${datePL(dog.createdAt)} • ${typeof dog.lat==='number'?'📍 Z lokalizacją':'Bez lokalizacji'}`;
  const foot=document.createElement('div');foot.className='dog-card-footer';
  const points=document.createElement('span');points.className=`point-pill${dog.verified?'':' unverified'}`;
  points.textContent=dog.verified?'+10 pkt':'Niezweryfikowany • 0 pkt';
  const remove=document.createElement('button');remove.className='delete-dog';remove.type='button';remove.textContent='Usuń';
  remove.setAttribute('aria-label',`Usuń zdjęcie psa ${dog.name}`);
  remove.addEventListener('click',async()=>{
    if (!confirm(`Na pewno usunąć ${dog.name} z kolekcji?`)) return;
    try {await inStore('readwrite',s=>s.delete(dog.id)); await reloadDogs();}
    catch(err){alert(`Nie udało się usunąć zdjęcia: ${err.message}`);}
  });
  foot.append(points,remove);body.append(name,meta,foot);card.append(image,body);return card;
}
function replaceCards(container, items) {
  for (const url of (cardUrls.get(container)||[])) URL.revokeObjectURL(url);
  const urls=[]; cardUrls.set(container,urls);
  container.replaceChildren();
  for (const dog of items) container.append(cardFor(dog,urls));
}
function renderAll() {
  const verified=dogs.filter(d=>d.verified);
  $('stat-dogs').textContent=dogs.length;
  $('stat-points').textContent=verified.length*10;
  $('stat-places').textContent=dogs.filter(d=>typeof d.lat==='number').length;
  $('collection-count').textContent=`${dogs.length} zdjęć`;
  replaceCards($('recent-grid'),dogs.slice(0,4));
  $('home-empty').hidden=dogs.length>0;
  renderCollection();
  if (leafletMap) renderMap();
}
function renderCollection() {
  if (!dogs) return;
  const q=($('search-dogs').value||'').trim().toLocaleLowerCase('pl-PL');
  const filtered=dogs.filter(d=>d.name.toLocaleLowerCase('pl-PL').includes(q));
  replaceCards($('collection-grid'),filtered);
  $('collection-empty').hidden=filtered.length>0;
  $('collection-empty').textContent=dogs.length===0?'Jeszcze nie masz psów w kolekcji.':'Brak pasujących zdjęć.';
}
function stopCamera() {
  if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;}
  $('camera-video').srcObject=null;$('camera-video').hidden=true;
  if(!captured){$('camera-placeholder').hidden=false;$('camera-toggle').hidden=false;}
  $('snap-btn').hidden=true;
}
async function startCamera() {
  navigate('catch');
  if(!navigator.mediaDevices?.getUserMedia){setStatus('Aparat nie jest dostępny. Uruchom aplikację przez HTTPS na telefonie.');return;}
  try {
    setStatus('Uruchamiam aparat…');
    clearCaptured();
    cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
    const video=$('camera-video');video.srcObject=cameraStream;
    await video.play();
    video.hidden=false;$('camera-placeholder').hidden=true;
    $('camera-toggle').hidden=true;$('snap-btn').hidden=false;
    setStatus('Skieruj aparat na psa. Poproś właściciela o zgodę na zdjęcie.');
  } catch(err) {
    stopCamera();setStatus(`Brak dostępu do aparatu: ${err.message}. Sprawdź uprawnienia przeglądarki.`);
  }
}
function clearCaptured() {
  if(captured?.url)URL.revokeObjectURL(captured.url);
  captured=null;
  $('photo-preview').hidden=true;$('photo-preview').removeAttribute('src');
  $('photo-fields').hidden=true;$('retake-btn').hidden=true;$('save-unverified').hidden=true;
  $('save-dog').disabled=false;$('dog-name').value='';$('save-location').checked=false;
  setAiStatus('Zdjęcie gotowe do sprawdzenia.');
}
async function capturePhoto() {
  const video=$('camera-video');
  if (!cameraStream || !video.videoWidth) {setStatus('Aparat nie jest jeszcze gotowy.');return;}
  try {
    const maxEdge=1024, scale=Math.min(1,maxEdge/Math.max(video.videoWidth,video.videoHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Nie udało się zrobić zdjęcia.')),'image/jpeg',.77));
    stopCamera();
    const url=URL.createObjectURL(blob);captured={blob,url};
    $('photo-preview').src=url;$('photo-preview').hidden=false;$('camera-placeholder').hidden=true;
    $('camera-toggle').hidden=true;$('retake-btn').hidden=false;$('photo-fields').hidden=false;
    setStatus('Zdjęcie zrobione. Nazwij psa i zapisz.');
  } catch(err){setStatus(`Błąd fotografowania: ${err.message}`);}
}
function loadScript(src) {
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=src;script.async=true;
    script.onload=resolve;script.onerror=()=>reject(new Error('Nie można pobrać modelu AI. Sprawdź internet.'));
    document.head.append(script);
  });
}
function getModel() {
  if(!modelPromise){
    modelPromise=(async()=>{
      if(!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      if(!window.cocoSsd)await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
      return window.cocoSsd.load({base:'lite_mobilenet_v2'});
    })().catch(err=>{modelPromise=null;throw err;});
  }
  return modelPromise;
}
async function sha256(blob) {
  const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
// dHash wycinka z psem. Wykrywa podobne KADRY, ale nie rozpoznaje tożsamości psa.
function visualHash(img, bbox) {
  const naturalW = img.naturalWidth, naturalH = img.naturalHeight;
  let [x, y, w, h] = bbox || [0, 0, naturalW, naturalH];
  x = Math.max(0, Math.min(naturalW - 1, x));
  y = Math.max(0, Math.min(naturalH - 1, y));
  w = Math.max(1, Math.min(w, naturalW - x));
  h = Math.max(1, Math.min(h, naturalH - y));
  const canvas = document.createElement('canvas'); canvas.width = 9; canvas.height = 8;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, x, y, w, h, 0, 0, 9, 8);
  const px = g.getImageData(0, 0, 9, 8).data;
  const gray = i => .299*px[i] + .587*px[i+1] + .114*px[i+2];
  let bits = '';
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++)
    bits += gray((row*9+col)*4) > gray((row*9+col+1)*4) ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
function hashDistance(a,b) {
  let x = BigInt('0x'+a) ^ BigInt('0x'+b), count=0;
  while(x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}
function gpsWithTimeout() {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude}),
      ()=>resolve(null),{enableHighAccuracy:false,maximumAge:60000,timeout:8000}
    );
  });
}
async function savePhoto({verified,confidence=0,visual=null}) {
  const name=$('dog-name').value.trim().replace(/\s+/g,' ').slice(0,32)||'Nieznajomy pies';
  if (!captured) return;
  const shot = captured;
  if($('save-location').checked)setStatus('Pobieram lokalizację (tylko dla Ciebie)…');
  const coords=$('save-location').checked?await gpsWithTimeout():null;
  const dog={id:crypto.randomUUID(),name,createdAt:Date.now(),photoBlob:shot.blob,
    hash:await sha256(shot.blob),visual,verified,confidence,lat:coords?.lat??null,lng:coords?.lng??null};
  await inStore('readwrite',s=>s.add(dog));
  clearCaptured();$('camera-placeholder').hidden=false;$('camera-toggle').hidden=false;
  await reloadDogs();navigate('collection');
  setStatus(coords?'Zapisano psa i lokalizację.':'Zapisano psa do prywatnej kolekcji.');
}
async function checkAndSave() {
  if (!captured || processingPhoto) return;
  processingPhoto=true;
  const button=$('save-dog');button.disabled=true;$('save-unverified').hidden=true;
  try {
    setAiStatus('Wczytuję lokalny model AI i sprawdzam, czy widać psa…');
    const hash=await sha256(captured.blob);
    if(dogs.some(d=>d.hash===hash)){setAiStatus('Takie samo zdjęcie jest już w kolekcji. Zrób nowe.','bad');return;}
    const model=await getModel();
    await $('photo-preview').decode();
    const detections=await model.detect($('photo-preview'));
    if (detections.some(d => d.class === 'person' && d.score >= .55)) {
      setAiStatus('Na zdjęciu AI widzi osobę. Zrób nowe zdjęcie samego psa, najlepiej za zgodą właściciela.', 'bad'); return;
    }
    const dogsFound=detections.filter(d=>d.class==='dog').sort((a,b)=>b.score-a.score);
    const confidence=dogsFound[0]?.score??0;
    if(confidence<DOG_CONFIDENCE_MIN){
      setAiStatus('AI nie rozpoznało psa z wystarczającą pewnością. Zrób wyraźniejsze zdjęcie.','bad');return;
    }
    const visual = visualHash($('photo-preview'), dogsFound[0].bbox);
    if (dogs.some(d => d.visual && hashDistance(visual, d.visual) <= 4)) {
      setAiStatus('To zdjęcie wygląda bardzo podobnie do jednego z Twoich wcześniejszych ujęć. Zrób inne zdjęcie.','bad'); return;
    }
    setAiStatus(`Wykryto psa (pewność ${(confidence*100).toFixed(0)}%). Zapisuję…`,'good');
    await savePhoto({verified:true,confidence,visual});
  } catch(err) {
    setAiStatus(`Nie udało się zweryfikować zdjęcia: ${err.message}. Możesz zapisać je lokalnie do testów bez punktów.`, 'bad');
    $('save-unverified').hidden=false;
  } finally {button.disabled=false;processingPhoto=false;}
}
async function saveUnverified() {
  if(!captured || processingPhoto)return;
  processingPhoto=true;
  try {await savePhoto({verified:false});}
  catch(err){setAiStatus(`Nie zapisano zdjęcia: ${err.message}`,'bad');}
  finally {processingPhoto=false;}
}
function getLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) leafletPromise = (async()=>{
    const link=document.createElement('link');link.rel='stylesheet';
    link.href='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';document.head.append(link);
    await loadScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');
    return window.L;
  })().catch(err=>{leafletPromise=null;throw err;});
  return leafletPromise;
}
async function renderMap() {
  const node=$('map');
  try { await getLeaflet(); }
  catch { $('map-message').textContent='Mapa wymaga internetu. Nie udało się pobrać biblioteki Leaflet.';return; }
  if (!$('view-map').classList.contains('active')) return;
  if(!leafletMap){
    leafletMap=L.map(node,{scrollWheelZoom:false}).setView([52.1,19.4],6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',maxZoom:18
    }).addTo(leafletMap);
    markersLayer=L.layerGroup().addTo(leafletMap);
  }
  markersLayer.clearLayers();
  const located=dogs.filter(d=>typeof d.lat==='number'&&typeof d.lng==='number');
  const bounds=[];
  for(const dog of located){
    const point=[dog.lat,dog.lng];bounds.push(point);
    const safeName=document.createElement('strong');safeName.textContent=dog.name;
    const popup=document.createElement('div');popup.append(safeName,document.createElement('br'),document.createTextNode(datePL(dog.createdAt)));
    L.marker(point).bindPopup(popup).addTo(markersLayer);
  }
  if(bounds.length)leafletMap.fitBounds(bounds,{padding:[38,38],maxZoom:14});
  $('map-message').textContent=located.length?`Zaznaczone spotkania: ${located.length}. Lokalizacje widzisz tylko Ty.`:'Brak zaznaczonych lokalizacji. Przy kolejnym zdjęciu możesz dobrowolnie włączyć GPS.';
  setTimeout(()=>leafletMap.invalidateSize(),100);
}
function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error); reader.readAsDataURL(blob);
  });
}
async function exportCollection() {
  const btn=$('export-data');btn.disabled=true;
  $('backup-message').textContent='Przygotowuję kopię...';
  try {
    const entries=await inStore('readonly',s=>s.getAll());
    const result=[];
    for (const d of entries) {
      const {photoBlob, ...metadata} = d;
      result.push({...metadata, photoData:await blobAsDataUrl(photoBlob)});
    }
    const body=JSON.stringify({format:'lapki-go-backup',version:1,exportedAt:new Date().toISOString(),dogs:result});
    const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;
    a.download='lapki-go-kopia-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    $('backup-message').textContent='Pobrano kopię. Plik może zawierać dokładne współrzędne GPS — nie udostępniaj go publicznie.';
  } catch(err) {$('backup-message').textContent='Błąd kopii: '+err.message;}
  finally {btn.disabled=false;}
}
async function importCollection(event) {
  const file=event.target.files?.[0]; if(!file)return;
  $('backup-message').textContent='Sprawdzam kopię...';
  try {
    if(file.size > 50*1024*1024)throw new Error('Plik jest za duży (maks. 50 MB).');
    const backup=JSON.parse(await file.text());
    if(backup.format!=='lapki-go-backup'||backup.version!==1||!Array.isArray(backup.dogs)||backup.dogs.length>5000)
      throw new Error('To nie jest obsługiwana kopia Łapki GO.');
    const existing=new Set((await inStore('readonly',s=>s.getAll())).map(d=>d.id));
    let added=0;
    for(const d of backup.dogs) {
      if(!d || typeof d.id!=='string' || d.id.length>100 || existing.has(d.id) ||
        typeof d.name!=='string' || d.name.length>32 ||
        !Number.isFinite(d.createdAt) || typeof d.photoData!=='string' ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d.photoData))continue;
      const photo=await (await fetch(d.photoData)).blob();
      if(photo.size>3*1024*1024)continue;
      const restored={id:d.id,name:d.name,createdAt:d.createdAt,photoBlob:photo,
        hash:typeof d.hash==='string'?d.hash:'',visual:typeof d.visual==='string'?d.visual:null,
        verified:d.verified===true,confidence:typeof d.confidence==='number'?d.confidence:0,
        lat:typeof d.lat==='number'&&d.lat>=-90&&d.lat<=90?d.lat:null,
        lng:typeof d.lng==='number'&&d.lng>=-180&&d.lng<=180?d.lng:null};
      await inStore('readwrite',s=>s.put(restored));existing.add(d.id);added++;
    }
    await reloadDogs();
    $('backup-message').textContent=`Przywrócono ${added} zdjęć. Istniejące wpisy zostały zachowane.`;
  } catch(err) {$('backup-message').textContent='Nie przywrócono: '+err.message;}
  finally {event.target.value='';}
}
async function removeEverything() {
  if (!confirm('Usunąć WSZYSTKIE zdjęcia, punkty i prywatne lokalizacje? Tego nie można cofnąć.'))return;
  if(!confirm('Potwierdź ostateczne usunięcie całej kolekcji.'))return;
  try {await inStore('readwrite',s=>s.clear());await reloadDogs();navigate('home');alert('Kolekcja została usunięta z tej przeglądarki.');}
  catch(err){alert('Nie udało się usunąć danych: '+err.message);}
}
function init() {
  document.querySelectorAll('[data-navigate]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.navigate)));
  $('start-camera').addEventListener('click',startCamera);
  $('camera-toggle').addEventListener('click',startCamera);
  $('snap-btn').addEventListener('click',capturePhoto);
  $('retake-btn').addEventListener('click',startCamera);
  $('save-dog').addEventListener('click',checkAndSave);
  $('save-unverified').addEventListener('click',saveUnverified);
  $('search-dogs').addEventListener('input',renderCollection);
  $('delete-all').addEventListener('click',removeEverything);
  $('export-data').addEventListener('click',exportCollection);
  $('import-data').addEventListener('change',importCollection);
  if ('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  reloadDogs().catch(err=>{
    $('home-empty').textContent='Przeglądarka nie pozwoliła otworzyć pamięci lokalnej. Sprawdź tryb prywatny i ustawienia przechowywania danych.';
    console.error('IndexedDB',err);
  });
}
init();
