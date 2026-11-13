/**
 * EARTIFY — lightweight Node server.
 * NOTES FOR HANDOFF:
 * 1) The browser talks only to /api/* routes; secrets stay in this file/.env.
 * 2) Cero chat supports Gemini or OpenAI. Provider keys stay server-side in .env.
 * 3) Research links are primary-source starting points, not a substitute for
 *    checking the exact evidence behind a mission decision.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");
const dns = require("node:dns/promises");
const net = require("node:net");
const { extractUpload } = require("./document-extract");
const { retrieveHybridPassages } = require("./embedding-core");
const { detectLanguage, classifyIntent, classifyTeachingMode } = require("./assistant-core");
const { retrieveRelevantPassages, splitIntoChunks } = require("./research-core");
const embeddingCache = new Map();
const requestBuckets = new Map();

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = process.env.PORT || 3000;
const MIME = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".json":"application/json",
  ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".svg":"image/svg+xml", ".ico":"image/x-icon"
};

// Minimal .env loader so no package install is needed.
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  envFile.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
} catch (_) {}


// Small persistent starter database: capped at 20 accounts. Passwords are salted
// scrypt hashes; sessions and each user's documents/history are stored server-side.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (process.env.VERCEL ? "/tmp/eartify-data" : path.join(ROOT, "data"));
const DB_FILE = path.join(DATA_DIR, "eartify-db.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
function loadDB(){
  try {
    const value = JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
    return {users:[],sessions:{},documents:[],history:[],conversations:[],...value};
  } catch { return {users:[],sessions:{},documents:[],history:[],conversations:[]}; }
}
let db = loadDB();
function saveDB(){ const tmp=DB_FILE+".tmp"; fs.writeFileSync(tmp,JSON.stringify(db,null,2),{mode:0o600}); fs.renameSync(tmp,DB_FILE); }
function cookieToken(req){ const m=String(req.headers.cookie||"").match(/(?:^|;\s*)eartify_session=([a-f0-9]+)/); return m?.[1]||""; }
function currentUser(req){ const id=db.sessions[cookieToken(req)]; return db.users.find(u=>u.id===id)||null; }
function authCookie(res,token){ const secure=process.env.NODE_ENV === "production" ? "; Secure" : ""; res.setHeader("Set-Cookie",`eartify_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`); }
function publicUser(u){ return {id:u.id,email:u.email,name:u.name}; }
function extractTextFromUpload(input){ return extractUpload(input); }

const SOURCES = [
  { name:"NASA Earthdata Search", url:"https://search.earthdata.nasa.gov/", note:"Approved portal for Earth observation datasets and terrestrial analog research", tags:["earth","terrestrial","soil","temperature","climate","vegetation","rain","land","earthdata"] },
  { name:"NASA Worldview", url:"https://worldview.earthdata.nasa.gov/", note:"Approved visual portal for satellite imagery and environmental monitoring", tags:["earth","image","imagery","satellite","visual","weather","cloud","worldview"] },
  { name:"NASA Planetary Data System (PDS)", url:"https://pds.nasa.gov/", note:"Approved archive for Moon, Mars, and planetary mission datasets", tags:["moon","mars","planet","lunar","rover","atmosphere","plasma","geology","pds"] },
  { name:"LRO Diviner Lunar Data", url:"https://pds-geosciences.wustl.edu/", note:"Approved lunar surface temperature and polar-region data archive", tags:["moon","lunar","temperature","ice","polar","diviner"] },
  { name:"CSA RADARSAT Constellation Mission data", url:"https://donnees-data.asc-csa.gc.ca/", note:"Approved Canadian radar Earth-observation data portal", tags:["radar","sar","cloud","ice","wind","disaster","radarsat","earth"] },
  { name:"CSA RADARSAT-1 Archive", url:"https://donnees-data.asc-csa.gc.ca/", note:"Approved historical radar archive for environmental change analysis", tags:["radar","sar","history","historical","change","radarsat","earth"] },
  { name:"CSA SAR Python Tutorial", url:"https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial", note:"Approved processing tutorial; methodology only, not a dataset", tags:["radar","sar","python","qgis","processing","tutorial"] },
  { name:"Copernicus Data Space Ecosystem", url:"https://dataspace.copernicus.eu/", note:"Approved Earth observation data and processing portal", tags:["earth","atmosphere","gas","humidity","pressure","land","ocean","copernicus"] },
  { name:"ESA Open Science Catalog", url:"https://opensciencedata.esa.int/", note:"Approved catalog of open scientific datasets and workflows", tags:["science","catalog","experiment","geology","research","esa"] },
  { name:"JAXA G-Portal", url:"https://www.gportal.jaxa.jp/?lang=en", note:"Approved Earth-observation portal for rainfall, snow, and vegetation products", tags:["rain","rainfall","snow","vegetation","plant","dry","precipitation","jaxa"] }
];

function send(res, status, data, type="application/json; charset=utf-8") {
  res.writeHead(status, {"Content-Type":type, "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"same-origin"});
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 12 * 1024 * 1024) reject(new Error("Request too large (maximum 12 MB).")); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch(e) { reject(e); } });
    req.on("error", reject);
  });
}
function fallbackAnalysis(input) {
  const place = input.place || "the selected destination";
  const terrain = input.terrain || "unknown terrain";
  const hazards = input.hazards || "not specified";
  return {
    mode:"starter",
    title:`Mission concept for ${place}`,
    summary:`This is a preliminary concept based on the information entered for ${place}. Validate local measurements, landing constraints, and radiation/weather data before treating any recommendation as mission-ready.`,
    comparison:[
      {label:"Environment", value:`${terrain}; ${hazards}`},
      {label:"Power", value:"Compare sunlight hours, dust/shadow exposure, and storage needs."},
      {label:"Mobility", value:"Match wheel/leg design to slope, rocks, loose regolith, and travel distance."},
      {label:"Communications", value:"Check line-of-sight, relay coverage, and expected data delay."}
    ],
    risks:[
      {level:"High",name:"Unknowns in local conditions",detail:"The submitted location description is not a verified environmental dataset."},
      {level:"Medium",name:"Power and thermal management",detail:"Dust, darkness, extreme temperature swings, or limited sunlight can constrain operations."},
      {level:"Medium",name:"Mobility and mechanical wear",detail:"Loose soil, sharp rocks, slopes, and dust can reduce traction and damage moving parts."}
    ],
    solutions:[
      "Deploy a small scout first to map slopes, obstacles, illumination, and communication visibility.",
      "Use a modular, dust-tolerant rover with replaceable wheel/traction components and a protected electronics bay.",
      "Combine solar generation with rechargeable storage; size the system only after measuring the local light cycle.",
      "Use thermal insulation, heaters, and temperature monitoring selected for the actual destination range."
    ],
    robot:{
      name:"ORBIT Scout",
      purpose:"A modular reconnaissance rover for terrain mapping and environmental sampling.",
      design:"Six-wheel rocker-bogie chassis, stereo cameras, navigation sensors, a compact spectrometer, and a swappable science payload.",
      autonomy:"Obstacle detection, route planning within a human-approved safe zone, health monitoring, and store-and-forward communications.",
      limitation:"Concept only. Payload, mass, power, thermal design, and autonomy must be engineered and tested for the target."
    },
    researchQueries:[
      `${place} surface conditions NASA`,
      `${place} radiation environment NASA`,
      `${place} terrain and landing site data NASA`
    ],
    sources:SOURCES,
    disclaimer:"Starter analysis — no live AI research was performed. Add an AI provider key and verify all findings against primary mission data."
  };
}
async function aiAnalysis(input) {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalysis(input);
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = `You are a cautious planetary mission research assistant for a student prototype.
Analyze this user-supplied destination. Do not invent measurements or claim a source was checked if it was not.
Clearly distinguish known facts, assumptions, and unknowns. Use scientific data and source links exclusively from the approved EARTIFY allowlist. Never cite or rely on other domains or model memory for scientific measurements. If no approved dataset is available, state that no verified data was retrieved. Approved portals: ${JSON.stringify(SOURCES)}.
Return ONLY valid JSON with keys: title, summary, comparison (array of {label,value}), risks (array of {level,name,detail}), solutions (array of strings), robot ({name,purpose,design,autonomy,limitation}), researchQueries (array of search phrases), sources (array of {name,url,note}), disclaimer.
Destination: ${JSON.stringify(input)}
Use these research starting points where relevant: ${JSON.stringify(SOURCES)}
If no precise coordinates or dataset are supplied, say so and make recommendations conditional.`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,temperature:0.35,response_format:{type:"json_object"},messages:[
      {role:"system",content:"Return careful, evidence-aware mission analysis as JSON only."},
      {role:"user",content:prompt}
    ]}),signal:AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || "{}");
}


const APPROVED_HOSTS = new Set([
  "cmr.earthdata.nasa.gov", "search.earthdata.nasa.gov", "worldview.earthdata.nasa.gov",
  "pds.nasa.gov", "pds-geosciences.wustl.edu", "stac.dataspace.copernicus.eu",
  "dataspace.copernicus.eu", "donnees-data.asc-csa.gc.ca", "www.gportal.jaxa.jp",
  "opensciencedata.esa.int", "github.com"
]);
function approvedUrl(value) {
  try { const u=new URL(value); return u.protocol==="https:" && APPROVED_HOSTS.has(u.hostname); } catch { return false; }
}
async function approvedJson(url, options={}) {
  if(!approvedUrl(url)) throw new Error("Blocked non-approved scientific source.");
  const response=await fetch(url,{...options,headers:{Accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(22000)});
  if(!response.ok) throw new Error(`Approved source returned HTTP ${response.status}`);
  return response.json();
}
function normalizeRecord(source,title,description,url,metadata={}) {
  return {source,title:title||"Untitled dataset",description:description||"No abstract supplied by the source.",url:approvedUrl(url)?url:source.url,metadata};
}
async function searchNasaEarthdata(query) {
  const terms=normalizeSearchTerms(query);
  const url=`https://cmr.earthdata.nasa.gov/search/collections.json?${new URLSearchParams({keyword:terms.join(" "),page_size:"20",sort_key:"-revision_date"})}`;
  const data=await approvedJson(url);
  return (data.items||[]).map(x=>normalizeRecord("NASA Earthdata Search",x.title,x.summary||x.description,x.links?.find(l=>l.rel===" via")?.href||`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(query)}`,{conceptId:x.id,shortName:x.short_name,version:x.version_id,provider:x.data_center,revisionDate:x.revision_date,temporal:x.time_start&&x.time_end?{start:x.time_start,end:x.time_end}:null,spatial:x.boxes||x.polygons,links:(x.links||[]).filter(l=>approvedUrl(l.href)).map(l=>({rel:l.rel,href:l.href}))}));
}
async function searchCopernicus(query) {
  const base="https://stac.dataspace.copernicus.eu/v1";
  const terms=normalizeSearchTerms(query);
  const catalog=await approvedJson(`${base}/collections?q=${encodeURIComponent(terms.join(" "))}&limit=20`);
  const collections=(catalog.collections||[]).slice(0,5);
  const records=[];
  for(const c of collections){
    const search=await approvedJson(`${base}/collections/${encodeURIComponent(c.id)}/items?limit=8&sortby=-properties.datetime`).catch(()=>({features:[]}));
    for(const f of (search.features||[])) records.push(normalizeRecord("Copernicus Data Space Ecosystem",f.properties?.title||f.id,f.properties?.description||c.description||c.title,`${base}/collections/${encodeURIComponent(c.id)}/items/${encodeURIComponent(f.id)}`,{collection:c.id,datetime:f.properties?.datetime,platform:f.properties?.platform,instruments:f.properties?.instruments,gsd:f.properties?.gsd,cloudCover:f.properties?.["eo:cloud_cover"],bbox:f.bbox,geometry:f.geometry,assets:Object.fromEntries(Object.entries(f.assets||{}).filter(([,a])=>approvedUrl(a.href)).map(([k,a])=>[k,{href:a.href,type:a.type,title:a.title}]))}));
    if(!(search.features||[]).length) records.push(normalizeRecord("Copernicus Data Space Ecosystem",c.title,c.description,`${base}/collections/${encodeURIComponent(c.id)}`,{collection:c.id,keywords:c.keywords,license:c.license,extent:c.extent,summaries:c.summaries}));
  }
  return records;
}
function normalizeSearchTerms(query) {
  const q=String(query||'').trim();
  const aliases={
    'المريخ':'Mars','كوكب المريخ':'Mars','سطح المريخ':'Mars surface','تربة المريخ':'Mars soil','غلاف المريخ':'Mars atmosphere','طقس المريخ':'Mars weather',
    'القمر':'Moon','سطح القمر':'Moon surface','حرارة القمر':'lunar temperature','الأرض':'Earth','كوكب الأرض':'Earth',
    'الصحراء الكبرى':'Sahara Desert','الصحراء':'desert','القاهرة':'Cairo','مصر':'Egypt','الإسكندرية':'Alexandria','اسكندرية':'Alexandria','الجيزة':'Giza','الأهرامات':'Giza pyramids','سيناء':'Sinai','جنوب سيناء':'South Sinai','شمال سيناء':'North Sinai','البحر الأحمر':'Red Sea','الغردقة':'Hurghada','شرم الشيخ':'Sharm El Sheikh','دهب':'Dahab','واحة سيوة':'Siwa Oasis','سيوة':'Siwa Oasis','أسوان':'Aswan','الأقصر':'Luxor','الوادي الجديد':'New Valley',
    'القطب الجنوبي':'Antarctica','القارة القطبية الجنوبية':'Antarctica','جبل إيفرست':'Mount Everest','وادي رم':'Wadi Rum','البتراء':'Petra','جبل موسى':'Mount Sinai'
  };
  const direct=aliases[q.toLowerCase()];
  if(direct)return [q,direct];
  const transliterate=q.normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');
  const map={'ا':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ء':'','ؤ':'w','ئ':'y',' ':' '};
  const latin=[...transliterate].map(ch=>map[ch]??ch).join('').replace(/\s+/g,' ').trim();
  return [...new Set([q,latin].filter(Boolean))];
}
async function searchPds(query) {
  // Search by free-text keywords and the canonical target name. PDS may return
  // empty pages for some nodes; keep every returned product and its label metadata.
  const terms=normalizeSearchTerms(query);
  const requests=terms.slice(0,2).map(term=>{
    const url=`https://pds.nasa.gov/api/search/1/products?${new URLSearchParams({keywords:term,limit:'30'})}`;
    return approvedJson(url).catch(()=>null);
  });
  if(/mars|المريخ/i.test(query)) requests.push(approvedJson(`https://pds.nasa.gov/api/search/1/products?${new URLSearchParams({q:'target_name eq "Mars"',limit:'40'})}`).catch(()=>null));
  if(/moon|lunar|القمر/i.test(query)) requests.push(approvedJson(`https://pds.nasa.gov/api/search/1/products?${new URLSearchParams({q:'target_name eq "Moon"',limit:'30'})}`).catch(()=>null));
  const payloads=await Promise.all(requests);
  const docs=payloads.flatMap(data=>data?.data||data?.results||data?.response?.docs||data?.products||[]);
  const seen=new Set();
  return docs.filter(x=>{const id=x.lidvid||x.lid||x.identifier||x.id||x.title;if(!id||seen.has(id))return false;seen.add(id);return true;})
    .map(x=>normalizeRecord('NASA Planetary Data System (PDS)',x.title||x.name||x.product_name||x.lid||x.identifier,x.description||x.abstract||x.product_description||x.product_name||'PDS product record. Open the original agency record for its full product label and attached observational files.',x.url||x.href||`https://pds.nasa.gov/services/search/index.jsp?${new URLSearchParams({q:query})}`,x));
}

async function encyclopediaLookup(query) {
  const clean=String(query||"").trim(); if(!clean) throw new Error("Enter something to search for.");
  const terms=clean.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const ranked=SOURCES.map((source,index)=>({source,index,score:source.tags.reduce((n,tag)=>n+(terms.some(t=>tag.includes(t)||t.includes(tag))?1:0),0)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=ranked.filter(x=>x.score>0).map(x=>x.source);
  const earth=/earth|soil|terrestrial|climate|rain|vegetation|land|temperature|egypt|desert|antarctic|arctic|الأرض|تربة|مناخ|مطر|نبات|حرارة|مصر|صحراء|القاهرة|سيناء|البحر|مدينة|جبل|وادي|منطقة/i.test(clean);
  const planetary=/moon|lunar|mars|rover|planet|geology|diviner|القمر|المريخ|كوكب|سطح/i.test(clean);
  const jobs=[];
  if(earth){jobs.push(["NASA Earthdata Search",()=>searchNasaEarthdata(clean)]);jobs.push(["Copernicus Data Space Ecosystem",()=>searchCopernicus(clean)]);}
  if(planetary){jobs.push(["NASA Planetary Data System (PDS)",()=>searchPds(clean)]);}
  if(!earth&&!planetary){jobs.push(["NASA Earthdata Search",()=>searchNasaEarthdata(clean)]);jobs.push(["Copernicus Data Space Ecosystem",()=>searchCopernicus(clean)]);jobs.push(["NASA Planetary Data System (PDS)",()=>searchPds(clean)]);}
  const settled=await Promise.allSettled(jobs.map(([,fn])=>fn()));
  const records=[];const errors=[];
  settled.forEach((r,i)=>{if(r.status==="fulfilled")records.push(...r.value);else errors.push({source:jobs[i][0],error:r.reason?.message||"Source unavailable"});});
  const portals=(chosen.length?chosen:SOURCES).filter(s=>approvedUrl(s.url));
  return {query:clean,title:clean,found:records.length>0,records:records.slice(0,40),extract:records.length?`Retrieved ${records.length} live scientific record(s) directly from approved agency APIs. Each record includes source metadata and an official record link.`:"No matching live records were returned by the approved APIs. The official portals are provided for a manual search; no outside data or estimated measurements were substituted.",description:`Live approved-source search · ${records.length} record(s)`,thumbnail:"",url:records[0]?.url||portals[0]?.url||SOURCES[0].url,portals,source:"Live official agency APIs",errors,retrievedAt:new Date().toISOString()};
}

function looksLikeUnclearInput(message) {
  const text = String(message || '').trim();
  if (!text) return true;
  if (/^[^\p{L}\p{N}]+$/u.test(text)) return true;
  const letters = (text.match(/[a-z\u0600-\u06FF]/gi) || []).length;
  if (letters < 2) return true;
  // Keep short real words (hi, ok, no, yes) valid. Flag only obvious keyboard noise.
  if (/^(.)\1{3,}$/iu.test(text)) return true;
  if (/^[asdfghjklqwertyuiopzxcvbnm]{5,}$/i.test(text) && !/[aeiou]/i.test(text)) return true;
  return false;
}

function messageLanguage(message) {
  return detectLanguage(message);
}
function robotReply(message) {
  const q = String(message || '').toLowerCase();
  const ar = messageLanguage(message) === "ar";
  const raw = String(message || '').trim();
  const englishName = raw.match(/\b(?:my name is|i am|i'm)\s+([A-Za-z][A-Za-z'-]{1,24})\b/i);
  const arabicName = raw.match(/(?:اسمي|انا اسمي|أنا اسمي)\s+([\u0621-\u064A]{2,20})/);
  const introducedName = englishName?.[1] || arabicName?.[1];
  if (introducedName) return ar
    ? `تشرفت بيك يا ${introducedName}! 😊 نورت EARTIFY. أنا Cero، صاحبك في رحلة استكشاف الفضاء. تحب نبدأ بأي كوكب أو قمر؟`
    : `Nice to meet you, ${introducedName}! 😊 Welcome to EARTIFY. I’m Cero, your space buddy. Which planet or moon should we explore first?`;
  if (looksLikeUnclearInput(message)) return ar
    ? 'معلش يا مستكشف، مش قادر أفهم الرسالة دي. ممكن توضح قصدك أو تعيد كتابة السؤال؟ 🤖'
    : "Sorry, explorer — I’m not sure what you mean. Could you rephrase your message or clarify your question? 🤖";
  if (/^(hi|hello|hey|مرحبا|اهلا|أهلا|ازيك|السلام عليكم)[!.؟ ]*$/i.test(q)) return ar
    ? 'أهلًا بيك يا مستكشف! 🚀 أنا Cero. اسألني عن الكواكب والأقمار والفضاء والبعثات، وهحاول أجاوبك بدقة وأوضح مصدر المعلومة.'
    : "Hi, explorer! 🚀 I’m Cero. Ask me about planets, moons, space, or missions, and I’ll do my best to give you a clear, accurate answer with sources.";
  if (/^(how are you|how are u|what's up|whats up|ازيك|إزيك|عامل ايه|عامل إيه|اخبارك|أخبارك)[؟?! .]*$/i.test(q)) return ar
    ? 'الحمد لله، تمام! 😊 إنت أخبارك إيه؟ تحب نستكشف حاجة جديدة؟'
    : "I'm doing well, thanks! 😊 How are you? Want to explore something new?";
  if (/^(good morning|good evening|good afternoon|صباح الخير|مساء الخير)[؟?! .]*$/i.test(q)) return ar
    ? 'مساء النور! 🌟 عامل إيه؟'
    : 'Good day! 🌟 How’s it going?';
  if (/^(bye|goodbye|see you|سلام|مع السلامة)[؟?! .]*$/i.test(q)) return ar
    ? 'مع السلامة! 👋 أتمنى لك يوم جميل.'
    : 'See you! 👋 Have a great day.';
  if (/^(thanks|thank you|شكرا|شكرًا|تسلم)/i.test(q)) return ar
    ? 'العفو! 🌟 لو عندك سؤال تاني عن الفضاء أنا جاهز.'
    : "You’re welcome! 🌟 I’m here if you have another space question.";
  if (/mars|المريخ/.test(q)) return ar
    ? 'المريخ كوكب صخري بارد، وغلافه الجوي رقيق ويتكوّن معظمه من ثاني أكسيد الكربون. توجد على سطحه آثار جيولوجية تشير إلى وجود مياه سائلة قديمًا. دي معلومات عامة وليست قراءة مباشرة لبيانات لحظية.\nمصدر موثوق: NASA — https://pds.nasa.gov/'
    : 'Mars is a cold, rocky planet with a thin atmosphere made mostly of carbon dioxide. Its surface preserves geological evidence that liquid water existed there in the past. This is general background, not a live data reading.\nTrusted source: NASA — https://pds.nasa.gov/';
  if (/moon|القمر/.test(q)) return ar
    ? 'القمر لا يملك غلافًا جويًا كثيفًا مثل الأرض، لذلك تتغير حرارة سطحه بشدة بين النهار والليل، وتوجد مناطق قطبية مظللة باستمرار قد تحتوي على جليد مائي.\nمصدر موثوق: NASA — https://pds.nasa.gov/'
    : 'The Moon has no thick atmosphere like Earth’s, so its surface temperature changes dramatically between day and night. Permanently shadowed polar regions may contain water ice.\nTrusted source: NASA — https://pds.nasa.gov/';
  if (/saturn|زحل/.test(q)) return ar
    ? 'زحل عملاق غازي مشهور بحلقاته الواسعة، وله عائلة كبيرة من الأقمار، من بينها تيتان وإنسيلادوس.\nمصدر موثوق: NASA — https://pds.nasa.gov/'
    : 'Saturn is a gas giant famous for its broad rings. It has many moons, including Titan and Enceladus.\nTrusted source: NASA — https://pds.nasa.gov/';
  if (/earth|الأرض/.test(q)) return ar
    ? 'الأرض كوكب صخري يمتلك ماءً سائلًا على سطحه وغلافًا جويًا غنيًا بالنيتروجين والأكسجين. لو تقصد معلومة محددة—مثل الحرارة أو الغلاف الجوي أو المدار—حددها لي.\nمصدر موثوق: NASA — https://search.earthdata.nasa.gov/'
    : 'Earth is a rocky planet with liquid water on its surface and an atmosphere rich in nitrogen and oxygen. If you want a specific detail—such as temperature, atmosphere, or orbit—tell me which one.\nTrusted source: NASA — https://search.earthdata.nasa.gov/';
  return ar
    ? 'أنا متخصص في الفضاء والكواكب والبعثات العلمية. مش عايز أخمّن إجابة مش مرتبطة بسؤالك؛ ممكن توضح سؤالك أو تذكر اسم الكوكب/القمر/المهمة اللي تقصدها؟ وللبيانات الموثوقة نبدأ بمصادر NASA وبيانات المهمات.'
    : "I specialize in space, planets, and scientific missions. I don’t want to guess or give you an unrelated answer. Could you clarify your question or tell me which planet, moon, or mission you mean? For reliable data, we can start with NASA and mission datasets.";
}
async function searchContextForChat(message) {
  // Retrieve a concise encyclopedia record for named space destinations; this is
  // supporting context, not a claim that NASA datasets were queried.
  const q = String(message || '').trim();
  if (!/(mars|moon|luna|earth|venus|mercury|jupiter|saturn|uranus|neptune|pluto|europa|titan|enceladus|المريخ|القمر|الأرض|الزهرة|عطارد|المشتري|زحل|أورانوس|نبتون)/i.test(q)) return null;
  try { return await encyclopediaLookup(q); } catch (_) { return null; }
}

async function nasaImageSearch(q) {
  const query=String(q||"").trim();
  return [{title:"NASA Worldview — approved satellite imagery portal",description:"Open NASA Worldview to inspect official Earth-observation imagery. EARTIFY does not load imagery from outside the approved source list.",image:"",nasaUrl:"https://worldview.earthdata.nasa.gov/",query}];
}


async function multiSourceResearchSearch(query, perSource=4) {
  const result=await encyclopediaLookup(query);
  return {items:(result.records||[]).map(record=>({source:record.source,title:record.title,year:record.metadata?.year||record.metadata?.datetime||"",authors:record.metadata?.authors||[],url:record.url,abstract:record.description,metadata:record.metadata})),providers:{approvedPortals:true,externalProviders:false,liveRecords:true,errors:result.errors||[]}};
}

function appendUserConversation(userId, role, content) {
  if(!userId) return;
  db.conversations.push({id:crypto.randomUUID(),userId,role,content:String(content||"").slice(0,3000),createdAt:new Date().toISOString()});
  const own=db.conversations.filter(x=>x.userId===userId);
  if(own.length>80){const remove=new Set(own.slice(0,own.length-80).map(x=>x.id));db.conversations=db.conversations.filter(x=>!remove.has(x.id));}
}

function rateLimit(req, res, limit=90, windowMs=60_000) {
  const key = `${req.socket.remoteAddress || "unknown"}:${req.method}:${new URL(req.url, "http://localhost").pathname}`;
  const now = Date.now();
  const bucket = requestBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + windowMs; }
  bucket.count++; requestBuckets.set(key, bucket);
  if (bucket.count > limit) { send(res, 429, { error: "Too many requests. Please wait a minute and try again." }); return false; }
  if (requestBuckets.size > 5000) for (const [k,v] of requestBuckets) if (now > v.reset) requestBuckets.delete(k);
  return true;
}
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const p = address.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (family === 6) {
    const lower=address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(address.slice(7));
    return lower === "::1" || lower === "::" || /^f[cd]/i.test(lower) || /^fe[89ab]/i.test(lower);
  }
  return true;
}
async function assertPublicHttpUrl(value) {
  const target = new URL(String(value));
  if (!["http:","https:"].includes(target.protocol) || target.username || target.password) throw new Error("Enter a public HTTP or HTTPS link without embedded credentials.");
  if (target.hostname === "localhost" || target.hostname.endsWith(".localhost")) throw new Error("Private network links are not allowed.");
  const records = net.isIP(target.hostname) ? [{address:target.hostname}] : await dns.lookup(target.hostname,{all:true,verbatim:true});
  if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error("Private or local network links are not allowed.");
  return target;
}
async function fetchPublicText(value) {
  let target = await assertPublicHttpUrl(value);
  for (let redirects=0; redirects<=3; redirects++) {
    const response = await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(15000),headers:{"User-Agent":"EARTIFY-Research/1.0"}});
    if ([301,302,303,307,308].includes(response.status)) {
      if (redirects === 3) throw new Error("Too many redirects while fetching this source.");
      const location=response.headers.get("location"); if(!location) throw new Error("The source returned an invalid redirect.");
      target=await assertPublicHttpUrl(new URL(location,target).href); continue;
    }
    if(!response.ok) throw new Error(`Could not fetch link (${response.status}).`);
    const type=response.headers.get("content-type")||"";
    if(!/text\//i.test(type)&&!/json|xml/i.test(type)) throw new Error("That link does not point to readable text or a webpage.");
    const body=await response.text(); if(body.length>500000) throw new Error("Linked source is too large to import (maximum 500 KB).");
    return {target,body,type};
  }
}

const requestHandler = async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") return send(res,204,{});
  if (url.pathname.startsWith("/api/") && !rateLimit(req,res,url.pathname.includes("robot-chat")?35:90)) return;
  if (req.method === "POST" && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return send(res,403,{error:"Cross-origin requests are not allowed."}); }
    catch { return send(res,403,{error:"Invalid request origin."}); }
  }
  if (url.pathname === "/api/health") return send(res,200,{ok:true,aiEnabled:!!(process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY),aiProvider:process.env.GEMINI_API_KEY?"gemini":process.env.OPENAI_API_KEY?"openai":"guided",semanticSearchEnabled:!!process.env.OPENAI_API_KEY,documentFormats:["TXT","MD","CSV","JSON","XML","HTML","PDF","DOCX"],researchProviders:["NASA Earthdata","NASA Worldview","NASA PDS","CSA","ESA Copernicus","ESA Open Science","JAXA G-Portal"]});

  if (url.pathname === "/api/auth/signup" && req.method === "POST") {
    try { const x=await readBody(req), email=String(x.email||"").trim().toLowerCase(), name=String(x.name||"").trim().slice(0,60), password=String(x.password||"");
      if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||!name) return send(res,400,{error:"Enter a valid email, name, and password (8+ characters)."});
      if(db.users.length>=20) return send(res,403,{error:"The starter database is full (20 accounts)."});
      if(db.users.some(u=>u.email===email)) return send(res,409,{error:"An account with this email already exists."});
      const salt=crypto.randomBytes(16).toString("hex"), hash=crypto.scryptSync(password,salt,64).toString("hex"), user={id:crypto.randomUUID(),email,name,salt,hash,createdAt:new Date().toISOString()};
      db.users.push(user); const token=crypto.randomBytes(32).toString("hex"); db.sessions[token]=user.id; saveDB(); authCookie(res,token); return send(res,201,{user:publicUser(user)});
    } catch(e){return send(res,400,{error:e.message||"Could not create account."});}
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    try {const x=await readBody(req), email=String(x.email||"").trim().toLowerCase(), password=String(x.password||""), u=db.users.find(v=>v.email===email);
      const hash=u?crypto.scryptSync(password,u.salt,64).toString("hex"):"";
      if(!u||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(u.hash))) return send(res,401,{error:"Email or password is incorrect."});
      const token=crypto.randomBytes(32).toString("hex"); db.sessions[token]=u.id; saveDB(); authCookie(res,token); return send(res,200,{user:publicUser(u)});
    }catch(e){return send(res,400,{error:"Could not log in."});}
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") { delete db.sessions[cookieToken(req)]; saveDB(); res.setHeader("Set-Cookie","eartify_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); return send(res,200,{ok:true}); }
  if (url.pathname === "/api/auth/me") { const u=currentUser(req); return send(res,200,{user:u?publicUser(u):null,accountLimit:20,accountCount:db.users.length}); }
  if (url.pathname === "/api/history") { const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in to view your research history."}); return send(res,200,{items:db.history.filter(h=>h.userId===u.id).slice(-100).reverse().map(({userId,...item})=>item)}); }
  if (url.pathname === "/api/documents" && req.method === "GET") { const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in to view saved files."}); return send(res,200,{items:db.documents.filter(d=>d.userId===u.id).map(({content,userId,...d})=>d)}); }
  if (url.pathname === "/api/documents" && req.method === "POST") {
    try {const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in before saving files."}); const x=await readBody(req); let doc;
      if(x.url){const fetched=await fetchPublicText(x.url); const target=fetched.target; doc={name:target.hostname+target.pathname,content:fetched.body.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").slice(0,100000),source:target.href};
      } else doc={...extractTextFromUpload(x),source:"uploaded file"};
      if(!doc.content.trim())throw new Error("No readable text was found in this file or link."); const item={id:crypto.randomUUID(),userId:u.id,name:doc.name,source:doc.source||"uploaded file",content:doc.content,createdAt:new Date().toISOString()}; db.documents.push(item); saveDB(); return send(res,201,{document:{id:item.id,name:item.name,source:item.source,createdAt:item.createdAt,characters:item.content.length,extraction:"text"}});
    }catch(e){return send(res,400,{error:e.message||"Could not save this document."});}
  }
  if (url.pathname.startsWith("/api/documents/") && req.method === "DELETE") {const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in first."}); const id=url.pathname.split("/").pop(); db.documents=db.documents.filter(d=>!(d.id===id&&d.userId===u.id)); saveDB(); return send(res,200,{ok:true});}
  if (url.pathname === "/api/documents/ask" && req.method === "POST") {
    try {const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in to ask questions about saved files."}); const x=await readBody(req), question=String(x.question||"").trim(); if(!question)return send(res,400,{error:"Write a question first."});
      const docs=db.documents.filter(d=>d.userId===u.id), selected=x.documentId?docs.filter(d=>d.id===x.documentId):docs; if(!selected.length)return send(res,404,{error:"No saved document was found."});
      const retrieval=await retrieveHybridPassages(question,selected,{apiKey:process.env.OPENAI_API_KEY||"",model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",limit:10,cache:embeddingCache});
      let passages=retrieval.passages;
      if(!passages.length && /summari[sz]|لخص|ملخص/i.test(question)) passages=selected.flatMap(d=>splitIntoChunks(d.content).slice(0,2).map((chunk,index)=>({name:d.name,chunk,index,score:0})));
      const context=passages.map((p,i)=>`[${i+1}] FILE: ${p.name}\n${p.chunk}`).join("\n\n").slice(0,26000); let answer;
      if(process.env.OPENAI_API_KEY){const resp=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",messages:[{role:"system",content:"You are a careful document research assistant. Answer only from the retrieved passages. If they do not contain the answer, explicitly say the saved sources do not establish it. Cite the exact filename and passage number such as [filename, passage 2]. Never invent facts. Explain clearly and structurally."},{role:"user",content:`Question: ${question}\n\nRetrieved passages:\n${context||"No relevant passages were retrieved."}`}],temperature:.2}),signal:AbortSignal.timeout(60000)}); if(!resp.ok)throw new Error("AI document analysis is unavailable. Check the server API key."); const data=await resp.json(); answer=data.choices?.[0]?.message?.content||"No answer returned.";
      } else if(/summari[sz]|لخص|ملخص/i.test(question)){answer=selected.map(d=>`**${d.name}**\n${d.content.slice(0,1800)}${d.content.length>1800?"…":""}`).join("\n\n"); answer="Starter summary (AI key not configured):\n"+answer;}
      else {answer=passages.length?"Relevant passages (basic retrieval; AI key not configured):\n"+passages.map((p,i)=>`[${p.name}, passage ${i+1}]\n${p.chunk.slice(0,700)}`).join("\n\n"):"I couldn't retrieve a relevant passage from the saved sources. Configure OPENAI_API_KEY for natural-language synthesis.";}
      return send(res,200,{answer,mode:process.env.OPENAI_API_KEY?"ai":"basic",retrieval:retrieval.mode,citations:passages.map((p,i)=>({document:p.name,passage:i+1,score:Number(p.score||0).toFixed(3)}))});
    }catch(e){return send(res,502,{error:e.message||"Document question failed."});}
  }

  if (url.pathname === "/api/solve" && req.method === "POST") {
    try {
      const input = await readBody(req);
      if (!input.place) return send(res,400,{error:"Please enter a destination name."});
      const result = await aiAnalysis(input);
      return send(res,200,result);
    } catch(e) { return send(res,502,{error:e.message || "Analysis failed"}); }
  }
  if (url.pathname === "/api/place-search" && req.method === "POST") {
    try {
      const input = await readBody(req);
      if (!String(input.place || "").trim()) return send(res,400,{error:"Enter a place or thing to search for."});
      const first = await encyclopediaLookup(input.place);
      const second = String(input.place2 || "").trim() ? await encyclopediaLookup(input.place2) : null;
      const who=currentUser(req); if(who){db.history.push({id:crypto.randomUUID(),userId:who.id,query:[input.place,input.place2].filter(Boolean).join(" vs "),createdAt:new Date().toISOString()});saveDB();}
      return send(res,200,{first,second,source:"Live official agency APIs",disclaimer:first.records?.length?`Retrieved ${first.records.length} live record(s) from approved agency sources. Full metadata and source links are shown below.`:"No matching records were returned by the approved live APIs. No third-party data was used."});
    } catch(e) { return send(res,502,{error:e.message||"Research lookup failed"}); }
  }
  if (url.pathname === "/api/compare-text" && req.method === "POST") {
    try {
      const input = await readBody(req);
      if (!String(input.first || "").trim() || !String(input.second || "").trim()) return send(res,400,{error:"Enter both items to compare."});
      const [first, second] = await Promise.all([encyclopediaLookup(input.first), encyclopediaLookup(input.second)]);
      const who=currentUser(req); if(who){db.history.push({id:crypto.randomUUID(),userId:who.id,query:`${input.first} vs ${input.second}`,createdAt:new Date().toISOString()});saveDB();}
      return send(res,200,{first,second,source:"EARTIFY approved source registry",disclaimer:(first.offline || second.offline) ? "Internet connection is unavailable; built-in NASA topic references are shown for recognized Solar System objects." : "A comparison of approved scientific source portals; open each official portal to inspect its native datasets."});
    } catch(e) { return send(res,502,{error:e.message||"Comparison search failed"}); }
  }
  if (url.pathname === "/api/robot-chat" && req.method === "POST") {
    try {
      const input=await readBody(req); const message=String(input.message||"").trim().slice(0,1200);
      if(!message) return send(res,400,{error:"Type a message first."});
      const signedIn=currentUser(req);
      if(looksLikeUnclearInput(message)) return send(res,200,{reply:robotReply(message),mode:"clarify"});
      const aiProvider=process.env.GEMINI_API_KEY?"gemini":process.env.OPENAI_API_KEY?"openai":"guided";
      if(aiProvider==="guided") {
        const reply=robotReply(message);
        if(signedIn){appendUserConversation(signedIn.id,"user",message);appendUserConversation(signedIn.id,"assistant",reply);saveDB();}
        return send(res,200,{reply,mode:"guided",notice:"For open-ended conversational answers, configure GEMINI_API_KEY or OPENAI_API_KEY on the server."});
      }
      const evidence=await searchContextForChat(message);
      const clientHistory=Array.isArray(input.history) ? input.history.slice(-8).map(item=>({role:item.role==="assistant"?"assistant":"user",content:String(item.content||"").slice(0,1200)})) : [];
      const savedHistory=signedIn?db.conversations.filter(x=>x.userId===signedIn.id).slice(-10).map(x=>({role:x.role,content:x.content})):[];
      const history=(savedHistory.length?savedHistory:clientHistory).slice(-12);
      const userDocs=signedIn?db.documents.filter(d=>d.userId===signedIn.id):[];
      const docRetrieval=await retrieveHybridPassages(message,userDocs,{apiKey:process.env.OPENAI_API_KEY||"",model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",limit:4,cache:embeddingCache});
      const docPassages=docRetrieval.passages;
      const docContext=docPassages.map((p,i)=>`[${p.name}, passage ${i+1}] ${p.chunk}`).join("\n\n");
      const rawMessage=String(message||"");
      const hasArabicScript=/[\u0600-\u06FF]/.test(rawMessage);
      const looksArabizi=/\b(3ayz|3aiz|3rf|a3rf|eh|bt3ml|el|msh|mesh|ezay|leh|3shan|keda|b2a)\b/i.test(rawMessage);
      const replyLanguage=hasArabicScript ? "Egyptian Arabic" : looksArabizi ? "Egyptian Arabic (Arabizi-aware; answer in Arabic script unless the user consistently writes Franco)" : "English";
      const detectedIntent=classifyIntent(rawMessage);
      let researchResults={items:[],providers:{}};
      if(detectedIntent==="scientific_research" || /\b(nasa|scientific paper|research paper|earthdata|pds|copernicus|radarsat|jaxa)\b/i.test(rawMessage)) {
        try { researchResults=await multiSourceResearchSearch(rawMessage,3); } catch (_) { researchResults={items:[],providers:{}}; }
      }
      const teachingMode=classifyTeachingMode(rawMessage);
      const teachingRequested=detectedIntent==="explanation" || /(step.?by.?step|i don.t understand|why does|how does|واحدة واحدة|خطوة بخطوة)/i.test(rawMessage);
      const systemPrompt=`Detected intent hint: ${detectedIntent}. Teaching depth hint: ${teachingMode}. These are fallible hints; follow the actual message and conversation, not the labels. You are Cero, EARTIFY's conversational AI, patient teacher, and careful research assistant. Reply in ${replyLanguage}; match the user's register naturally. Understand typos, informal wording, dialect, Arabizi, code-switching, short follow-ups, pronouns, and references using the conversation history. Do not assume two similar spellings always mean the same thing; use context and ask one concise clarification when intent remains genuinely ambiguous.

GENERAL CONVERSATION: Help with broad everyday, educational, technical, creative, and scientific questions, not only space. Be natural, relevant, non-repetitive, and answer the actual request. Keep simple requests concise; do not pad.

TEACHING: When the user wants to learn, ${teachingRequested ? "use a thorough step-by-step teaching approach for this turn." : "adapt the depth to their wording and demonstrated level."} Start from the prerequisite idea when needed; teach one concept at a time; explain what it means and WHY it works; define technical terms; show every meaningful algebra/calculation step; give a worked example and explain common mistakes. For math/physics identify givens, required quantity, formula and why it applies, substitution, calculation, units, and a reasonableness check. Do not skip transformations. If the learner says they are confused, change the explanation and example instead of repeating the same wording. For practice, ask one question at a time and wait for the answer; do not reveal the answer when they asked to try independently. Check understanding naturally without turning every answer into a quiz. Avoid an overwhelming wall of text: use clear stages and pause at a sensible point.

RESEARCH: For current or specialized scientific claims, retrieve evidence when tools are available. When approved NASA, CSA, ESA, or JAXA portal records are supplied, cite exact record titles, source names, and URLs in your answer; describe them as search results, not as proof that the full paper was independently verified. Prefer NASA, NASA NTRS, NASA PDS, ESA, and peer-reviewed sources. Clearly distinguish retrieved evidence, general background knowledge, hypotheses, estimates, and unknowns. Never invent a paper, DOI, citation, measurement, search, or URL. Only say a source was searched if it was actually retrieved. Scientific data and source links must come exclusively from this allowlist: NASA Earthdata Search (https://search.earthdata.nasa.gov/), NASA Worldview (https://worldview.earthdata.nasa.gov/), NASA PDS (https://pds.nasa.gov/), LRO Diviner archive (https://pds-geosciences.wustl.edu/), CSA data portal (https://donnees-data.asc-csa.gc.ca/), CSA SAR tutorial (https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial), Copernicus Data Space (https://dataspace.copernicus.eu/), ESA Open Science Catalog (https://opensciencedata.esa.int/), and JAXA G-Portal (https://www.gportal.jaxa.jp/?lang=en). Never cite, link, retrieve, or use scientific data from any other domain. If an approved portal does not return data, state that no verified data was retrieved; do not fill gaps from other sources or model memory. If the supplied context is insufficient, say exactly what is missing and suggest a primary source. Do not treat an encyclopedia summary as primary mission data.

CONTEXT & PRIVACY: Use only the conversation history provided for this user. Resolve follow-up references from it. Never claim persistent memory across accounts or sessions. Do not reveal secrets or credentials. If asked to perform an action, use an available tool or clearly state what cannot be done.

STYLE: Be patient, encouraging, accurate, and specific. Never shame mistakes. Do not force every response into a space topic. Avoid generic filler and repetitive greetings. If uncertain, be transparent rather than pretending.`;
      const context=[
        evidence?.found ? `Retrieved approved-source portal references (not raw measurements): ${JSON.stringify({title:evidence.title,extract:evidence.extract,url:evidence.url})}` : "No approved portal references were retrieved.",
        researchResults.items.length ? `Scientific records retrieved live from approved agency portals: ${JSON.stringify(researchResults.items)}` : "No live scientific records were retrieved for this turn.",
        docContext ? `Relevant passages from this signed-in user's saved documents:\n${docContext}` : "No relevant passages were retrieved from the user's saved documents."
      ].join("\n\n");
      let reply="";
      if(aiProvider==="gemini") {
        const model=process.env.GEMINI_MODEL||"gemini-3.8-flash";
        const contents=[...history.map(item=>({role:item.role==="assistant"?"model":"user",parts:[{text:item.content}]})),{role:"user",parts:[{text:`${context}\n\nUser message: ${message}`}]}];
        const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"x-goog-api-key":process.env.GEMINI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:systemPrompt}]},contents,generationConfig:{temperature:.25,maxOutputTokens:1800}}),signal:AbortSignal.timeout(60000)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) { const detail=data.error?.message||`Gemini API returned ${response.status}`; throw new Error(`Gemini: ${detail}`); }
        reply=(data.candidates?.[0]?.content?.parts||[]).map(part=>part.text||"").join("\n").trim();
      } else {
        const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",messages:[{role:"system",content:systemPrompt},{role:"system",content:context},...history,{role:"user",content:message}],temperature:.25}),signal:AbortSignal.timeout(60000)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error?.message||`OpenAI API returned ${response.status}`);
        reply=data.choices?.[0]?.message?.content||"";
      }
      if(!reply) reply=messageLanguage(message)==="ar" ? "معلش، النموذج مرجعش إجابة واضحة. جرّب تسألني تاني." : "Sorry, the model did not return a usable answer. Please try again.";
      if(signedIn){appendUserConversation(signedIn.id,"user",message);appendUserConversation(signedIn.id,"assistant",reply);saveDB();}
      return send(res,200,{reply,mode:"ai",provider:aiProvider,reference:evidence?.found?{name:evidence.title,url:evidence.url}:null,research:researchResults.items,researchProviders:researchResults.providers});
    } catch(e){return send(res,502,{error:e.message||"Chat failed"});}
  }
  if (url.pathname === "/api/research/search" && req.method === "GET") {
    const query=String(url.searchParams.get("q")||"").trim();
    if(query.length<3) return send(res,400,{error:"Enter at least 3 characters to search approved scientific data portals."});
    const result=await encyclopediaLookup(query);
    return send(res,200,{query,items:result.records||[],providers:{approvedPortals:true,externalProviders:false,liveRecords:true,errors:result.errors||[]},retrievedAt:result.retrievedAt,notice:result.extract});
  }
  if (url.pathname === "/api/research/ntrs" && req.method === "GET") {
    const query=String(url.searchParams.get("q")||"").trim();
    if(query.length<3) return send(res,400,{error:"Enter at least 3 characters to search approved planetary data portals."});
    const result=await encyclopediaLookup(query);
    return send(res,200,{query,items:result.records||[],source:"Live official agency APIs",errors:result.errors||[],retrievedAt:result.retrievedAt,notice:result.extract});
  }
  if (url.pathname === "/api/nasa-images") {
    try {
      const q = url.searchParams.get("q") || "Mars rover";
      return send(res,200,{items:await nasaImageSearch(q)});
    } catch(e) { return send(res,502,{error:e.message}); }
  }
  let pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  // Serve directory routes (e.g. /solar/ or /solar) with their index.html.
  if (pathname.endsWith("/")) pathname += "index.html";
  else if (!path.extname(pathname)) pathname += "/index.html";
  const target = path.normalize(path.join(PUBLIC, pathname));
  if (!target.startsWith(PUBLIC)) return send(res,403,{error:"Forbidden"});
  fs.readFile(target,(err,buffer)=>{
    if (err) return send(res,404,"Not found","text/plain; charset=utf-8");
    send(res,200,buffer,MIME[path.extname(target)] || "application/octet-stream");
  });
};

// Vercel imports this handler as a serverless function. Local development
// still uses the same handler through a regular Node HTTP server.
if (require.main === module) {
  http.createServer(requestHandler).listen(PORT, "0.0.0.0", ()=>console.log(`EARTIFY running on port ${PORT}`));
}
module.exports = requestHandler;
