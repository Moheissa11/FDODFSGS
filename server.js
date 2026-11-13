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
const { WEBSITE_KNOWLEDGE, getWebsiteHelpReply, getWebsiteNavigationIntent } = require("./website-knowledge");
const { APPROVED_SOURCES, isApprovedSourceUrl } = require("./source-registry");
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

const SOURCES = APPROVED_SOURCES.map(({name,url,category,status}) => ({name,url,note:`${category} · ${status}`}));

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
Clearly distinguish known facts, assumptions, and unknowns. Do not invent measurements. Use only the approved EARTIFY source registry; if no live record was retrieved, label the analysis conceptual and state that evidence is missing.
Return ONLY valid JSON with keys: title, summary, comparison (array of {label,value}), risks (array of {level,name,detail}), solutions (array of strings), robot ({name,purpose,design,autonomy,limitation}), researchQueries (array of search phrases), sources (array of {name,url,note}), disclaimer.
Destination: ${JSON.stringify(input)}
Use only these approved source starting points where relevant: ${JSON.stringify(SOURCES)}
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
  const websiteHelp = getWebsiteHelpReply(message);
  if (websiteHelp) return websiteHelp;
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
  if (/mars|المريخ|moon|القمر|earth|الأرض|saturn|زحل/.test(q)) return ar
    ? 'علشان نلتزم بمصادرك المعتمدة، مش هعرض معلومة علمية من الذاكرة. شغّل البحث في TerraTwin أو Research Desk، وهجيب لك سجلات NASA PDS وNASA Earthdata المتاحة فقط، مع روابطها الأصلية.'
    : 'To honor the approved-source-only policy, I will not provide scientific facts from memory. Run a search in TerraTwin or Research Desk and I will show only available NASA PDS and NASA Earthdata archive records with their original links.';
  return ar
    ? 'أنا متخصص في الفضاء والكواكب والبعثات العلمية. مش عايز أخمّن إجابة مش مرتبطة بسؤالك؛ ممكن توضح سؤالك أو تذكر اسم الكوكب/القمر/المهمة اللي تقصدها؟ وللبيانات الموثوقة نبدأ بمصادر NASA وبيانات المهمات.'
    : "I specialize in space, planets, and scientific missions. I don’t want to guess or give you an unrelated answer. Could you clarify your question or tell me which planet, moon, or mission you mean? For reliable data, we can start with NASA and mission datasets.";
}
async function searchContextForChat(_message) {
  // No encyclopedia or unapproved fallback source is queried.
  return null;
}


async function searchApprovedArchives(query, limit=8) {
  const clean=String(query||'').trim().slice(0,220);
  if(clean.length<2) return {items:[],providers:{pds:false,earthdata:false}};
  const jobs=await Promise.allSettled([
    (async()=>{
      const endpoint=new URL('https://pds.nasa.gov/api/search/1/products');
      endpoint.searchParams.set('keywords',clean); endpoint.searchParams.set('limit',String(Math.min(15,limit)));
      const response=await fetch(endpoint,{headers:{Accept:'application/json','User-Agent':'EARTIFY-TerraTwin/1.2'},signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw new Error(`NASA PDS returned ${response.status}`);
      const payload=await response.json(); const rows=Array.isArray(payload)?payload:(payload.data||payload.results||payload.items||[]);
      return rows.map(row=>{const p=row.properties||row;const get=(...keys)=>{for(const key of keys){const value=p[key]??row[key];if(value!=null)return Array.isArray(value)?value[0]:value;}return '';};const lid=get('lid','logical_identifier');const url=lid?`https://pds.nasa.gov/api/search/1/products/${encodeURIComponent(lid)}`:'https://pds.nasa.gov/';return {title:get('title')||lid||'PDS product',description:get('description')||'',extract:get('description')||'NASA PDS archive record; open the original record to inspect product details.',date:get('start_date_time'),id:lid,url,source:'NASA PDS',kind:'planetary-product'};}).filter(item=>isApprovedSourceUrl(item.url)).slice(0,limit);
    })(),
    (async()=>{
      const endpoint=new URL('https://cmr.earthdata.nasa.gov/search/collections.json');
      endpoint.searchParams.set('keyword',clean); endpoint.searchParams.set('page_size',String(Math.min(30,limit))); endpoint.searchParams.set('page_num','1');
      const response=await fetch(endpoint,{headers:{Accept:'application/json','Client-Id':'EARTIFY-Approved-Source-Search'},signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw new Error(`NASA Earthdata CMR returned ${response.status}`);
      const payload=await response.json();
      return (payload.feed?.entry||[]).map(row=>({title:row.title||row.short_name||'Earth observation collection',description:row.summary||'',extract:row.summary||'NASA Earthdata collection metadata; measurements require opening the dataset and checking its variables and access services.',date:row.time_start||'',id:row.id,shortName:row.short_name,url:`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(row.short_name||row.title||clean)}`,source:'NASA Earthdata CMR',kind:'earth-collection'})).filter(item=>isApprovedSourceUrl(item.url)).slice(0,limit);
    })()
  ]);
  const items=jobs.flatMap(job=>job.status==='fulfilled'?job.value:[]);
  return {items,providers:{pds:jobs[0].status==='fulfilled',earthdata:jobs[1].status==='fulfilled'},errors:jobs.map((job,index)=>job.status==='rejected'?{source:index===0?'NASA PDS':'NASA Earthdata',message:job.reason?.message||'Unavailable'}:null).filter(Boolean),retrievedAt:new Date().toISOString()};
}
async function multiSourceResearchSearch(query, perSource=4) {
  const result=await searchApprovedArchives(query,perSource);
  return result;
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
  if (url.pathname === "/api/sources" && req.method === "GET") {
    return send(res,200,{policy:"strict-allowlist",sources:APPROVED_SOURCES.map(({id,name,category,url,status})=>({id,name,category,url,status})),currentlyIntegrated:["nasa-earthdata-search","nasa-worldview","nasa-pds"],notice:"Only currently integrated approved sources are queried. Registered sources are not treated as connected until their official interfaces are implemented and tested."});
  }
  if (url.pathname === "/api/health") return send(res,200,{ok:true,aiEnabled:!!(process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY),aiProvider:process.env.GEMINI_API_KEY?"gemini":process.env.OPENAI_API_KEY?"openai":"guided",semanticSearchEnabled:!!process.env.OPENAI_API_KEY,documentFormats:["TXT","MD","CSV","JSON","XML","HTML","PDF","DOCX"],researchProviders:["NASA PDS","NASA Earthdata CMR"],sourcePolicy:"strict-allowlist",approvedSourceCount:APPROVED_SOURCES.length});


  // TerraTwin discovery: NASA PDS planetary records + Earthdata Earth analog collections.
  // Discovery returns metadata only. Numeric comparisons require compatible measurements.
  if (url.pathname === "/api/terratwin/collect" && req.method === "GET") {
    const world=String(url.searchParams.get("world")||"Both").trim().slice(0,30);
    const target=String(url.searchParams.get("target")||"").trim().slice(0,120);
    if (!["Mars","Moon","Both"].includes(world)) return send(res,400,{error:"Choose Mars, Moon, or Both."});
    if (target.length<2) return send(res,400,{error:"Enter a target region or site name."});
    const key=`${world}:${target.toLowerCase()}`;
    globalThis.__terraTwinCache ||= new Map();
    const prior=globalThis.__terraTwinCache.get(key);
    if(prior && Date.now()-prior.at<30*60*1000) return send(res,200,{...prior.data,cached:true});
    const worlds=world==="Both"?["Mars","Moon"]:[world];
    const planetaryTasks=worlds.map(async planet=>{
      const q=new URL("https://pds.nasa.gov/api/search/1/products");
      q.searchParams.set("keywords",`${target} ${planet}`); q.searchParams.set("limit","15");
      const r=await fetch(q,{headers:{Accept:"application/json","User-Agent":"EARTIFY-TerraTwin/1.1"},signal:AbortSignal.timeout(25000)});
      if(!r.ok) throw new Error(`PDS ${planet} returned HTTP ${r.status}`);
      const d=await r.json(), raw=Array.isArray(d)?d:(d.data||d.results||d.items||[]);
      return raw.map(x=>{const p=x.properties||x;const get=(...ks)=>{for(const k of ks){const v=p[k]??x[k];if(v!=null)return Array.isArray(v)?v[0]:v;}return "";};
        const lid=get("lid","logical_identifier");
        return {name:get("title")||lid||"PDS product",description:get("description")||"",target:planet,mission:get("investigation_name","mission_name"),instrument:get("instrument_name","instrument"),dataType:get("product_class"),date:get("start_date_time"),id:lid,url:lid?`https://pds.nasa.gov/api/search/1/products/${encodeURIComponent(lid)}`:"https://pds.nasa.gov/",kind:"metadata",source:"NASA PDS"};
      });
    });
    const tasks=await Promise.allSettled([
      ...planetaryTasks,
      (async()=>{
        const q=new URL("https://cmr.earthdata.nasa.gov/search/collections.json");
        q.searchParams.set("keyword",`${target} land surface temperature elevation geology soil moisture`);
        q.searchParams.set("page_size","30"); q.searchParams.set("page_num","1");
        const r=await fetch(q,{headers:{Accept:"application/json","Client-Id":"EARTIFY-TerraTwin"},signal:AbortSignal.timeout(20000)});
        if(!r.ok) throw new Error(`Earthdata CMR returned HTTP ${r.status}`);
        const d=await r.json();
        return (d.feed?.entry||[]).map(x=>({name:x.title||x.short_name||"Earth observation collection",description:x.summary||"",target:"Earth",mission:(x.platform||[]).map(y=>y.short_name).join(", "),instrument:(x.instrument||[]).map(y=>y.short_name).join(", "),dataType:(x.data_format||[]).join(", "),date:x.time_start||"",id:x.id,shortName:x.short_name,url:`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(x.short_name||x.title||"")}`,kind:"collection",source:"NASA Earthdata CMR"}));
      })()
    ]);
    const planetary=tasks.slice(0,worlds.length).flatMap(t=>t.status==="fulfilled"?t.value:[]);
    const earth=tasks[worlds.length].status==="fulfilled"?tasks[worlds.length].value:[];
    const errors=[];
    tasks.slice(0,worlds.length).forEach((t,i)=>{if(t.status==="rejected")errors.push({source:`NASA PDS (${worlds[i]})`,message:t.reason?.message||"Unavailable"});});
    if(tasks[worlds.length].status==="rejected")errors.push({source:"NASA Earthdata",message:tasks[worlds.length].reason?.message||"Unavailable"});
    const data={world,target,planetary,earth,errors,retrievedAt:new Date().toISOString(),
      analysis:{status:"metadata_only",message:"NASA archive metadata was discovered. Harmony can subset only supported Earth-observation collections. Planetary PDS products require product-specific access and compatible calibrated measurements before numeric Earth-vs-Mars/Moon comparisons are valid."},
      provenance:"Live NASA PDS and Earthdata CMR archive metadata; each record links to its original archive."};
    globalThis.__terraTwinCache.set(key,{at:Date.now(),data});
    if(globalThis.__terraTwinCache.size>100)globalThis.__terraTwinCache.delete(globalThis.__terraTwinCache.keys().next().value);
    if(!planetary.length&&!earth.length)return send(res,502,{error:"NASA archives could not return records for this search.",details:errors});
    return send(res,200,data);
  }

  // Read collection-specific Harmony capabilities before offering any subsetting controls.
  if (url.pathname === "/api/terratwin/capabilities" && req.method === "GET") {
    const collectionId=String(url.searchParams.get("collectionId")||"").trim();
    if(!/^(C\d{6,}-[A-Z0-9_-]+|[A-Z0-9][A-Z0-9_.-]{1,79})$/i.test(collectionId)) return send(res,400,{error:"Invalid NASA CMR collection ID or short name."});
    try {
      const endpoint=new URL("https://harmony.earthdata.nasa.gov/capabilities");
      endpoint.searchParams.set("collectionId",collectionId);
      const response=await fetch(endpoint,{headers:{Accept:"application/json","User-Agent":"EARTIFY-TerraTwin/1.1"},signal:AbortSignal.timeout(20000)});
      if(!response.ok) return send(res,response.status===404?404:502,{error:`NASA Harmony capabilities returned HTTP ${response.status}. This collection may not be supported by Harmony.`});
      const capabilities=await response.json();
      const summary=capabilities.summary||{};
      return send(res,200,{collectionId,shortName:capabilities.shortName||null,conceptId:capabilities.conceptId||collectionId,capabilities:{bboxSubset:!!(summary.bboxSubset??capabilities.bboxSubset),temporalSubset:!!(summary.temporalSubset??capabilities.temporalSubset),variableSubset:!!(summary.variableSubset??capabilities.variableSubset),outputFormats:summary.outputFormats||capabilities.outputFormats||[],services:capabilities.services||[],variables:capabilities.variables||[]},requiresEarthdataLogin:true,source:"NASA Harmony",documentation:"https://harmony.earthdata.nasa.gov/docs"});
    } catch(error){return send(res,502,{error:"Could not retrieve NASA Harmony capabilities.",details:error.message});}
  }

  // Build a bounded, collection-specific Harmony subset URL. This does not download
  // the result on the EARTIFY server; the user's Earthdata Login handles authorization.
  if (url.pathname === "/api/terratwin/subset-url" && req.method === "GET") {
    const collectionId=String(url.searchParams.get("collectionId")||"").trim();
    const variable=String(url.searchParams.get("variable")||"all").trim().slice(0,120);
    const west=Number(url.searchParams.get("west")),south=Number(url.searchParams.get("south")),east=Number(url.searchParams.get("east")),north=Number(url.searchParams.get("north"));
    const start=String(url.searchParams.get("start")||"").trim(),end=String(url.searchParams.get("end")||"").trim();
    if(!/^(C\d{6,}-[A-Z0-9_-]+|[A-Z0-9][A-Z0-9_.-]{1,79})$/i.test(collectionId)) return send(res,400,{error:"Invalid NASA collection ID."});
    if(!variable||!/^[A-Za-z0-9_,.-]+$/.test(variable)) return send(res,400,{error:"Invalid variable name. Use a variable from the collection capabilities."});
    if(![west,south,east,north].every(Number.isFinite)||west < -180||east > 180||west>=east||south < -90||north>90||south>=north) return send(res,400,{error:"Enter a valid bounding box: west < east and south < north."});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end) return send(res,400,{error:"Enter a valid date range in YYYY-MM-DD format."});
    try {
      const capUrl=new URL("https://harmony.earthdata.nasa.gov/capabilities");capUrl.searchParams.set("collectionId",collectionId);
      const capRes=await fetch(capUrl,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
      if(!capRes.ok)return send(res,502,{error:"Could not verify this collection's Harmony support."});
      const caps=await capRes.json(),summary=caps.summary||{};
      const bbox=!!(summary.bboxSubset??caps.bboxSubset),temporal=!!(summary.temporalSubset??caps.temporalSubset),variableOk=!!(summary.variableSubset??caps.variableSubset);
      if(!bbox||!temporal)return send(res,422,{error:"This collection does not advertise both spatial and temporal subsetting in Harmony. Use its original archive access links instead.",capabilities:{bboxSubset:bbox,temporalSubset:temporal,variableSubset:variableOk}});
      if(variable!=="all"&&variableOk&&Array.isArray(caps.variables)&&caps.variables.length){const names=caps.variables.map(v=>String(v.name||v.id||v.label||""));if(!names.some(n=>n===variable))return send(res,400,{error:"Variable was not found in this collection's advertised variable list."});}
      const pathVariable=variableOk?variable:"all";
      const endpoint=new URL(`https://harmony.earthdata.nasa.gov/${encodeURIComponent(collectionId)}/ogc-api-coverages/1.0.0/${encodeURIComponent(pathVariable)}/coverage/rangeset`);
      endpoint.searchParams.append("subset",`lat(${south},${north})`);endpoint.searchParams.append("subset",`lon(${west},${east})`);endpoint.searchParams.append("subset",`time("${start}","${end}")`);
      endpoint.searchParams.set("maxResults","10");
      return send(res,200,{url:endpoint.toString(),collectionId,variable:pathVariable,boundingBox:{west,south,east,north},time:{start,end},maxResults:10,requiresEarthdataLogin:true,note:"NASA Harmony will process this request only if the selected collection's deployed service supports the requested axes and variable. The result may be an asynchronous job or a downloadable subset; it is not stored by EARTIFY.",source:"NASA Harmony"});
    }catch(error){return send(res,502,{error:"Could not build the NASA subset request.",details:error.message});}
  }

  if (url.pathname === "/api/nasa/gibs" && req.method === "GET") {
    return send(res,200,{source:"NASA GIBS",capabilities:"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml",tileTemplate:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tileMatrixSet}/{z}/{y}/{x}.jpg",note:"GIBS is an Earth imagery service. Layer availability and dates vary; this does not make planetary PDS rasters directly renderable."});
  }

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
      const input=await readBody(req);
      if(!String(input.place||'').trim()) return send(res,400,{error:'Enter a place or thing to search for.'});
      const [firstResult,secondResult]=await Promise.all([searchApprovedArchives(input.place,8),String(input.place2||'').trim()?searchApprovedArchives(input.place2,8):Promise.resolve(null)]);
      const asCard=(query,result)=>({query,title:query,found:result.items.length>0,description:`Approved archives only · ${result.items.length} records`,extract:result.items.slice(0,5).map(item=>`${item.title}: ${item.extract}`).join('\n\n')||'No matching records were returned by the approved sources.',url:result.items[0]?.url||'https://search.earthdata.nasa.gov/',items:result.items,source:'EARTIFY approved-source registry',retrievedAt:result.retrievedAt,errors:result.errors});
      const first=asCard(input.place,firstResult),second=secondResult?asCard(input.place2,secondResult):null;
      const who=currentUser(req);if(who){db.history.push({id:crypto.randomUUID(),userId:who.id,query:[input.place,input.place2].filter(Boolean).join(' vs '),createdAt:new Date().toISOString()});saveDB();}
      return send(res,200,{first,second,source:'EARTIFY approved-source registry',disclaimer:'Search is restricted to the approved NASA PDS and NASA Earthdata archives currently connected. Other user-approved sources are registered but will not appear until their official data interfaces are integrated. No external fallback is used.'});
    } catch(e){return send(res,502,{error:e.message||'Approved-source search failed'});}
  }
  if (url.pathname === "/api/compare-text" && req.method === "POST") {
    try {
      const input=await readBody(req);
      if(!String(input.first||'').trim()||!String(input.second||'').trim()) return send(res,400,{error:'Enter both items to compare.'});
      const [a,b]=await Promise.all([searchApprovedArchives(input.first,8),searchApprovedArchives(input.second,8)]);
      const asCard=(query,result)=>({query,title:query,description:`Approved archives only · ${result.items.length} records`,extract:result.items.slice(0,5).map(item=>`${item.title}: ${item.extract}`).join('\n\n')||'No matching records were returned by the approved sources.',url:result.items[0]?.url||'https://search.earthdata.nasa.gov/',items:result.items});
      return send(res,200,{first:asCard(input.first,a),second:asCard(input.second,b),source:'EARTIFY approved-source registry',disclaimer:'Both searches used only approved NASA PDS and NASA Earthdata endpoints. Missing results are not filled from other websites.'});
    } catch(e){return send(res,502,{error:e.message||'Approved-source comparison failed'});}
  }
  if (url.pathname === "/api/robot-chat" && req.method === "POST") {
    try {
      const input=await readBody(req); const message=String(input.message||"").trim().slice(0,1200);
      if(!message) return send(res,400,{error:"Type a message first."});
      const signedIn=currentUser(req);
      const siteLanguage=input.siteLanguage === "ar" ? "ar" : "en";
      const storedWebsiteHelp=getWebsiteHelpReply(message,siteLanguage);
      const navigation=getWebsiteNavigationIntent(message);
      if(storedWebsiteHelp || navigation) {
        const guideReply=storedWebsiteHelp || (siteLanguage==='ar' ? 'حاضر! هفتح لك القسم المناسب في EARTIFY، وبعدها أقدر أساعدك تستخدمه خطوة بخطوة.' : 'Absolutely. I’ll open the relevant EARTIFY section, then help you use it step by step.');
        if(signedIn){appendUserConversation(signedIn.id,"user",message);appendUserConversation(signedIn.id,"assistant",guideReply);saveDB();}
        return send(res,200,{reply:guideReply,mode:"website-guide",source:"built-in EARTIFY help",navigation});
      }
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
      if(detectedIntent==="scientific_research" || /\b(nasa|pds|earthdata|scientific|dataset|research|بيانات|ناسا|بحث علمي)\b/i.test(rawMessage)) {
        try { researchResults=await multiSourceResearchSearch(rawMessage,3); } catch (_) { researchResults={items:[],providers:{}}; }
      }
      const teachingMode=classifyTeachingMode(rawMessage);
      const teachingRequested=detectedIntent==="explanation" || /(step.?by.?step|i don.t understand|why does|how does|واحدة واحدة|خطوة بخطوة)/i.test(rawMessage);
      const systemPrompt=`${WEBSITE_KNOWLEDGE}\n\nThe website language selected in the browser is ${siteLanguage}. For help with the interface, use the exact section and control names from the guide above. Reply in the language used by the user; mention UI labels in the website language where useful. Never invent unavailable features.\n\nDetected intent hint: ${detectedIntent}. Teaching depth hint: ${teachingMode}. These are fallible hints; follow the actual message and conversation, not the labels. You are Cero, EARTIFY's conversational AI, patient teacher, and careful research assistant. Reply in ${replyLanguage}; match the user's register naturally. Understand typos, informal wording, dialect, Arabizi, code-switching, short follow-ups, pronouns, and references using the conversation history. Do not assume two similar spellings always mean the same thing; use context and ask one concise clarification when intent remains genuinely ambiguous.

GENERAL CONVERSATION: Help with broad everyday, educational, technical, creative, and scientific questions, not only space. Be natural, relevant, non-repetitive, and answer the actual request. Keep simple requests concise; do not pad.

TEACHING: When the user wants to learn, ${teachingRequested ? "use a thorough step-by-step teaching approach for this turn." : "adapt the depth to their wording and demonstrated level."} Start from the prerequisite idea when needed; teach one concept at a time; explain what it means and WHY it works; define technical terms; show every meaningful algebra/calculation step; give a worked example and explain common mistakes. For math/physics identify givens, required quantity, formula and why it applies, substitution, calculation, units, and a reasonableness check. Do not skip transformations. If the learner says they are confused, change the explanation and example instead of repeating the same wording. For practice, ask one question at a time and wait for the answer; do not reveal the answer when they asked to try independently. Check understanding naturally without turning every answer into a quiz. Avoid an overwhelming wall of text: use clear stages and pause at a sensible point.

RESEARCH SOURCE POLICY (MANDATORY): When searching for scientific or planetary data, use only the EARTIFY approved-source registry supplied in context and the live records retrieved from NASA PDS / NASA Earthdata. Never use Wikipedia, NASA NTRS, Crossref, arXiv, Google, general web search, or any unlisted source as a fallback. If the approved sources return no records, say that no matching data was returned; do not fill gaps from memory or another source. Cite the exact approved archive record URL and identify metadata as metadata, not as a calibrated measurement. Clearly distinguish retrieved evidence, general background knowledge, hypotheses, estimates, and unknowns. Never invent a paper, DOI, citation, measurement, search, or URL. Only say a source was searched if it was actually retrieved. If the supplied context is insufficient, say exactly what is missing and suggest a primary source. Do not treat an encyclopedia summary as primary mission data.

CONTEXT & PRIVACY: Use only the conversation history provided for this user. Resolve follow-up references from it. Never claim persistent memory across accounts or sessions. Do not reveal secrets or credentials. If asked to perform an action, use an available tool or clearly state what cannot be done.

STYLE: Be patient, encouraging, accurate, and specific. Never shame mistakes. Do not force every response into a space topic. Avoid generic filler and repetitive greetings. If uncertain, be transparent rather than pretending.`;
      const context=[
        `Approved scientific sources (strict allowlist): ${JSON.stringify(APPROVED_SOURCES.map(({name,url,status,category})=>({name,url,status,category})))}`,
        evidence?.found ? `Retrieved background reference (Wikipedia summary, not a NASA dataset): ${JSON.stringify({title:evidence.title,extract:evidence.extract,url:evidence.url})}` : "No unapproved reference source was queried.",
        researchResults.items.length ? `Scientific archive records retrieved live from approved NASA PDS and NASA Earthdata sources: ${JSON.stringify(researchResults.items)}` : "No live scientific records were retrieved for this turn.",
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
      return send(res,200,{reply,mode:"ai",provider:aiProvider,reference:evidence?.found?{name:evidence.title,url:evidence.url}:null,research:researchResults.items,researchProviders:researchResults.providers,sourcePolicy:"strict-allowlist",approvedSources:APPROVED_SOURCES.map(({id,name,url,status})=>({id,name,url,status}))});
    } catch(e){return send(res,502,{error:e.message||"Chat failed"});}
  }
  if (url.pathname === "/api/research/search" && req.method === "GET") {
    const query=String(url.searchParams.get('q')||'').trim();
    if(query.length<3) return send(res,400,{error:'Enter at least 3 characters to search the approved scientific archives.'});
    try {
      const result=await searchApprovedArchives(query,8);
      return send(res,200,{query,...result,sourcePolicy:'strict-allowlist',approvedSources:APPROVED_SOURCES.map(({id,name,url,status})=>({id,name,url,status})),notice:result.items.length?'Results are archive metadata from approved NASA sources only. Verify each product, variables, units, calibration, and access conditions before scientific comparison.':'No records were returned by the currently integrated approved sources. No outside source was queried.'});
    } catch(e){return send(res,502,{error:'Approved archive search failed.',details:e.message});}
  }
  if (url.pathname === "/api/research/ntrs" && req.method === "GET") {
    return send(res,410,{error:'NASA NTRS is not in the approved source list. This endpoint is disabled to enforce the source policy.',sourcePolicy:'strict-allowlist'});
  }
  if (url.pathname === "/api/nasa-images") {
    return send(res,410,{error:'NASA Image Library is not in the approved source list. Use the approved NASA Worldview / GIBS map layers instead.',sourcePolicy:'strict-allowlist'});
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
