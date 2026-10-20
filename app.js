/* Łapki GO MVP v0.6: psy, koty, misje spacerowe z opcjonalnym pomiarem GPS. */
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
const WALK_STORAGE_KEY = 'lapki-go-missions-v1';
const REPORTS_STORAGE_KEY = 'lapki-go-local-reports-v1';
let reports=[];
let walkWatchId=null, lastWalkFix=null;
let gpsStatus='GPS nieaktywny';
const GPS_MAX_ACCURACY=70; // metres
const GPS_MAX_WALKING_SPEED=3.5; // metres/second; reject car/train/teleport jumps
const GPS_MAX_GAP_MS=90000;
const clampMeters = n => Number.isFinite(n) ? Math.max(0,Math.min(n,1e6)) : 0;
const kmDisplay = n => (clampMeters(n)/1000).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2});
function haversineMeters(lat1,lon1,lat2,lon2){
  const r=Math.PI/180,dl=(lat2-lat1)*r, dn=(lon2-lon1)*r;
  const h=Math.sin(dl/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dn/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
function stopWalkGps(){
  if(walkWatchId!==null && navigator.geolocation){navigator.geolocation.clearWatch(walkWatchId);walkWatchId=null;}
  lastWalkFix=null;
}
function handleWalkPosition(position){
  const active=walkState.active;if(!active || document.visibilityState==='hidden')return;
  const {latitude:lat,longitude:lng,accuracy}=position.coords, at=position.timestamp||Date.now();
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(accuracy)||accuracy>GPS_MAX_ACCURACY ||accuracy<0){
    gpsStatus=`Sygnał GPS za słaby (dokładność ±${Math.round(accuracy||0)} m). Poczekaj na lepszy zasięg.`;renderMissions();return;
  }
  const fix={lat,lng,at,accuracy};
  if(!lastWalkFix){lastWalkFix=fix;gpsStatus=`GPS działa, dokładność ±${Math.round(accuracy)} m. Rusz na spacer.`;renderMissions();return;}
  const dt=(at-lastWalkFix.at)/1000;
  if(dt<=0)return;
  const meters=haversineMeters(lastWalkFix.lat,lastWalkFix.lng,lat,lng);
  const minMovement=Math.max(10,Math.min(30,(lastWalkFix.accuracy+accuracy)*0.35));
  if(dt>GPS_MAX_GAP_MS){lastWalkFix=fix;gpsStatus='Po dłuższej przerwie pomiar wznowiony. Odcinka bez GPS nie doliczono.';renderMissions();return;}
  if(meters>250 || meters/dt>GPS_MAX_WALKING_SPEED){
    // Avoid treating teleportation as a route; reset baseline to avoid repeated jumps.
    lastWalkFix=fix;gpsStatus='Pominięto skok GPS lub prędkość zbyt dużą dla spaceru.';renderMissions();return;
  }
  if(meters<minMovement){gpsStatus=`GPS działa (±${Math.round(accuracy)} m), czekam na wyraźne przemieszczenie.`;return;}
  active.distanceMeters=clampMeters((active.distanceMeters||0)+meters);
  active.gpsPoints=(active.gpsPoints||0)+1;
  lastWalkFix=fix;
  gpsStatus=`GPS aktywny • ±${Math.round(accuracy)} m • zliczono ${active.gpsPoints} odcinków.`;
  writeWalkState();renderMissions();
}
function startWalkGps(){
  if(!walkState.active || walkWatchId!==null || document.visibilityState==='hidden')return;
  if(!walkState.active.gpsEnabled){gpsStatus='GPS wyłączony dla tego spaceru.';renderMissions();return;}
  if(!navigator.geolocation){gpsStatus='Brak geolokalizacji w tej przeglądarce.';renderMissions();return;}
  gpsStatus='Proszę o lokalizację GPS…';
  try{walkWatchId=navigator.geolocation.watchPosition(handleWalkPosition,err=>{
    gpsStatus=err.code===1?'Odmówiono GPS. Włącz lokalizację w ustawieniach przeglądarki.':err.code===3?'Czekam na GPS (przekroczono czas próby).':'GPS niedostępny. Sprawdź ustawienia telefonu.';
    renderMissions();
    if(err.code===1){stopWalkGps();}
  },{enableHighAccuracy:true,maximumAge:0,timeout:20000});}
  catch {gpsStatus='Nie udało się uruchomić GPS.';}
  renderMissions();
}
function readReports(){try{const v=JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY)||'[]');return Array.isArray(v)?v.filter(x=>typeof x.id==='string'&&typeof x.reason==='string').slice(-100):[];}catch{return []}}
function saveReports(){try{localStorage.setItem(REPORTS_STORAGE_KEY,JSON.stringify(reports));return true;}catch{return false}}

const WALK_REWARDS = {0:0,15:15, 30:35, 45:60};
const hasDiscoveryPoints = dog => dog.verified===true && dog.source!=='gallery';
let walkState = {active:null,history:[]};
function readWalkState() {
  try {
    const data=JSON.parse(localStorage.getItem(WALK_STORAGE_KEY)||'{}');
    return {active:data.active && Number.isFinite(data.active.startedAt) && Object.hasOwn(WALK_REWARDS,data.active.minutes) ?
      {startedAt:data.active.startedAt,minutes:data.active.minutes,distanceMeters:clampMeters(data.active.distanceMeters),gpsPoints:Number(data.active.gpsPoints)||0,gpsEnabled:data.active.gpsEnabled!==false}:null,
      history:Array.isArray(data.history) ? data.history.filter(h=>Number.isFinite(h.finishedAt)&& Number.isFinite(h.earnedXp) && h.earnedXp>=0 && h.earnedXp<=60 && Object.hasOwn(WALK_REWARDS,h.minutes)).slice(-500):[]};
  } catch {return {active:null,history:[]};}
}
function writeWalkState() {
  try {localStorage.setItem(WALK_STORAGE_KEY,JSON.stringify(walkState)); return true;}
  catch { $('walk-notice').textContent='Nie można zapisać misji w tej przeglądarce. Sprawdź dostępne miejsce lub tryb prywatny.';return false; }
}
const todayKey = time => {const date=new Date(time);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');};
const walkXp = () => walkState.history.reduce((sum,h)=>sum+h.earnedXp,0);
const totalXp = () => dogs.filter(hasDiscoveryPoints).length * 10 + walkXp();
const levelFromXp = xp => Math.floor(xp/100)+1;
function renderMissions() {
  const xp=totalXp(),level=levelFromXp(xp),current=xp%100;
  $('mission-level').textContent=`Poziom ${level}`;
  $('mission-xp').textContent=`${xp} XP`;
  $('mission-xp-bar').style.width=`${current}%`;
  $('mission-xp-next').textContent=`Do poziomu ${level+1}: ${100-current} XP`;
  $('home-level').textContent=`Poziom ${level} • ${xp} XP`;
  const active=walkState.active;
  $('mission-choices').hidden=!!active;
  $('walk-live').hidden=!active;
  if(active) {
    const left=Math.max(0, active.startedAt+active.minutes*60000-Date.now());
    const minutes=Math.floor(left/60000),seconds=Math.ceil((left%60000)/1000);
    $('walk-mission-name').textContent=active.minutes===0?'Spacer swobodny • bez limitu czasu':`Misja ${active.minutes} minut`;
    $('walk-countdown').textContent=active.minutes===0?'∞':left>0?`${String(minutes).padStart(2,'0')}:${String(seconds===60?59:seconds).padStart(2,'0')}`:'00:00';
    const elapsed=Math.max(0,Date.now()-active.startedAt);
    $('walk-elapsed').textContent=`${Math.floor(elapsed/60000)} min`;
    $('walk-km').textContent=`${kmDisplay(active.distanceMeters)} km`;
    const avg=elapsed>0 ? (clampMeters(active.distanceMeters)/1000)/(elapsed/3600000):0;
    $('walk-avg').textContent=`${avg.toLocaleString('pl-PL',{maximumFractionDigits:1})} km/h`;
    $('walk-gps-state').textContent=gpsStatus;
    $('walk-progress').textContent=active.minutes===0?'Spacer bez limitu: możesz zakończyć kiedy chcesz. Kilometry zliczamy podczas aktywnego GPS.':left>0?'Minuty liczymy od startu. Dystans GPS nalicza się tylko gdy aplikacja jest aktywna i ma dostęp do lokalizacji.':'Upłynął czas misji. Możesz ją zakończyć i zapisać przebyty dystans.';
    $('finish-walk').disabled=active.minutes===0?false:left>0;
    $('finish-walk').textContent=active.minutes===0?'✅ Zakończ spacer':'✅ Zakończ misję';
  }
  const completed=walkState.history.length;
  const achievements=[['🐾 Pierwszy krok', completed>=1],['🚶 3 spacery',completed>=3],['🏅 10 spacerów',completed>=10],['🌟 Poziom 5',level>=5]];
  $('walk-achievements').replaceChildren(...achievements.map(([label,unlocked])=>{
    const badge=document.createElement('span');badge.className='achievement'+(unlocked?'':' locked');badge.textContent=`${unlocked?'✓':'🔒'} ${label}`;return badge;
  }));
  const record=completed?Math.max(...walkState.history.map(h=>h.actualMinutes??h.minutes)):0;
  const totalMeters=walkState.history.reduce((s,h)=>s+clampMeters(h.distanceMeters),0);
  $('walk-history').textContent=`Zakończone spacery: ${completed} • ${kmDisplay(totalMeters)} km łącznie • ${walkXp()} XP • najdłuższa misja ${record} min.`;
  $('home-km').textContent=`${kmDisplay(totalMeters)} km zapisanych spacerów`;
}
function startWalk(minutes) {
  if(walkState.active || !Object.hasOwn(WALK_REWARDS,minutes))return;
  walkState.active={startedAt:Date.now(),minutes,distanceMeters:0,gpsPoints:0,gpsEnabled:$('walk-gps-choice').checked};
  gpsStatus=walkState.active.gpsEnabled?'Uruchamiam GPS…':'GPS wyłączony dla tego spaceru.';
  if(!writeWalkState()){walkState.active=null;return;}
  $('walk-notice').textContent=minutes===0?'Spacer swobodny rozpoczęty. Możesz zakończyć w dowolnym momencie.':`Misja ${minutes} minut rozpoczęta. Wybieraj bezpieczne trasy.`;
  renderMissions();startWalkGps();
}
function finishWalk() {
  const active=walkState.active;
  if(!active || Date.now()<active.startedAt+active.minutes*60000)return;
  const today=todayKey(active.startedAt), alreadyRewarded=walkState.history.some(h=>h.day===today&&h.earnedXp>0);
  const earnedXp=alreadyRewarded?0:WALK_REWARDS[active.minutes];
  walkState.history.push({day:today,minutes:active.minutes,actualMinutes:Math.max(0,Math.round((Date.now()-active.startedAt)/60000)),finishedAt:Date.now(),earnedXp,distanceMeters:clampMeters(active.distanceMeters),gpsMeasured:!!active.gpsPoints});
  stopWalkGps();walkState.active=null;
  if(writeWalkState()) $('walk-notice').textContent=active.minutes===0?`Zapisano spacer swobodny: ${kmDisplay(active.distanceMeters)} km (GPS). Za ten tryb nie przyznajemy XP.`:earnedXp?`🎉 Misja zakończona! +${earnedXp} XP. Gratulacje!`:'Misja zakończona! Dzisiejsze XP zostały już przyznane przy wcześniejszym spacerze.';
  renderMissions();
}
async function shareProgress() {
  const summary=`🐾 Łapki GO: poziom ${levelFromXp(totalXp())}, ${totalXp()} XP, ${dogs.filter(d=>getSpecies(d)==='dog').length} psów, ${dogs.filter(d=>getSpecies(d)==='cat').length} kotów i ${walkState.history.length} spacerów i ${kmDisplay(walkState.history.reduce((s,h)=>s+clampMeters(h.distanceMeters),0))} km (GPS orientacyjny)! Sprawdź grę: https://djfokus176-stack.github.io/lapki-go/`;
  try {
    if(navigator.share) await navigator.share({title:'Łapki GO — mój wynik',text:summary});
    else if(navigator.clipboard?.writeText) {await navigator.clipboard.writeText(summary);$('walk-notice').textContent='Skopiowano wynik do schowka. Możesz wysłać go znajomym.';}
    else {prompt('Skopiuj wynik:',summary);}
  } catch(err) {if(err.name!=='AbortError')$('walk-notice').textContent='Nie udało się udostępnić wyniku.';}
}
function cancelWalk() {
  if(!walkState.active || !confirm('Anulować trwającą misję? Nie dostaniesz XP.'))return;
  stopWalkGps();walkState.active=null;writeWalkState();renderMissions();$('walk-notice').textContent='Misja anulowana.';
}
async function testGps() {
  const btn=$('test-gps');btn.disabled=true;$('gps-test-result').textContent='Sprawdzam dostęp do GPS...';
  try {
    const result=await gpsWithTimeout();
    $('gps-test-result').textContent=result.coords
      ? `✅ GPS działa (dokładność około ±${Math.round(result.coords.accuracy||0)} m): ${result.coords.lat.toFixed(5)}, ${result.coords.lng.toFixed(5)}. To tylko test — nie zapisujemy miejsca ani nie udostępniamy go.`
      : `⚠️ ${result.error||'Nie udało się ustalić położenia.'} Sprawdź zgodę na lokalizację w telefonie.`;
  } finally{btn.disabled=false;}
}


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
  if (view==='missions') renderMissions();
  window.scrollTo({top:0,behavior:'auto'});
}
function cardFor(dog, urlBucket) {
  const card=document.createElement('article'); card.className='dog-card';
  const image=document.createElement('img'); image.className='dog-photo';
  const url=URL.createObjectURL(dog.photoBlob);urlBucket.push(url);
  const species=getSpecies(dog);
  image.src=url; if(dog.flaggedLocal)image.classList.add('photo-hidden-report'); image.alt=`Zdjęcie ${animalGenitive(species)}: ${dog.name}`; image.loading='lazy';
  const body=document.createElement('div');body.className='dog-card-body';
  const name=document.createElement('h3');name.className='dog-name';name.textContent=dog.name;
  const speciesBadge=document.createElement('span');speciesBadge.className='species-badge';speciesBadge.textContent=`${animalIcon(species)} ${species==='cat'?'Kot':'Pies'}`;
  const meta=document.createElement('p');meta.className='dog-meta';
  const place = (dog.placeName||'').trim();
  meta.textContent=`${datePL(dog.createdAt)} • ${place?`📍 ${place}`:typeof dog.lat==='number'?'📍 Punkt na mapie':'Bez lokalizacji'}`;
  const note=document.createElement('p');note.className='dog-meta dog-note';note.textContent=dog.note||'';note.hidden=!dog.note;
  const foot=document.createElement('div');foot.className='dog-card-footer';
  const points=document.createElement('span');points.className=`point-pill${dog.verified?'':' unverified'}`;
  points.textContent=hasDiscoveryPoints(dog)?'+10 pkt':dog.source==='gallery'?'🖼️ Galeria • 0 pkt':'Bez punktów • 0 pkt';
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
  const report=document.createElement('button');report.type='button';report.className='small-action';report.textContent=dog.flaggedLocal?'👁 Zgłoszone lokalnie':'⚑ Zgłoś';
  report.addEventListener('click',()=>{
    $('report-animal-id').value=String(dog.id);$('report-target-name').textContent=`Wybrano: ${dog.name} (${animalLabel(getSpecies(dog))}).`;
    navigate('settings');$('local-report-box').scrollIntoView({behavior:'smooth',block:'center'});
  });
  const actions=document.createElement('div');actions.className='card-actions';actions.append(edit,addPin,report,remove);
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
  const verified=dogs.filter(hasDiscoveryPoints);
  $('stat-dogs').textContent=dogs.filter(d=>getSpecies(d)==='dog').length;
  $('stat-cats').textContent=dogs.filter(d=>getSpecies(d)==='cat').length;
  $('stat-points').textContent=verified.length*10;
  $('stat-places').textContent=new Set(dogs.map(d=>d.placeName?.trim()|| (typeof d.lat==='number'?`${d.lat.toFixed(2)},${d.lng.toFixed(2)}`:null)).filter(Boolean)).size;
  $('collection-count').textContent=`${dogs.length} zdjęć`;
  replaceCards($('recent-grid'),dogs.slice(0,4));
  $('home-empty').hidden=dogs.length>0;
  renderCollection();
  if (leafletMap) renderMap();
  renderMissions();
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
  $('save-dog').disabled=false;$('dog-name').value='';$('save-location').checked=false;$('save-location').disabled=false;$('place-name').value='';$('dog-note').value='';
  $('photo-source-note').hidden=true;
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
    const url=URL.createObjectURL(blob);captured={blob,url,source:'camera'};
    $('photo-preview').src=url;$('photo-preview').hidden=false;$('camera-placeholder').hidden=true;
    $('camera-toggle').hidden=true;$('retake-btn').hidden=false;$('photo-fields').hidden=false;
    setStatus(`Zdjęcie zrobione. Nazwij ${animalGenitive(selectedSpecies())} i zapisz.`);
  } catch(err){setStatus(`Błąd fotografowania: ${err.message}`);}
  finally {photoInProgress=false;$('snap-btn').disabled=false;}
}
async function chooseGalleryPhoto(event) {
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(processingPhoto || photoInProgress){setStatus('Poczekaj na zakończenie obecnej operacji.');return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) {setStatus('Wybierz JPG, PNG lub WebP. Zdjęcia HEIC należy najpierw przekonwertować.');return;}
  if(file.size>12*1024*1024){setStatus('Plik jest za duży — maksymalnie 12 MB.');return;}
  const button=$('gallery-file');button.disabled=true;
  let imageBitmap=null,imageURL=null;
  try {
    cameraStartToken++;stopCamera();clearCaptured();
    const img=new Image();imageURL=URL.createObjectURL(file);img.src=imageURL;
    await img.decode();
    const width=img.naturalWidth,height=img.naturalHeight;
    if(!width||!height||width*height>75_000_000)throw new Error('Zbyt duża rozdzielczość zdjęcia (maks. 75 MP).');
    const scale=Math.min(1,1024/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Brak obsługi przetwarzania zdjęć.');
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Nie udało się przetworzyć fotografii.')),'image/jpeg',.77));
    const url=URL.createObjectURL(blob);captured={blob,url,source:'gallery'};
    $('photo-preview').src=url;$('photo-preview').hidden=false;$('camera-placeholder').hidden=true;
    $('camera-toggle').hidden=false;$('retake-btn').hidden=true;$('photo-fields').hidden=false;
    $('save-location').checked=false;$('save-location').disabled=true;
    $('photo-source-note').hidden=false;
    $('photo-source-note').textContent='🖼️ Zdjęcie z galerii: można dodać do prywatnego albumu, ale bez XP. Aktualny GPS jest wyłączony, żeby nie przypisać starszej fotografii fałszywego miejsca. Miejscowość wpisz ręcznie albo później wskaż punkt na mapie.';
    setStatus('Fotografia wczytana. AI sprawdzi gatunek. Zdjęcie z galerii nie daje punktów.');
  } catch(err){setStatus(`Nie udało się otworzyć zdjęcia: ${err.message}`);}
  finally {if(imageURL)URL.revokeObjectURL(imageURL); if(imageBitmap)imageBitmap.close();button.disabled=false;}
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
  if(!/^[a-f0-9]{16}$/i.test(a)||!/^[a-f0-9]{16}$/i.test(b))return 64;
  let x = BigInt('0x'+a) ^ BigInt('0x'+b), count=0;
  while(x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}
function gpsWithTimeout() {
  if (!('geolocation' in navigator)) return Promise.resolve({coords:null,error:'Ten telefon nie udostępnia GPS.'});
  return new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({coords:{lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy},error:null}),
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
  const scored=dogs.filter(hasDiscoveryPoints);
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
  const source=shot.source==='gallery'?'gallery':'camera';
  if(verified && source==='camera'){const block=pointsStatus();if(block)throw new Error(block);}
  const manualPlace=$('place-name').value.trim().replace(/\s+/g,' ').slice(0,80);
  const note=$('dog-note').value.trim().replace(/\s+/g,' ').slice(0,120);
  let coords=null, placeName=manualPlace, locationError='';
  if(source==='camera' && $('save-location').checked){
    setAiStatus('Pobieram GPS i nazwę miejscowości. Może to potrwać kilka sekund…');
    const result=await gpsWithTimeout();coords=result.coords;locationError=result.error||'';
    if(coords&&!manualPlace)placeName=await resolvePlace(coords)||'';
  }
  const dog={id:crypto.randomUUID(),species,name,createdAt:Date.now(),photoBlob:shot.blob,
    hash:hashed,visual,verified,confidence,source,lat:coords?.lat??null,lng:coords?.lng??null,
    placeName,note,locationSource:manualPlace?'manual':coords?(placeName?'gps':'coordinates'):null};
  await inStore('readwrite',s=>s.add(dog));
  clearCaptured();$('camera-placeholder').hidden=false;$('camera-toggle').hidden=false;
  await reloadDogs();
  $('collection-notice').textContent=locationError
    ?`Zapisano ${animalGenitive(species)}, ale GPS nie działał: ${locationError} Możesz później użyć „Edytuj” i „Mapa”.`
    :coords&&!placeName?'Zwierzę zapisane z pinezką. Nie udało się pobrać nazwy miejscowości — możesz dopisać ją przyciskiem „Edytuj”.'
    :`Zapisano ${name}${placeName?` — ${placeName}`:''}. ${coords?'Pinezka jest na mapie.':''}${source==='gallery'?' Zdjęcie z galerii — 0 punktów.':''}`;
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
    const body=JSON.stringify({format:'lapki-go-backup',version:3,exportedAt:new Date().toISOString(),animals:result,missions:walkState});
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
    if(backup.format!=='lapki-go-backup'||![1,2,3].includes(backup.version))
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
        verified:d.verified===true,confidence:typeof d.confidence==='number'?d.confidence:0,source:d.source==='gallery'?'gallery':'camera',
        lat:typeof d.lat==='number'&&d.lat>=-90&&d.lat<=90?d.lat:null,
        lng:typeof d.lng==='number'&&d.lng>=-180&&d.lng<=180?d.lng:null,
        placeName:typeof d.placeName==='string'?d.placeName.trim().slice(0,80):'',
        note:typeof d.note==='string'?d.note.trim().slice(0,120):'',
        locationSource:typeof d.locationSource==='string'?d.locationSource.slice(0,20):null};
      await inStore('readwrite',s=>s.put(restored));existing.add(d.id);added++;
    }
    if(backup.version>=3 && backup.missions && typeof backup.missions==='object') {
      const incoming=backup.missions;
      if(Array.isArray(incoming.history)) {
        const existingKeys=new Set(walkState.history.map(h=>[h.day,h.minutes,h.finishedAt].join(':')));
        for(const h of incoming.history.slice(0,500)) {
          if(typeof h.day!=='string' || !Number.isFinite(h.finishedAt)||!WALK_REWARDS[h.minutes] || !Number.isFinite(h.earnedXp) || h.earnedXp<0 || h.earnedXp>60)continue;
          const key=[h.day,h.minutes,h.finishedAt].join(':');
          if(!existingKeys.has(key)){walkState.history.push({day:h.day,minutes:h.minutes,finishedAt:h.finishedAt,earnedXp:h.earnedXp,actualMinutes:Number.isFinite(h.actualMinutes)?h.actualMinutes:h.minutes,distanceMeters:clampMeters(h.distanceMeters),gpsMeasured:!!h.gpsMeasured});existingKeys.add(key);}
        }
        writeWalkState();
      }
    }
    await reloadDogs();
    $('backup-message').textContent=`Przywrócono ${added} zdjęć i dostępne dane misji. Istniejące wpisy zachowano.`;
  } catch(err) {$('backup-message').textContent='Nie przywrócono: '+err.message;}
  finally {event.target.value='';}
}
async function removeEverything() {
  if (!confirm('Usunąć WSZYSTKIE zdjęcia, punkty, misje i prywatne lokalizacje? Tego nie można cofnąć.'))return;
  if(!confirm('Potwierdź ostateczne usunięcie całej kolekcji.'))return;
  try {stopWalkGps();reports=[];localStorage.removeItem(REPORTS_STORAGE_KEY);renderLocalReports();await inStore('readwrite',s=>s.clear());walkState={active:null,history:[]};writeWalkState();await reloadDogs();navigate('home');alert('Kolekcja została usunięta z tej przeglądarki.');}
  catch(err){alert('Nie udało się usunąć danych: '+err.message);}
}

function renderLocalReports(){
  const count=$('local-report-count');if(count)count.textContent=`Lokalnie przygotowane zgłoszenia: ${reports.length}. Żadne nie zostało wysłane do moderatora.`;
}
async function submitLocalReport(){
  const id=$('report-animal-id').value.trim(), reason=$('report-reason').value;
  const details=$('report-details').value.trim().slice(0,500);
  if(!id || !dogs.some(d=>String(d.id)===id)){$('report-status').textContent='Najpierw wybierz zdjęcie z kolekcji przez przycisk Zgłoś.';return;}
  if(!reason){$('report-status').textContent='Wybierz powód zgłoszenia.';return;}
  const row={id:`rep-${Date.now()}-${Math.floor(Math.random()*1e6)}`,animalId:id,reason,details,createdAt:new Date().toISOString(),sent:false};
  reports.push(row);
  if(!saveReports()){reports.pop();$('report-status').textContent='Nie udało się zapisać zgłoszenia lokalnie.';return;}
  const dog=dogs.find(d=>String(d.id)===id);
  try{await inStore('readwrite',s=>s.put({...dog,flaggedLocal:true}));await reloadDogs();}
  catch(err){$('report-status').textContent=`Zgłoszenie zapisane, ale nie udało się ukryć zdjęcia: ${err.message}`;return;}
  $('report-status').textContent='Zapisano zgłoszenie i zasłonięto zdjęcie TYLKO na Twoim urządzeniu. NIE wysłano go do moderatora — nie mamy jeszcze serwera zgłoszeń.';
  $('report-details').value='';renderLocalReports();
}
function downloadLocalReports(){
  if(!reports.length){$('report-status').textContent='Nie ma zgłoszeń do eksportu.';return;}
  // No photo, GPS, user email or other personal data in the export.
  const data=JSON.stringify({format:'lapki-go-local-reports',version:1,reports},null,2);
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='lapki-go-zgloszenia-lokalne.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('report-status').textContent='Pobrano prywatny plik zgłoszeń bez fotografii i GPS. Nadal nie wysłano go do moderatora.';
}

function updateSpeciesUI() {
  const species=selectedSpecies();
  const animal=animalGenitive(species);
  $('dog-name-label').textContent=`Jak nazwiesz tego ${animal}?`;
  $('dog-name').placeholder=species==='cat'?'Np. Mruczek, Puszek, Łatka':'Np. Borys, Rudzielec, Łaciatek';
  $('dog-note-label').textContent=`Opis ${animal} (opcjonalnie)`;
  $('catch-lead').textContent=`Zrób zdjęcie ${animal} aparatem lub wybierz plik z galerii. AI sprawdza gatunek lokalnie, bez wysyłania zdjęcia na serwer.`;
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
  $('gallery-file').addEventListener('change',chooseGalleryPhoto);
  $('test-gps').addEventListener('click',testGps);
  $('submit-local-report').addEventListener('click',submitLocalReport);
  $('export-reports').addEventListener('click',downloadLocalReports);
  document.querySelectorAll('[data-walk-minutes]').forEach(b=>b.addEventListener('click',()=>startWalk(Number(b.dataset.walkMinutes))));
  $('finish-walk').addEventListener('click',finishWalk);
  $('cancel-walk').addEventListener('click',cancelWalk);
  $('share-progress').addEventListener('click',shareProgress);
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
  walkState=readWalkState();reports=readReports();renderLocalReports();
  renderMissions();if(walkState.active){gpsStatus='Wznowiono licznik po otwarciu aplikacji. Przebytej drogi podczas zamknięcia nie doliczono.';startWalkGps();}
  window.setInterval(()=>{if(document.visibilityState==='visible' && walkState.active)renderMissions();},1000);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){stopWalkGps();gpsStatus='GPS wstrzymany: aplikacja w tle. Trasa może być niepełna.';}
    else if(walkState.active){startWalkGps();}
    renderMissions();
  });
  updateSpeciesUI();
  if ('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  reloadDogs().catch(err=>{
    $('home-empty').textContent='Przeglądarka nie pozwoliła otworzyć pamięci lokalnej. Sprawdź tryb prywatny i ustawienia przechowywania danych.';
    console.error('IndexedDB',err);
  });
}
init();
