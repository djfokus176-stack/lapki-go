/* Łapki GO MVP v0.4: psy + koty, lokalna kolekcja i prywatna mapa. */
'use strict';
const $ = (id) => document.getElementById(id);
const DB_NAME = 'lapki-go-v1';
const STORE = 'dogs';
const ANIMAL_CONFIDENCE_MIN = 0.55;
const animalLabel = species => species === 'cat' ? 'kot' : 'pies';
const animalGenitive = species => species === 'cat' ? 'kota' : 'psa';
const animalIcon = species => species === 'cat' ? '🐱' : '🐶';
const getSpecies = (entry) => entry?.species === 'cat' ? 'cat' : 'dog'; // stare wpisy to psy
const selectedSpecies = () => document.querySelector('input[name="animal-species"]:checked')?.value === 'cat' ? 'cat' : 'dog';
let collectionFilter = 'all';
let dbPromise, dogs = [], cameraStream = null, captured = null, modelPromise = null;
let processingPhoto = false;
let leafletMap = null, markersLayer = null, leafletPromise = null;
let photoInProgress = false, cameraStartToken = 0, pinDogId = null, locationLookupAt = 0;
const MAX_DAILY_POINTS = 15, POINT_COOLDOWN_MS = 20_000;
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
  }).catch(err=>{dbPromise=null;throw err;});
  return dbPromise;
}
async function inStore(mode, fn) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode), store=tx.objectStore(STORE);
    let request, result;
    try {request=fn(store);} catch(err) {try{tx.abort();}catch{} reject(err);return;}
    if(request){request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);}
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Zapis danych został przerwany.'));
  });
}
async function reloadDogs() {
  dogs = (await inStore('readonly',s=>s.getAll())).sort((a,b)=>b.createdAt-a.createdAt);
  renderAll();
}
function navigate(view) {
  for (const node of document.querySelectorAll('.view')) node.classList.toggle('active',node.id===`view-${view}`);
  for (const node of document.querySelectorAll('[data-navigate].nav-button')) node.classList.toggle('active',node.dataset.navigate===view);
  if (view!=='catch') {cameraStartToken++;stopCamera();}
  if (view==='map') setTimeout(renderMap,100);
  if (view==='collection') renderCollection();
  window.scrollTo({top:0,behavior:'auto'});
}
function cardFor(dog, urlBucket) {
  const card=document.createElement('article'); card.className='dog-card';
  const image=document.createElement('img'); image.className='dog-photo';
  const url=URL.createObjectURL(dog.photoBlob);urlBucket.push(url);
  const species=getSpecies(dog);
  image.src=url; image.alt=`Zdjęcie ${animalGenitive(species)}: ${dog.name}`; image.loading='lazy';
  const body=document.createElement('div');body.className='dog-card-body';
  const name=document.createElement('h3');name.className='dog-name';name.textContent=dog.name;
  const speciesBadge=document.createElement('span');speciesBadge.className='species-badge';speciesBadge.textContent=`${animalIcon(species)} ${species==='cat'?'Kot':'Pies'}`;
  const meta=document.createElement('p');meta.className='dog-meta';
  const place = (dog.placeName||'').trim();
  meta.textContent=`${datePL(dog.createdAt)} • ${place?`📍 ${place}`:typeof dog.lat==='number'?'📍 Punkt na mapie':'Bez lokalizacji'}`;
  const note=document.createElement('p');note.className='dog-meta dog-note';note.textContent=dog.note||'';note.hidden=!dog.note;
  const foot=document.createElement('div');foot.className='dog-card-footer';
  const points=document.createElement('span');points.className=`point-pill${dog.verified?'':' unverified'}`;
  points.textContent=dog.verified?'+10 pkt':'Niezweryfikowany • 0 pkt';
  const edit=document.createElement('button');edit.className='small-action';edit.type='button';edit.textContent='✏️ Edytuj';
  edit.addEventListener('click',()=>editDog(dog));
  const addPin=document.createElement('button');addPin.className='small-action';addPin.type='button';addPin.textContent='📍 Mapa';
  addPin.addEventListener('click',()=>startPinMode(dog.id));
  const remove=document.createElement('button');remove.className='delete-dog';remove.type='button';remove.textContent='Usuń';
  remove.setAttribute('aria-label',`Usuń zdjęcie ${animalGenitive(species)} ${dog.name}`);
  remove.addEventListener('click',async()=>{
    if (!confirm(`Na pewno usunąć ${dog.name} z kolekcji?`)) return;
    try {await inStore('readwrite',s=>s.delete(dog.id)); await reloadDogs();}
    catch(err){alert(`Nie udało się usunąć zdjęcia: ${err.message}`);}
  });
  foot.append(points);
  const actions=document.createElement('div');actions.className='card-actions';actions.append(edit,addPin,remove);
  body.append(speciesBadge,name,meta,note,foot,actions);card.append(image,body);return card;
}
async function editDog(dog) {
  const newName = prompt(`Nazwa ${animalGenitive(getSpecies(dog))}:`, dog.name);
  if (newName === null) return;
  const name = newName.trim().replace(/\s+/g,' ').slice(0,32);
  if (!name) {alert('Nazwa zwierzęcia nie może być pusta.'); return;}
  const newPlace = prompt('Miejscowość lub rejon spotkania (np. Trzebiatów). Zostaw puste, jeśli nie pamiętasz:',dog.placeName||'');
  if (newPlace === null) return;
  const placeName=newPlace.trim().replace(/\s+/g,' ').slice(0,80);
  const newNote=prompt('Opis zwierzęcia (np. umaszczenie, obroża). Możesz zostawić puste:',dog.note||'');
  if(newNote===null)return;
  const note=newNote.trim().replace(/\s+/g,' ').slice(0,120);
  try {
    await inStore('readwrite',s=>s.put({...dog,species:getSpecies(dog),name,placeName,note,locationSource:placeName?'manual':(dog.locationSource||null)}));
    await reloadDogs();
    $('collection-notice').textContent=`Zmieniono dane: ${name}. ${typeof dog.lat==='number'?'Punkt GPS pozostaje na mapie.':'Aby dodać pinezkę, naciśnij „Mapa” przy psie i wskaż miejsce.'}`;
  } catch(err) {alert('Nie zapisano zmian: '+err.message);}
}
function startPinMode(id) {
  pinDogId=id;
  $('pin-mode').hidden=false;
  const dog=dogs.find(d=>d.id===id);
  $('pin-mode-text').textContent=`Dotknij mapy w miejscu, w którym spotkano ${animalGenitive(getSpecies(dog))} ${dog?.name||''}. Nie używaj aktualnego GPS dla dawnych spotkań.`;
  navigate('map');
}
async function savePinAt(e) {
  if(!pinDogId)return;
  const dog=dogs.find(d=>d.id===pinDogId); if(!dog){cancelPinMode();return;}
  const entered=prompt(`Gdzie spotkano ${animalGenitive(getSpecies(dog))} ${dog.name}? Wpisz nazwę miejscowości lub rejon:`,dog.placeName||'');
  if(entered===null)return;
  try {
    const placeName=entered.trim().replace(/\s+/g,' ').slice(0,80)||'Miejsce wskazane na mapie';
    await inStore('readwrite',s=>s.put({...dog,species:getSpecies(dog),lat:e.latlng.lat,lng:e.latlng.lng,placeName,locationSource:'map'}));
    cancelPinMode(); await reloadDogs();
    $('map-message').textContent=`Zapisano punkt dla ${dog.name}: ${placeName}. Pinezka jest prywatna.`;
  } catch(err){$('map-message').textContent='Błąd zapisu miejsca: '+err.message;}
}
function cancelPinMode() {pinDogId=null;$('pin-mode').hidden=true;}
function replaceCards(container, items) {
  for (const url of (cardUrls.get(container)||[])) URL.revokeObjectURL(url);
  const urls=[]; cardUrls.set(container,urls);
  container.replaceChildren();
  for (const dog of items) container.append(cardFor(dog,urls));
}
function renderAll() {
  const verified=dogs.filter(d=>d.verified);
  $('stat-dogs').textContent=dogs.filter(d=>getSpecies(d)==='dog').length;
  $('stat-cats').textContent=dogs.filter(d=>getSpecies(d)==='cat').length;
  $('stat-points').textContent=verified.length*10;
  $('stat-places').textContent=new Set(dogs.map(d=>d.placeName?.trim()|| (typeof d.lat==='number'?`${d.lat.toFixed(2)},${d.lng.toFixed(2)}`:null)).filter(Boolean)).size;
  $('collection-count').textContent=`${dogs.length} zdjęć`;
  replaceCards($('recent-grid'),dogs.slice(0,4));
  $('home-empty').hidden=dogs.length>0;
  renderCollection();
  if (leafletMap) renderMap();
}
function renderCollection() {
  if (!dogs) return;
  const q=($('search-dogs').value||'').trim().toLocaleLowerCase('pl-PL');
  const filtered=dogs.filter(d=>
    (collectionFilter==='all'||getSpecies(d)===collectionFilter) &&
    (d.name+' '+(d.placeName||'')+' '+(d.note||'')+' '+(getSpecies(d)==='cat'?'kot':'pies')).toLocaleLowerCase('pl-PL').includes(q)
  );
  replaceCards($('collection-grid'),filtered);
  $('collection-empty').hidden=filtered.length>0;
  $('collection-empty').textContent=dogs.length===0?'Jeszcze nie masz zwierząt w kolekcji.':'Brak pasujących zdjęć.';
}
function stopCamera() {
  if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;}
  $('camera-video').srcObject=null;$('camera-video').hidden=true;
  if(!captured){$('camera-placeholder').hidden=false;$('camera-toggle').hidden=false;}
  $('snap-btn').hidden=true;
}
async function startCamera() {
  navigate('catch');
  const token=++cameraStartToken;
  $('camera-toggle').disabled=true;
  if(!navigator.mediaDevices?.getUserMedia){$('camera-toggle').disabled=false;setStatus('Aparat nie jest dostępny. Uruchom aplikację przez HTTPS na telefonie.');return;}
  try {
    setStatus('Uruchamiam aparat…');
    clearCaptured();
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
    if(token!==cameraStartToken || !$('view-catch').classList.contains('active')) {stream.getTracks().forEach(t=>t.stop());return;}
    cameraStream=stream;
    const video=$('camera-video');video.srcObject=stream;
    await video.play();
    if(token!==cameraStartToken || !$('view-catch').classList.contains('active')) {stopCamera();return;}
    video.hidden=false;$('camera-placeholder').hidden=true;
    $('camera-toggle').hidden=true;$('snap-btn').hidden=false;
    setStatus(`Skieruj aparat na ${animalGenitive(selectedSpecies())}. Nie zbliżaj się do obcych zwierząt bez zgody opiekuna.`);
  } catch(err) {
    if(token===cameraStartToken){stopCamera();setStatus(`Brak dostępu do aparatu: ${err.message}. Sprawdź uprawnienia przeglądarki.`);}
  } finally {$('camera-toggle').disabled=false;}
}
function clearCaptured() {
  if(captured?.url)URL.revokeObjectURL(captured.url);
  captured=null;
  $('photo-preview').hidden=true;$('photo-preview').removeAttribute('src');
  $('photo-fields').hidden=true;$('retake-btn').hidden=true;$('save-unverified').hidden=true;
  $('save-dog').disabled=false;$('dog-name').value='';$('save-location').checked=false;$('place-name').value='';$('dog-note').value='';
  setAiStatus('Zdjęcie gotowe do sprawdzenia.');
}
async function capturePhoto() {
  if(photoInProgress)return; photoInProgress=true; $('snap-btn').disabled=true;
  const video=$('camera-video');
  if (!cameraStream || !video.videoWidth) {setStatus('Aparat nie jest jeszcze gotowy.');photoInProgress=false;$('snap-btn').disabled=false;return;}
  try {
    const maxEdge=1024, scale=Math.min(1,maxEdge/Math.max(video.videoWidth,video.videoHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Nie udało się zrobić zdjęcia.')),'image/jpeg',.77));
    stopCamera();
    const url=URL.createObjectURL(blob);captured={blob,url};
    $('photo-preview').src=url;$('photo-preview').hidden=false;$('camera-placeholder').hidden=true;
    $('camera-toggle').hidden=true;$('retake-btn').hidden=false;$('photo-fields').hidden=false;
    setStatus(`Zdjęcie zrobione. Nazwij ${animalGenitive(selectedSpecies())} i zapisz.`);
  } catch(err){setStatus(`Błąd fotografowania: ${err.message}`);}
  finally {photoInProgress=false;$('snap-btn').disabled=false;}
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
  if (!('geolocation' in navigator)) return Promise.resolve({coords:null,error:'Ten telefon nie udostępnia GPS.'});
  return new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({coords:{lat:pos.coords.latitude,lng:pos.coords.longitude},error:null}),
      err=>resolve({coords:null,error:err.code===1?'Nie udzielono zgody na lokalizację.':err.code===3?'Upłynął czas pobierania lokalizacji.':'Nie udało się ustalić położenia.'}),
      {enableHighAccuracy:true,maximumAge:15000,timeout:12000}
    );
  });
}
// Używamy tylko po świadomym zaznaczeniu GPS i kliknięciu „Zapisz”.
// Darmowy Nominatim: wyłącznie małe testy, pojedyncze zapytania, cache po ok. 2 km.
async function resolvePlace(coords) {
  if(!coords)return null;
  const key=`lapki-place-${coords.lat.toFixed(2)}-${coords.lng.toFixed(2)}`;
  try {const cached=localStorage.getItem(key);if(cached)return cached;}catch{}
  const wait=Math.max(0,1200-(Date.now()-locationLookupAt));
  if(wait) await new Promise(resolve=>setTimeout(resolve,wait));
  locationLookupAt=Date.now();
  try {
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5500);
    let response;
    try {response=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lng)}&zoom=10&addressdetails=1&accept-language=pl`, {signal:controller.signal,headers:{'Accept':'application/json'}});}finally{clearTimeout(timeout);}
    if(!response.ok)return null;
    const data=await response.json();const a=data.address||{};
    const label=[a.city||a.town||a.village||a.hamlet||a.municipality||a.county||a.suburb, a.state].filter(Boolean).join(', ').slice(0,80);
    if(label){try{localStorage.setItem(key,label);}catch{}return label;}
  } catch{}return null;
}
function pointsStatus(now=Date.now()) {
  const today=new Date(now).toLocaleDateString('en-CA');
  const scored=dogs.filter(d=>d.verified);
  const todayScored=scored.filter(d=>new Date(d.createdAt).toLocaleDateString('en-CA')===today);
  const lastTime=Math.max(0,...scored.map(d=>d.createdAt));
  if(todayScored.length>=MAX_DAILY_POINTS)return `Dzienny limit ${MAX_DAILY_POINTS} punktowanych zdjęć został osiągnięty. Możesz wrócić jutro.`;
  if(lastTime && now-lastTime<POINT_COOLDOWN_MS)return `Poczekaj jeszcze ${Math.ceil((POINT_COOLDOWN_MS-(now-lastTime))/1000)} s przed kolejnym punktowanym zdjęciem.`;
  return null;
}

async function savePhoto({verified,confidence=0,visual=null}) {
  const species=selectedSpecies();
  const name=$('dog-name').value.trim().replace(/\s+/g,' ').slice(0,32)||(species==='cat'?'Nieznajomy kot':'Nieznajomy pies');
  if (!captured) return;
  const shot=captured;
  const hashed=await sha256(shot.blob);
  // Także zdjęcia do testów nie powinny się duplikować.
  if(dogs.some(d=>d.hash===hashed))throw new Error('To samo zdjęcie już istnieje w kolekcji.');
  if(verified){const block=pointsStatus();if(block)throw new Error(block);}
  const manualPlace=$('place-name').value.trim().replace(/\s+/g,' ').slice(0,80);
  const note=$('dog-note').value.trim().replace(/\s+/g,' ').slice(0,120);
  let coords=null, placeName=manualPlace, locationError='';
  if($('save-location').checked){
    setAiStatus('Pobieram GPS i nazwę miejscowości. Może to potrwać kilka sekund…');
    const result=await gpsWithTimeout();coords=result.coords;locationError=result.error||'';
    if(coords&&!manualPlace)placeName=await resolvePlace(coords)||'';
  }
  const dog={id:crypto.randomUUID(),species,name,createdAt:Date.now(),photoBlob:shot.blob,
    hash:hashed,visual,verified,confidence,lat:coords?.lat??null,lng:coords?.lng??null,
    placeName,note,locationSource:manualPlace?'manual':coords?(placeName?'gps':'coordinates'):null};
  await inStore('readwrite',s=>s.add(dog));
  clearCaptured();$('camera-placeholder').hidden=false;$('camera-toggle').hidden=false;
  await reloadDogs();
  $('collection-notice').textContent=locationError
    ?`Zapisano ${animalGenitive(species)}, ale GPS nie działał: ${locationError} Możesz później użyć „Edytuj” i „Mapa”.`
    :coords&&!placeName?'Zwierzę zapisane z pinezką. Nie udało się pobrać nazwy miejscowości — możesz dopisać ją przyciskiem „Edytuj”.'
    :`Zapisano ${name}${placeName?` — ${placeName}`:''}. ${coords?'Pinezka jest na mapie.':''}`;
  navigate('collection');
}

async function checkAndSave() {
  if (!captured || processingPhoto) return;
  processingPhoto=true;
  const button=$('save-dog');button.disabled=true;$('save-unverified').hidden=true;
  try {
    const species=selectedSpecies();
    setAiStatus(`Wczytuję lokalny model AI i sprawdzam, czy widać ${animalGenitive(species)}…`);
    const hash=await sha256(captured.blob);
    if(dogs.some(d=>d.hash===hash)){setAiStatus('Takie samo zdjęcie jest już w kolekcji. Zrób nowe.','bad');return;}
    const model=await getModel();
    await $('photo-preview').decode();
    const detections=await model.detect($('photo-preview'));
    if (detections.some(d => d.class === 'person' && d.score >= .55)) {
      setAiStatus('Na zdjęciu AI widzi człowieka. Zrób nowe zdjęcie samego zwierzęcia bez osób w kadrze.', 'bad'); return;
    }
    if(detections.some(d=>['tv','laptop','cell phone'].includes(d.class) && d.score>=.70)) {
      setAiStatus('AI wykryło ekran, laptop lub telefon. Nie fotografuj zdjęć zwierząt z internetu.', 'bad');return;
    }
    const found=detections.filter(d=>d.class===species).sort((a,b)=>b.score-a.score);
    const confidence=found[0]?.score??0;
    if(confidence<ANIMAL_CONFIDENCE_MIN){
      const other=species==='cat'?'dog':'cat';
      const otherFound=detections.find(d=>d.class===other&&d.score>=ANIMAL_CONFIDENCE_MIN);
      setAiStatus(otherFound ? `AI wykryło ${animalGenitive(other)}, a wybrano ${animalGenitive(species)}. Zmień gatunek i zrób zdjęcie ponownie.` : `AI nie rozpoznało ${animalGenitive(species)} z wystarczającą pewnością. Zrób wyraźniejsze zdjęcie.`, 'bad');return;
    }
    const visual = visualHash($('photo-preview'), found[0].bbox);
    if (dogs.some(d => d.visual && hashDistance(visual, d.visual) <= 4)) {
      setAiStatus('To zdjęcie wygląda bardzo podobnie do jednego z Twoich wcześniejszych ujęć. Zrób inne zdjęcie.','bad'); return;
    }
    setAiStatus(`Wykryto ${animalGenitive(species)} (pewność ${(confidence*100).toFixed(0)}%). Zapisuję…`,'good');
    await savePhoto({verified:true,confidence,visual});
  } catch(err) {
    setAiStatus(`Nie udało się zweryfikować lub zapisać zdjęcia: ${err.message}`, 'bad');
    // Alternatywny zapis bez punktów tylko wtedy, gdy model AI / łączność uległy awarii.
    if(!modelPromise || /model|network|fetch|pobrać|AI/i.test(err.message))$('save-unverified').hidden=false;
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
    leafletMap.on('click', savePinAt);
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
    const species=getSpecies(dog);
    const safeName=document.createElement('strong');safeName.textContent=`${animalIcon(species)} ${dog.name}`;
    const popup=document.createElement('div');
    popup.append(safeName,document.createElement('br'),document.createTextNode(dog.placeName||'Miejsce wskazane na mapie'),document.createElement('br'),document.createTextNode(datePL(dog.createdAt)));if(dog.note)popup.append(document.createElement('br'),document.createTextNode(dog.note));
    const markerIcon=L.divIcon({html:`<span aria-hidden="true">${animalIcon(species)}</span>`,className:'animal-pin',iconSize:[35,35],iconAnchor:[17,30]});
    L.marker(point,{icon:markerIcon}).bindPopup(popup).addTo(markersLayer);
  }
  if(bounds.length && !pinDogId)leafletMap.fitBounds(bounds,{padding:[38,38],maxZoom:14});
  $('map-message').textContent=located.length?`Pinezki: ${located.length}. 🐶 psy i 🐱 koty widoczne tylko na tym urządzeniu.`:'Brak pinezek. Użyj GPS przy zdjęciu lub „Mapa” na karcie zwierzęcia i wskaż miejsce.';
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
    const body=JSON.stringify({format:'lapki-go-backup',version:2,exportedAt:new Date().toISOString(),animals:result});
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
    if(backup.format!=='lapki-go-backup'||![1,2].includes(backup.version))
      throw new Error('To nie jest obsługiwana kopia Łapki GO.');
    const entries=backup.version===1?backup.dogs:backup.animals;
    if(!Array.isArray(entries)||entries.length>5000)throw new Error('Niepoprawna lista zdjęć w kopii.');
    const existing=new Set((await inStore('readonly',s=>s.getAll())).map(d=>d.id));
    let added=0;
    for(const d of entries) {
      if(!d || typeof d.id!=='string' || d.id.length>100 || existing.has(d.id) ||
        typeof d.name!=='string' || d.name.length>32 ||
        !Number.isFinite(d.createdAt) || typeof d.photoData!=='string' ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d.photoData))continue;
      const photo=await (await fetch(d.photoData)).blob();
      if(photo.size>3*1024*1024)continue;
      const restored={id:d.id,species:getSpecies(d),name:d.name,createdAt:d.createdAt,photoBlob:photo,
        hash:typeof d.hash==='string'?d.hash:'',visual:typeof d.visual==='string'?d.visual:null,
        verified:d.verified===true,confidence:typeof d.confidence==='number'?d.confidence:0,
        lat:typeof d.lat==='number'&&d.lat>=-90&&d.lat<=90?d.lat:null,
        lng:typeof d.lng==='number'&&d.lng>=-180&&d.lng<=180?d.lng:null,
        placeName:typeof d.placeName==='string'?d.placeName.trim().slice(0,80):'',
        note:typeof d.note==='string'?d.note.trim().slice(0,120):'',
        locationSource:typeof d.locationSource==='string'?d.locationSource.slice(0,20):null};
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
function updateSpeciesUI() {
  const species=selectedSpecies();
  const animal=animalGenitive(species);
  $('dog-name-label').textContent=`Jak nazwiesz tego ${animal}?`;
  $('dog-name').placeholder=species==='cat'?'Np. Mruczek, Puszek, Łatka':'Np. Borys, Rudzielec, Łaciatek';
  $('dog-note-label').textContent=`Opis ${animal} (opcjonalnie)`;
  $('catch-lead').textContent=`Zrób zdjęcie żywego ${animal} — nie z galerii. AI sprawdzi wybrany gatunek bez wysyłania zdjęcia na serwer.`;
  $('camera-placeholder-icon').textContent=animalIcon(species);
  $('camera-preview-label').textContent=`Podgląd zdjęcia ${animal}`;
  $('save-dog').textContent=`✅ Sprawdź i zapisz ${animal}`;
  // Zdjęcie zrobione dla innego gatunku nie może zostać ponownie sklasyfikowane bez nowego ujęcia.
  if(captured){clearCaptured();$('camera-placeholder').hidden=false;$('camera-toggle').hidden=false;setStatus('Zmieniono gatunek. Zrób nowe zdjęcie.');}
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
  $('cancel-pin').addEventListener('click',cancelPinMode);
  document.querySelectorAll('input[name="animal-species"]').forEach(radio => radio.addEventListener('change', updateSpeciesUI));
  document.querySelectorAll('[data-filter-species]').forEach(btn=>btn.addEventListener('click',()=>{
    collectionFilter=btn.dataset.filterSpecies;
    document.querySelectorAll('[data-filter-species]').forEach(b=>{const active=b.dataset.filterSpecies===collectionFilter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    renderCollection();
  }));
  updateSpeciesUI();
  if ('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  reloadDogs().catch(err=>{
    $('home-empty').textContent='Przeglądarka nie pozwoliła otworzyć pamięci lokalnej. Sprawdź tryb prywatny i ustawienia przechowywania danych.';
    console.error('IndexedDB',err);
  });
}
init();
