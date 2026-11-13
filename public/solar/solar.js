import {PlanetScene} from './src/scene.js';
import {worlds} from './src/science.js';

const copy={
  en:{back:'← Back to EARTIFY',brand:'EARTIFY · SOLAR SYSTEM',eyebrow:'INTERACTIVE JOURNEY',title:'Explore <em>our universe</em>',description:'Explore the planets from afar, zoom in, and follow their motion through the Solar System.',planets:'PLANETS & MOONS',controls:'SIMULATION CONTROLS',pause:'⏸ Pause / Play',orbitalSpeed:'Orbital speed',orbits:'Show / Hide orbits',rotationOn:'Stop planet rotation',rotationOff:'Resume planet rotation',hint:'Drag to rotate the view · Scroll to zoom · Select a planet to focus the camera.',day:'day',days:'days',sun:'Sun',mercury:'Mercury',venus:'Venus',earth:'Earth',mars:'Mars',jupiter:'Jupiter',saturn:'Saturn',uranus:'Uranus',neptune:'Neptune',moon:'Moon',askCero:'Ask Cero'},
  ar:{back:'العودة إلى EARTIFY ←',brand:'EARTIFY · المجموعة الشمسية',eyebrow:'رحلة تفاعلية',title:'اكتشف <em>عالمنا</em>',description:'استكشف الكواكب عن بُعد، اقترب منها، وتابع حركتها في النظام الشمسي.',planets:'الكواكب والأقمار',controls:'التحكم في المحاكاة',pause:'⏸ إيقاف / تشغيل',orbitalSpeed:'سرعة المدار',orbits:'إظهار / إخفاء المدارات',rotationOn:'إيقاف دوران الكواكب',rotationOff:'استئناف دوران الكواكب',hint:'اسحب بالماوس لتدوير المشهد · استخدم عجلة الماوس للتقريب · اختر كوكبًا لتركيز الكاميرا عليه.',day:'يوم',days:'أيام',sun:'الشمس',mercury:'عطارد',venus:'الزهرة',earth:'الأرض',mars:'المريخ',jupiter:'المشتري',saturn:'زحل',uranus:'أورانوس',neptune:'نبتون',moon:'القمر',askCero:'اسأل Cero'}
};
const planetNames={sun:'sun',mercury:'mercury',venus:'venus',earth:'earth',mars:'mars',jupiter:'jupiter',saturn:'saturn',uranus:'uranus',neptune:'neptune',moon:'moon'};
let language=(()=>{try{return localStorage.getItem('eartify-language')==='ar'?'ar':'en'}catch{return 'en'}})();
const t=key=>copy[language][key]||key;
const host=document.querySelector('#scene');
const requestedPlanet=new URLSearchParams(location.search).get('planet');
let selected=worlds.some(w=>w.id===requestedPlanet)?requestedPlanet:'earth',sim;
sim=new PlanetScene(host,id=>select(id));
const list=document.querySelector('#planet-list');
function renderPlanetList(){
 list.innerHTML=worlds.map(w=>`<button type="button" data-id="${w.id}" class="${w.id==='earth'?'active':''}">${t(planetNames[w.id]||w.id)}</button>`).join('');
}
function applyLanguage(lang){
 language=lang;document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 document.querySelectorAll('[data-i18n]').forEach(el=>{const key=el.dataset.i18n;el.innerHTML=t(key)});
 renderPlanetList();list.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.id===selected));
 sim.setLanguage?.(lang);
 document.querySelector('#speed-out').textContent=`${Number(document.querySelector('#speed').value).toFixed(2)}×`;
 document.querySelector('#rotation').textContent=sim.rotation?(lang==='ar'?t('rotationOn'):t('rotationOn')):t('rotationOff');
}
function select(id){selected=id;list.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.id===id));sim.focus(id)}
list.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)select(b.dataset.id)});
document.querySelector('#pause').addEventListener('click',()=>sim.setSimulationPaused(!sim.simulationPaused));
document.querySelector('#speed').addEventListener('input',e=>{sim.setSimulationSpeed(e.target.value);document.querySelector('#speed-out').textContent=Number(e.target.value).toFixed(2)+'×'});
document.querySelector('#orbits').addEventListener('click',()=>sim.setOrbits(!sim.orbits));
document.querySelector('#rotation').addEventListener('click',()=>{sim.setRotation(!sim.rotation);document.querySelector('#rotation').textContent=sim.rotation?t('rotationOn'):t('rotationOff')});
applyLanguage(language);
if(selected!=='earth') requestAnimationFrame(()=>select(selected));
window.addEventListener('storage',event=>{if(event.key==='eartify-language'&&(event.newValue==='ar'||event.newValue==='en'))applyLanguage(event.newValue)});
window.addEventListener('beforeunload',()=>sim.dispose?.());

// Cero remains available while exploring the Solar System.
const ceroLaunch=document.querySelector('#ceroHelpLaunch'),ceroPanel=document.querySelector('#ceroHelpPanel'),ceroForm=document.querySelector('#ceroHelpForm'),ceroMessages=document.querySelector('#ceroHelpMessages');
const addCeroMessage=(text,who)=>{const p=document.createElement('p');p.className=who;p.textContent=text;ceroMessages.appendChild(p);ceroMessages.scrollTop=ceroMessages.scrollHeight;return p};
ceroLaunch?.addEventListener('click',()=>{ceroPanel.hidden=!ceroPanel.hidden;ceroLaunch.setAttribute('aria-expanded',String(!ceroPanel.hidden));if(!ceroPanel.hidden)document.querySelector('#ceroHelpInput')?.focus()});
document.querySelector('#ceroHelpClose')?.addEventListener('click',()=>{ceroPanel.hidden=true;ceroLaunch?.setAttribute('aria-expanded','false')});
ceroForm?.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector('#ceroHelpInput'),message=input.value.trim();if(!message)return;addCeroMessage(message,'user');input.value='';const pending=addCeroMessage(language==='ar'?'Cero بيفكر…':'Cero is thinking…','bot');try{const response=await fetch('/api/robot-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,siteLanguage:language,sourcePage:'solar'})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Assistant unavailable');pending.textContent=data.reply;if(data.navigation?.route?.startsWith('/solar/')&&data.navigation.planet){setTimeout(()=>select(data.navigation.planet),350);}else if(data.navigation?.route&&!data.navigation.route.startsWith('/solar/'))setTimeout(()=>location.href=data.navigation.route,650);}catch(error){pending.textContent=error.message||'Please try again.';}});
