const { detectLanguage } = require('./assistant-core');

const WEBSITE_KNOWLEDGE = `
EARTIFY WEBSITE GUIDE (verified built-in feature guide):
- EARTIFY is an educational space exploration and planetary research prototype. It is not an official NASA product.
- Home dashboard has four shortcut cards: Exploration Fleet opens Mission Lab; Featured Destination opens Explore; Solar System Scan opens the interactive Solar System; Mission Timeline opens the comparison section.
- Solar System page: choose a planet or the Moon from the left list; drag the scene to orbit the camera; use the mouse wheel to zoom; Pause/Play stops or resumes orbital motion; Orbital Speed changes simulation speed; Show/Hide Orbits toggles orbit paths; Stop Planet Rotation toggles spin. Selecting a planet focuses the camera on it. Its labels and controls follow the website language saved in browser local storage (eartify-language).
- Compare / 3D Explorer: the page starts with an Earth vs Mars comparison. Visitors can replace either destination and run Search & Explore. The comparison is a side-by-side research view; it is not a planetary landing simulation.
- Explore section introduces destinations such as the Moon and Mars. Select/open a destination to continue to the comparison/research workflow.
- TerraTwin is the Earth-analog research workspace. Earth Analog Finder automatically discovers NASA PDS planetary and Earthdata collection metadata for a selected Mars/Moon target site. It does not ingest user CSV/JSON files or calculate validated scientific similarity scores. Scientific Maps provides NASA GIBS Earth imagery and interactive Mars/Moon reference basemaps; calibrated planetary elevation overlays are not currently loaded. Mission Simulator performs an input-only preliminary energy margin and slope screen, not engineering or crew-safety certification. The standalone NASA Data Explorer / Scientific Dataset Registry and research-report export feature have been removed.
- Mission Lab turns an environmental challenge into research directions, risks, possible countermeasures, and a robot concept.
- Research section links to planetary data and NASA image collections. Search results are leads; users should open and verify original sources.
- My Library lets signed-in users save public links or upload supported text/document files, then ask questions about saved sources. Sign-in is required for private saved documents.
- Cero is the EARTIFY assistant. Users can ask how to use any page or feature, ask about planets and missions, request explanations, or ask for help finding a control. When a request identifies a site destination, return its navigation intent so the browser opens that existing page/section; on the Solar System page, keep the user there and focus the requested planet. Give short actionable help based on the feature guide; never claim a button exists if it is not listed here.
- Language: the main site has an Arabic/English toggle. The Solar System page should use the same saved language.
- If a user is stuck, first identify the feature they mean, then give the exact section/button/control name and the next action. If the issue is ambiguous, ask which page or control they are looking at.
`;


// Deterministic navigation intents let Cero move users to the real feature,
// rather than only describing where it is. Routes are limited to existing pages/sections.
function getWebsiteNavigationIntent(message) {
  const q = String(message || '').normalize('NFKC').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase();
  const has = re => re.test(q);
  const planet = has(/\b(mercury)\b|عطارد/) ? 'mercury'
    : has(/\b(venus)\b|الزهره/) ? 'venus'
    : has(/\b(earth)\b|الارض/) ? 'earth'
    : has(/\b(mars)\b|المريخ/) ? 'mars'
    : has(/\b(jupiter)\b|المشتري/) ? 'jupiter'
    : has(/\b(saturn)\b|زحل/) ? 'saturn'
    : has(/\b(uranus)\b|اورانوس/) ? 'uranus'
    : has(/\b(neptune)\b|نبتون/) ? 'neptune'
    : has(/\b(moon|luna)\b|القمر/) ? 'moon'
    : has(/\b(sun)\b|الشمس(?!ية)/) ? 'sun' : null;
  const explicitNavigation = has(/\b(show|open|go to|take me|navigate|view|see|visit)\b|عايز.*(اشوف|اروح|افتح)|عاوز.*(اشوف|اروح|افتح)|وريني|ورّيني|افتح|وديني|خليني اشوف|روح على/);
  const asksSolarSystem = has(/solar system|solar scan|النظام الشمسي|المجموعه الشمسيه|المجموعة الشمسية|السولار سيستم/) || (explicitNavigation && has(/الكواكب|المدارات|\bplanets\b|\borbits\b/));
  if (asksSolarSystem || (planet && explicitNavigation)) {
    return { route: `/solar/${planet ? `?planet=${planet}` : ''}`, page: 'solar', planet };
  }
  if (has(/compare|comparison|3d explorer|قارن|مقارنه|مقارنة|استكشف ثلاثي/)) return { route: '/#compare', page: 'compare' };
  if (has(/terratwin|analog finder|earth analog|scientific map|mission simulator|تيرا توين|نظائر|خرائط علميه|خرائط علمية|محاكي المهمات/)) return { route: '/#terratwin', page: 'terratwin' };
  if (has(/mission lab|mission planning|مهمات|المهمات|مختبر المهمات/)) return { route: '/#mission', page: 'mission' };
  if (has(/research|nasa images|image search|بحث علمي|مصادر|صور ناسا|ناسا/)) return { route: '/#research', page: 'research' };
  if (has(/explore destinations|destinations|وجهات|استكشف الوجهات/)) return { route: '/#explore', page: 'explore' };
  if (has(/home|الرئيسيه|الرئيسية|الصفحه الرئيسيه|الصفحة الرئيسية/)) return { route: '/#home', page: 'home' };
  return null;
}

function getWebsiteHelpReply(message, preferredLanguage) {
  const q = String(message || '').toLowerCase();
  const ar = detectLanguage(message) === 'ar' || (detectLanguage(message) !== 'ar' && preferredLanguage === 'ar' && !/[a-z]{3,}/i.test(message));
  const reply = (a, e) => ar ? a : e;
  const help = /(help|how do i|how can i|where (is|can|do)|can't|cannot|stuck|not working|how to use|what is eartify|what does eartify do|what can i do here|feature|website|site|button|page|menu|ازاي|إزاي|اعمل ايه|أعمل ايه|مش عارف|مش فاهم|مش شغال|فين|مكان|استخدم|استخدام|مميزات|مميزات الموقع|الموقع|الويب سايت|الشات|الشات بوت|ميزة|خاصية|عايز اشوف|عاوز اشوف|وريني|ورّيني|افتح|وديني|خليني اشوف)/i.test(q);
  if (!help) return null;

  if (/(solar system|solar|النظام الشمسي|المجموعه الشمسيه|المجموعة الشمسية|السولار|الكواكب|المدارات|orbit|zoom|تقريب|سرعة المدار|دوران الكواكب)/i.test(q)) return reply(
    'هتلاقي **Solar System Scan** في أول الصفحة ضمن الأربع مربعات، أو اضغط **View 3D Model**. جوه الصفحة اختار الكوكب من القائمة الجانبية، واسحب بالموس لتدوير المشهد، واستخدم عجلة الماوس للتقريب. زر **إيقاف / تشغيل** يوقف الحركة، وشريط **سرعة المدار** يغير السرعة، وزر **إظهار / إخفاء المدارات** يتحكم في خطوط المدارات.',
    'Open **Solar System Scan** from the four dashboard cards, or click **View 3D Model**. Inside the page, select a planet from the left list, drag to rotate the view, and use the mouse wheel to zoom. **Pause / Play** stops or resumes motion, **Orbital Speed** changes the speed, and **Show / Hide Orbits** toggles orbit paths.'
  );
  if (/(compare|comparison|3d explorer|مقارنة|كومبير|قارن)/i.test(q)) return reply(
    'افتح قسم **Compare & Understand** من شريط التنقل أو اضغط مربع **Mission Timeline** في أول الصفحة. هتلاقي مقارنة Earth وMars جاهزة؛ غيّر اسم أي وجهة في الخانات واضغط **Search & Explore** لعمل مقارنة جديدة.',
    'Open **Compare & Understand** from the navigation bar, or click the **Mission Timeline** dashboard card. An Earth vs Mars comparison is loaded by default. Change either destination in the fields and click **Search & Explore** to run a new comparison.'
  );
  if (/(library|saved files|documents|upload|file|مكتبتي|الملفات|ملف|ارفع|احفظ|مصادري)/i.test(q)) return reply(
    'افتح **My Library** من شريط التنقل. من **Public link** تقدر تحفظ رابط، أو اختار ملف من خانة رفع الملفات، وبعدها اضغط **Save source**. علشان تحتفظ بملفاتك وتسألها بعدين لازم تسجل الدخول.',
    'Open **My Library** from the navigation bar. Add a URL in **Public link** or choose a supported file, then click **Save source**. Sign in to keep your files privately and ask questions about them later.'
  );
  if (/(terratwin|analog finder|earth analog|similarity|نظير|نظائر|تيرا توين|تشابه المناطق|محاكي المهمات|mission simulator|scientific map|خرائط علمية|mola|lola|themis|hirise)/i.test(q)) return reply(
    'افتح **TerraTwin** من شريط التنقل. استخدم **Earth Analog Finder** لاكتشاف بيانات وصفية تلقائيًا عن الموقع المستهدف، واستكشف **Scientific Maps** لصور الأرض من NASA GIBS والخرائط المرجعية للمريخ والقمر. محاكي المهمات يعمل كفحص أولي للطاقة والميل فقط. تم حذف سجل مجموعات البيانات والبحث المستقل في أرشيف NASA وزر تصدير التقرير.',
    'Open **TerraTwin** from the navigation bar. Use **Earth Analog Finder** for automatic metadata discovery about a target site, and **Scientific Maps** for NASA GIBS Earth imagery plus Mars/Moon reference basemaps. Mission Simulator is only a preliminary energy-and-slope screen. The standalone dataset registry, NASA archive-search panel, and research-report export button have been removed.'
  );
  if (/(mission lab|mission|مهمات|المهمات|مختبر)/i.test(q)) return reply(
    'اضغط **Mission Lab** من شريط التنقل، أو مربع **Exploration Fleet** في أول الصفحة. اكتب التحدي أو المشكلة البيئية اللي عايز تدرسها، واستخدم القسم لتحديد المخاطر واتجاهات البحث والحلول الممكنة.',
    'Open **Mission Lab** from the navigation bar, or click the **Exploration Fleet** dashboard card. Describe the environmental challenge you want to study, then use the section to explore risks, research directions, and possible solutions.'
  );
  if (/(research|nasa|images|image search|مصادر|بحث علمي|صور|ناسا)/i.test(q)) return reply(
    'افتح قسم **Research** من شريط التنقل. هتلاقي روابط لمصادر علمية وNASA، وكمان أداة البحث عن الصور. افتح المصدر الأصلي قبل الاعتماد على أي معلومة.',
    'Open **Research** from the navigation bar. You will find scientific and NASA source links, plus the image-search tool. Open the original source before relying on a result.'
  );
  if (/(language|arabic|english|اللغة|عربي|انجليزي|إنجليزي)/i.test(q)) return reply(
    'استخدم زر اللغة **عربي / English** الموجود أعلى الموقع بجوار تسجيل الدخول. اختيارك بيتحفظ، وصفحة **Solar System** هتفتح بنفس اللغة تلقائيًا.',
    'Use the **عربي / English** button at the top of the main website, beside the sign-in button. Your choice is saved, and the **Solar System** page will automatically use the same language.'
  );
  if (/(cero|chatbot|chat|assistant|robot|الشات|شات بوت|المساعد|الروبوت)/i.test(q)) return reply(
    'اضغط على شخصية Cero أو زر المساعد العائم لفتح الشات. اسأله عن أي ميزة في الموقع، أو اكتب اسم القسم اللي واقف عنده وقوله إيه المشكلة؛ هيوجهك للزر والخطوة المناسبة.',
    'Click Cero or the floating assistant button to open the chat. Ask about any website feature, or tell Cero which section you are using and what is confusing; it will guide you to the relevant control and next step.'
  );
  if (/(what is eartify|about eartify|what does eartify do|what are .*features|features of eartify|what can i do here|website do|موقع eartify|الموقع بيعمل|الموقع ده|ايه هو|إيه هو|مميزات الموقع|مميزات|وظيفة الموقع)/i.test(q)) return reply(
    'EARTIFY منصة تعليمية لاستكشاف الفضاء والكواكب. فيها نظام شمسي تفاعلي 3D، ومقارنة بين الكواكب والوجهات، ومختبر للمهمات، وقسم للمصادر والصور العلمية، ومكتبة لحفظ ملفاتك، ومساعد Cero يشرحلك تستخدم الموقع. المشروع تعليمي وليس منتجًا رسميًا تابعًا لناسا.',
    'EARTIFY is an educational space-exploration platform. It includes an interactive 3D Solar System, destination comparisons, a Mission Lab, scientific sources and image search, a personal research library, and the Cero assistant to guide users around the site. It is a student concept, not an official NASA product.'
  );
  if (help) return reply(
    'أكيد أساعدك. قولي بس أنت واقف في أنهي جزء: **Solar System** ولا **Compare** ولا **Mission Lab** ولا **My Library**؟ ولو فيه زر مش لاقيه، ابعتلي اسمه أو صورة للشاشة وأنا أقولك تضغط فين بالظبط.',
    'I can help. Which section are you using: **Solar System**, **Compare**, **Mission Lab**, or **My Library**? If you cannot find a control, tell me its name or share a screenshot and I will guide you to the exact place.'
  );
  return null;
}

module.exports = { WEBSITE_KNOWLEDGE, getWebsiteHelpReply, getWebsiteNavigationIntent };
