/* Sample data, ported from the "Sample data" section of web/index.html.
   The literals below are copied from the prototype by script; do not retype them by hand.
   createSeed() builds a fresh copy on every call, so tests can each start from a clean state. */
import { MODELS, SAMPLE_COUNTRIES } from './constants';
import { logRunTo } from './draft';
import type {
  Agent, AppState, Article, Deploy, DeviceSession, Integration, LogEntry, ModId, ModTable, Notification, NotifyPrefs,
  Schedule, Settings, Site, Skill, User, WorkflowRun,
} from './types';

type SiteSeed = Omit<Site, 'spend' | 'clicks' | 'tok28'>;

/** Everything in AppState that is domain data (no session, no shell state). */
export type SeedData = Pick<AppState,
  'sites' | 'agents' | 'skills' | 'approvals' | 'articles' | 'artN' | 'log' | 'ints' | 'settings' | 'schedules' | 'deploys'
  | 'np' | 'sessions' | 'jobLog' | 'kwReqs' | 'live' | 'runs' | 'users' | 'notifs' | 'mod' | 'uid'>;

/** mulberry32, the generator the prototype uses for the 115 generated sites. */
function siteRandom(seed: number): () => number {
  let a = seed;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/**
 * @param now  Timestamp the sample log and notifications are dated from.
 * @param rand Random source for the sample run history (durations and token counts), as in the prototype.
 */
/** The live state before the server answered (and after sign-out). */
export { emptyLive } from './liveState';
import { emptyLive } from './liveState';

export function createSeed(now: number = Date.now(), rand: () => number = Math.random): SeedData {
const baseSites: SiteSeed[] = [
 {id:'a',domain:'domain-a.example',country:'Vietnam',cc:'VN',lang:'Vietnamese',topic:'Coffee and cafés',status:'live',access:'ok',checked:'09:12',deploy:'Yesterday 16:40',silos:['Brewing','Beans','Gear','Hanoi cafés','Saigon cafés']},
 {id:'b',domain:'domain-b.example',country:'Bangladesh',cc:'BD',lang:'Bengali',topic:'Phone reviews',status:'live',access:'ok',checked:'09:12',deploy:'Today 07:05',silos:['Reviews','Comparisons','Prices','Android tips']},
 {id:'c',domain:'domain-c.example',country:'Thailand',cc:'TH',lang:'Thai',topic:'Food travel',status:'live',access:'blocked',checked:'09:13',deploy:'3 days ago',silos:['Bangkok','Chiang Mai','Street food','Recipes']},
 {id:'d',domain:'domain-d.example',country:'Philippines',cc:'PH',lang:'Filipino',topic:'Personal finance',status:'build',access:'ok',checked:'09:13',deploy:'Never',silos:['Saving','Loans','Insurance']},
 {id:'e',domain:'domain-e.example',country:'Pakistan',cc:'PK',lang:'Urdu',topic:'Cricket',status:'dns',access:'pending',checked:'—',deploy:'Never',silos:[],token:'verify-7f3k2q'}
];
const SPEND: Record<string, number> = {a:14.2,b:21.4,c:3.1,d:9.8}, C28: Record<string, number> = {a:18420,b:9310,c:2140,d:0}, T28: Record<string, number> = {a:1.9,b:1.4,c:0.5,d:0.7};
const sites: Site[] = baseSites.map(s => ({ ...s, spend: SPEND[s.id] || 0, clicks: C28[s.id] || 0, tok28: T28[s.id] || 0 }));
{ /* 115 generated sample sites, so every screen is exercised at scale */
 const r = siteRandom(20261001);
 const T=['Home cooking','Budget travel','Football news','Skin care','Used cars','Online courses','Mobile games','Gardening','Home repair','Pet care','Fitness at home','Small business','Street food','Phone accessories','Baby care','Motorbikes'];
 for(let i=6;i<=120;i++){const c=SAMPLE_COUNTRIES[(i*5+3)%SAMPLE_COUNTRIES.length]!,st=i%29===0?'dns':i%23===0?'build':i%17===0?'paused':'live';
  sites.push({id:'g'+i,domain:'site-'+String(i).padStart(3,'0')+'.example',country:c[0],cc:c[1],lang:c[2],topic:T[i%T.length]!,status:st,access:st==='dns'?'pending':i%19===0?'blocked':'ok',checked:st==='dns'?'—':'09:1'+(i%10),deploy:st==='dns'||st==='build'?'Never':['Today 06:30','Yesterday 18:10','2 days ago','Last week'][i%4]!,silos:st==='dns'?[]:['Guides','Reviews','News'],token:'verify-'+(1e5+i*7919).toString(36),spend:st==='live'?Math.round(r()*1400)/100:0,clicks:st==='live'?Math.round(200+r()*9000):0,tok28:st==='live'?Math.round(5+r()*60)/100:0});}
}
const skills: Skill[] = [
 {id:'s1',name:'SERP research',desc:'How to study a country\'s search results through a SERP data API, never by querying Google. 123 rules, each tied to a quote from Google and DataForSEO docs.',ver:'1.0'},
 {id:'s2',name:'Keyword research',desc:'Keyword ideas, search volume and Search Console query data, without keyword stuffing. 118 rules from Google, Google Ads and DataForSEO docs.',ver:'1.0'},
 {id:'s3',name:'Site architecture',desc:'URL structure, navigation, breadcrumbs, canonical URLs, pagination and sitemaps. 120 rules from Google Search Central.',ver:'1.0'},
 {id:'s4',name:'Article writing',desc:'People-first articles and reviews, AI-assisted drafts, dates and localisation. 119 rules from Google Search Central and the Google style guide.',ver:'1.0'},
 {id:'s5',name:'On-page audit',desc:'Titles, snippets, robots rules, structured data, mobile and JavaScript rendering, status codes. 129 rules from Google Search Central.',ver:'1.0'},
 {id:'s6',name:'AI search features',desc:'AI Overviews, AI Mode and featured snippets: what is required, what Google says is not needed, and removed features. 132 rules from Google Search Central.',ver:'1.0'},
 {id:'s7',name:'Internal linking',desc:'Crawlable links, anchor text, outbound link attributes and link spam. 85 rules from Google Search Central.',ver:'1.0'},
 {id:'s8',name:'Web performance',desc:'Core Web Vitals (LCP, INP, CLS): thresholds, measurement and documented fixes. 247 rules from web.dev and Google Search Central.',ver:'1.0'},
 {id:'s11',name:'Material Design 3 (web)',desc:'Default design system for building websites. Each site still gets its own theme from its source color.',ver:'1.1',def:'Default for websites'},
 {id:'s12',name:'Google Search Central SEO',desc:'Default SEO guidance from Google\'s documentation, including the spam-policy check before publishing.',ver:'1.1',def:'Default for SEO'},
 {id:'s9',name:'Deploy and access checks',desc:'Cloudflare Pages deploys, domains, DNS and SSL, plus DNS and HTTP probes from inside the target country. 176 rules from Cloudflare, Globalping and Google docs.',ver:'1.0'},
 {id:'s10',name:'Search analytics',desc:'Search Console and GA4 data through their APIs, rank tracking from Search Console, and traffic-drop checks. 157 rules from Google docs.',ver:'1.0'},
 {id:'s13',name:'Images and alt text',desc:'Text alternatives, image SEO and image loading. 102 rules from W3C, Google Search Central and web.dev.',ver:'1.0'},
 {id:'s14',name:'Agent orchestration',desc:'Delegating to subagents, choosing models, prompt caching, batch processing and approval pauses on OpenAI. 352 rules, each tied to a quote from OpenAI and Google documentation.',ver:'2.0'}
];
const baseAgents: Omit<Agent, 'hue'>[] = [
 {id:'orc',name:'Orchestrator',role:'Splits and sequences work',model:MODELS[2],skills:['s14'],workers:1,tokens:412000,status:'work',progress:40,site:'a',task:'Building the morning job queue for 4 sites',tasks:['Assigning this week\'s tasks to agents','Checking for stuck jobs','Building the next job queue']},
 {id:'res',name:'Research',role:'Market and competitor research',model:MODELS[1],skills:['s1'],workers:2,tokens:286000,status:'work',progress:62,site:'d',task:'Mapping the top 10 competitors for saving money',tasks:['Mapping top competitors','Summarizing content patterns in the local SERP','Looking for topic gaps']},
 {id:'kw',name:'Keyword',role:'Clusters and prioritizes keywords',model:MODELS[0],skills:['s1','s2','s12'],workers:3,tokens:154000,status:'err',progress:18,site:'b',task:'Keyword API rate limit. Retrying automatically.',errT:25,tasks:['Clustering new keywords','Scoring cluster priority','Refreshing search volumes']},
 {id:'arc',name:'Architect',role:'Site and URL structure',model:MODELS[1],skills:['s3','s12'],workers:1,tokens:97000,status:'idle',progress:0,site:'d',task:'Waiting for a task',tasks:['Designing a new silo','Reviewing page click depth','Drafting the URL map']},
 {id:'wr',name:'Content Writer',role:'Writes and localizes articles',model:MODELS[1],skills:['s4','s6','s12'],workers:5,tokens:1240000,status:'work',progress:28,site:'a',task:'Writing "cách pha cà phê phin" (1,400 words)',gate:'Publish',tasks:['Writing a pillar article','Writing a supporting article','Revising an article from reviewer notes']},
 {id:'seo',name:'SEO/GEO Optimizer',role:'On-page, schema and search appearance',model:MODELS[1],skills:['s5','s6','s12'],workers:2,tokens:322000,status:'work',progress:77,site:'b',task:'Auditing on-page for 24 review pages',tasks:['Auditing new pages','Adding FAQ schema','Tightening lead answers']},
 {id:'lnk',name:'Internal Linker',role:'Links between pages on one site',model:MODELS[0],skills:['s7','s12'],workers:1,tokens:88000,status:'idle',progress:0,site:'c',task:'Waiting for a task',tasks:['Finding orphan pages','Proposing links to pillar pages','Fixing repeated anchor text']},
 {id:'bld',name:'Site Builder',role:'Themes, templates and builds',model:MODELS[2],skills:['s8','s11','s13'],workers:1,tokens:540000,status:'work',progress:51,site:'d',task:'Building article and category templates',tasks:['Building page templates','Adjusting the theme','Improving Core Web Vitals']},
 {id:'dep',name:'Deploy & Monitor',role:'Deploys and per-country access checks',model:MODELS[0],skills:['s9'],workers:1,tokens:61000,status:'wait',progress:100,site:'b',task:'Deploy of 12 new pages is waiting for approval',gate:'Deploy',pending:1,tasks:['Preparing a deploy of new pages','Checking domain access from the target country','Checking the SSL certificate']},
 {id:'ana',name:'Analyst',role:'GSC, GA4 and rank tracking',model:MODELS[1],skills:['s10'],workers:1,tokens:133000,status:'idle',progress:0,site:'a',task:'Waiting for a task',tasks:['Reading 28 days of GSC data','Finding pages that lost rankings','Writing the weekly report']},
 {id:'gd',name:'Graphic Designer',role:'Featured images, infographics and charts',model:MODELS[1],skills:['s13','s11','s12'],workers:1,tokens:74000,status:'work',progress:35,site:'a',task:'Drawing an infographic for "phin coffee ratios"',tasks:['Designing a featured image','Drawing an infographic as SVG','Building a comparison chart','Writing alt text for new images']}
];
const agents: Agent[] = baseAgents.map((a, i) => ({ ...a, hue: i % 11 }));
const approvals: AppState['approvals'] = [{id:1,kind:'Deploy',what:'12 new pages',site:'b',agent:'dep'}];
const articles: Article[] = [
 {id:1,s:'a',title:'Cà phê sữa đá kiểu Sài Gòn',titleEn:'Saigon-style iced milk coffee',kw:'cà phê sữa đá',words:1150,rev:0,status:'review',notes:[],
  native:{st:'done',by:'VN reviewer',note:'Reads naturally, no corrections.'},
  checks:[['ok','Duplication','3% overlap with other pages'],['ok','Facts and figures','Measurements match the source'],['ok','On-page','Title, meta and headings complete'],['ok','Links','No broken links']],
  paras:[['Cà phê sữa đá là thức uống quen thuộc của người Sài Gòn. Chỉ cần cà phê phin, sữa đặc và đá là bạn có thể tự pha tại nhà.','Iced milk coffee is an everyday drink in Saigon. With phin coffee, condensed milk and ice, you can make it at home.'],
   ['Cho 2 thìa sữa đặc vào ly, đặt phin lên trên và thêm 20 gam cà phê. Rót nước sôi, chờ khoảng 5 phút cho cà phê nhỏ giọt hết.','Put 2 spoons of condensed milk in a glass, set the phin on top and add 20 grams of coffee. Pour in boiling water and wait about 5 minutes for it to finish dripping.'],
   ['Khuấy đều rồi thêm đá. Nên dùng cà phê robusta rang đậm để có vị đậm đà đúng kiểu Sài Gòn.','Stir well, then add ice. Dark-roast robusta gives the strong flavor Saigon is known for.']]},
 {id:2,s:'b',title:'২০,০০০ টাকার নিচে সেরা ১০টি স্মার্টফোন',titleEn:'10 best phones under 20,000 taka',kw:'সেরা স্মার্টফোন',words:2100,rev:0,status:'review',notes:[],
  native:{st:'wait'},
  checks:[['ok','Duplication','5% overlap with other pages'],['bad','Testing claim','Says "we tested for seven days" but no real testing happened'],['warn','Facts and figures','2 prices do not match the source'],['ok','On-page','Complete']],
  paras:[['কম বাজেটে ভালো স্মার্টফোন খুঁজে পাওয়া সহজ নয়। এই তালিকায় আমরা ২০,০০০ টাকার নিচে সেরা ১০টি ফোন বেছে নিয়েছি।','Finding a good phone on a small budget is not easy. In this list we picked the 10 best phones under 20,000 taka.'],
   ['প্রতিটি ফোনের ব্যাটারি, ক্যামেরা এবং পারফরম্যান্স আমরা সাত দিন ধরে পরীক্ষা করেছি।','We tested each phone\'s battery, camera and performance for seven days.'],
   ['দাম সময়ের সাথে বদলাতে পারে, তাই কেনার আগে বর্তমান দাম দেখে নিন।','Prices change over time, so check the current price before buying.']]},
 {id:3,s:'c',title:'5 ร้านข้าวซอยในเชียงใหม่',titleEn:'5 khao soi spots in Chiang Mai',kw:'ร้านอาหารเชียงใหม่',words:1300,rev:0,status:'review',notes:[],
  native:{st:'wait'},
  checks:[['ok','Duplication','2% overlap with other pages'],['warn','Facts and figures','Opening hours for 2 places are unverified'],['ok','On-page','Complete'],['warn','Domain access','Domain is currently blocked in Thailand']],
  paras:[['ข้าวซอยเป็นอาหารขึ้นชื่อของเชียงใหม่ น้ำแกงเข้มข้น หอมเครื่องเทศ กินคู่กับผักกาดดองและหอมแดง','Khao soi is Chiang Mai\'s signature dish. The curry broth is rich and fragrant, served with pickled greens and shallots.'],
   ['เราคัดร้านที่คนท้องถิ่นแนะนำ พร้อมเวลาเปิดปิดและราคาโดยประมาณ','We chose places locals recommend, with opening hours and rough prices.']]},
 {id:4,s:'d',title:'Paano mag-ipon kahit maliit ang sahod',titleEn:'How to save on a small salary',kw:'paano mag-ipon ng pera',words:1300,rev:1,status:'review',notes:['Revision 1: examples changed to pesos and the loans section removed.'],
  native:{st:'done',by:'PH reviewer',note:'Two sentences were too formal; fixed.'},
  checks:[['ok','Duplication','4% overlap with other pages'],['ok','Facts and figures','No figures that need a source'],['ok','On-page','Complete'],['info','Sensitive topic','Finance: always reviewed by a person']],
  paras:[['Hindi kailangang malaki ang sahod para makapag-ipon. Ang mahalaga ay may malinaw na plano at disiplina.','You do not need a big salary to save. What matters is a clear plan and discipline.'],
   ['Magsimula sa pagtatabi ng 10% ng iyong kita bago gumastos sa ibang bagay.','Start by setting aside 10% of your income before spending on anything else.']]}
];
const log: LogEntry[] = [
 {t:new Date(now-3*6e4),actor:'Deploy & Monitor',act:'Requested approval to deploy 12 pages',site:'b'},
 {t:new Date(now-9*6e4),actor:'Deploy & Monitor',act:'Access check: DNS is redirected on Thai networks',site:'c'},
 {t:new Date(now-14*6e4),actor:'Keyword',act:'Error: keyword API rate limit',site:'b'},
 {t:new Date(now-22*6e4),actor:'Admin',act:'Replaced the DataForSEO API key',site:null},
 {t:new Date(now-41*6e4),actor:'Content Writer',act:'Finished the article "Đắk Lắk robusta beans"',site:'a'},
 {t:new Date(now-65*6e4),actor:'Admin',act:'Added domain-e.example (Pakistan)',site:'e'},
 {t:new Date(now-90*6e4),actor:'Orchestrator',act:'Started the "New site" workflow',site:'d'}
];
const ints: Integration[] = [
 {id:'openai',name:'OpenAI API',use:'GPT-6 Luna for volume work, GPT-6.1 Sol for complex work at lower cost, GPT-6 Astra for the hardest jobs.',icon:'neurology',type:'key',tail:'demo',st:'ok',ai:true},
 {id:'dfs',name:'DataForSEO',use:'Keyword volumes and SERP data by country',icon:'database',type:'key',tail:'9kQ2',st:'warn',msg:'Quota almost used'},
 {id:'cf',name:'Cloudflare',use:'DNS, SSL and deploys',icon:'cloud',type:'key',tail:'Lm81',st:'ok'},
 {id:'probe',name:'Multi-country probes',use:'Checks domain access from the target country',icon:'travel_explore',type:'key',tail:'t0Pz',st:'ok'},
 {id:'slack',name:'Slack',use:'Sends alerts to a channel',icon:'forum',type:'key',tail:'x9Wb',st:'ok'},
 {id:'tg',name:'Telegram',use:'Sends alerts to a chat',icon:'send',type:'key',tail:null,st:null},
 {id:'email',name:'Email (SMTP)',use:'Sends the weekly report and email alerts',icon:'mail',type:'key',tail:'reports@example.com',st:'ok'},
 {id:'google',name:'Google sign-in',use:'The OAuth client that Search Console and Analytics connect through',icon:'key',type:'key',tail:'1234-abc…',st:'ok'},
 {id:'gsc',name:'Google Search Console',use:'Clicks, impressions, positions and rank data',icon:'query_stats',type:'oauth',tail:'4 properties',st:'ok'},
 {id:'ga4',name:'Google Analytics 4',use:'Users, sessions and conversions',icon:'analytics',type:'oauth',tail:null,st:null}
];
const settings: Settings = {budget:25,parallel:24,apPublish:true,apDeploy:true,native:true,twofa:true,timeout:'h8',quiet:'none',repTo:'boss@example.com, team@example.com',repFreq:'Every Monday 08:00',repOn:true};
const schedules: Schedule[] = [
 {id:'c1',wf:'Weekly content',site:'a',cad:'Every Monday 06:00',on:true},
 {id:'c2',wf:'Weekly content',site:'b',cad:'Every Monday 06:00',on:true},
 {id:'c3',wf:'Weekly content',site:'c',cad:'Every Monday 06:00',on:false},
 {id:'c4',wf:'Domain access check',site:null,cad:'Every hour',on:true},
 {id:'c5',wf:'Internal link audit',site:'a',cad:'Every Friday 16:00',on:true}
];
const deploys: Deploy[] = [
 {id:'d1',site:'b',ver:14,what:'82 review pages, new price tables',by:'Admin',when:'Today 07:05',live:true},
 {id:'d2',site:'b',ver:13,what:'Template fix for spec tables',by:'Content lead',when:'2 days ago',live:false},
 {id:'d3',site:'a',ver:22,what:'6 brewing articles',by:'Admin',when:'Yesterday 16:40',live:true},
 {id:'d4',site:'a',ver:21,what:'Café directory layout',by:'Admin',when:'4 days ago',live:false},
 {id:'d5',site:'c',ver:9,what:'3 street food guides',by:'Content lead',when:'3 days ago',live:true},
 {id:'d6',site:'c',ver:8,what:'Homepage refresh',by:'Admin',when:'Last week',live:false}
];
{ const RANK: Record<string, number> = {d2:.8,d4:2.1,d5:-3.4,d6:.5}; deploys.forEach(d=>{ if (d.id in RANK) d.rank = RANK[d.id]; }); } /* sample rank effect; unset means still measuring */
const np: NotifyPrefs = {approval:[true,true,false,false],error:[true,false,true,false],blocked:[true,true,true,false],budget:[true,true,false,false],review:[true,false,false,false],report:[true,true,false,false]};
const sessions: DeviceSession[] = [{id:'x1',dev:'This browser',where:'Current session',cur:true},{id:'x2',dev:'Chrome on Windows',where:'Jakarta · 2 hours ago'},{id:'x3',dev:'Safari on iPhone',where:'Jakarta · yesterday'}];
const runs: WorkflowRun[] = [{name:'New site',site:'d',step:4},{name:'New site',site:'e',step:0},{name:'Weekly content',site:'a',step:5},{name:'Weekly content',site:'b',step:7},{name:'Weekly content',site:'c',step:6}];
const users: User[] = [
 {id:'u1',name:'You',email:'admin@example.com',role:'Admin',scope:'All sites',st:'Active'},
 {id:'u2',name:'Content lead',email:'editor@example.com',role:'Editor',scope:'All sites',st:'Active'},
 {id:'u3',name:'VN reviewer',email:'reviewer.vn@example.com',role:'Native reviewer',scope:'domain-a.example',st:'Active'},
 {id:'u4',name:'BD reviewer',email:'reviewer.bd@example.com',role:'Native reviewer',scope:'domain-b.example',st:'Active'},
 {id:'u5',name:'TH reviewer',email:'reviewer.th@example.com',role:'Native reviewer',scope:'domain-c.example',st:'Invited'},
 {id:'u6',name:'Stakeholder',email:'viewer@example.com',role:'Viewer',scope:'All sites',st:'Active'}
];
const notifs: Notification[] = [
 {id:1,t:new Date(now-9*6e4),k:'bad',icon:'gpp_bad',title:'domain-c.example is blocked in Thailand',body:'ISPs there redirect its DNS. Readers cannot open the site.',view:'deploy',read:false},
 {id:2,t:new Date(now-14*6e4),k:'bad',icon:'error',title:'Keyword agent hit a rate limit',body:'The keyword API refused requests. It retries automatically.',view:'workspace',read:false},
 {id:3,t:new Date(now-20*6e4),k:'warn',icon:'savings',title:'domain-b.example is at 86% of its daily budget',body:'Agents on this site stop when the budget is used up.',view:'analytics',read:false},
 {id:4,t:new Date(now-35*6e4),k:'info',icon:'rate_review',title:'4 articles are waiting for review',body:'Nothing publishes until someone approves it.',view:'review',read:false},
 {id:5,t:new Date(now-50*6e4),k:'warn',icon:'database',title:'DataForSEO quota is almost used',body:'Keyword research slows down when the quota runs out.',view:'integrations',read:true}
];
const mod: Record<ModId, ModTable> = {
 research:{d:'The Research agent maps competitors and content patterns in each country\'s search results.',cols:['Research topic','Source','Finding','Status'],rows:[
  {s:'a',c:['Competitors for "how to brew coffee"','Google Vietnam SERP','7 of 10 results use step-by-step video',{pill:'ok',text:'Done'}]},
  {s:'b',c:['Phone review page patterns','Google Bangladesh SERP','Spec tables and local prices appear in every top result',{pill:'ok',text:'Done'}]},
  {s:'c',c:['Bangkok street food','Google Thailand SERP','Maps and opening hours set results apart',{pill:'info',text:'Running',live:true}]},
  {s:'d',c:['Saving money','Google Philippines SERP','Savings calculators are in demand',{pill:'info',text:'Running',live:true}]},
  {s:'e',c:['First look at cricket','—','Waiting for domain verification',{pill:'mut',text:'Queued'}]}]},
 keywords:{d:'The Keyword agent clusters keywords per country. Volumes come from a keyword data API, not from the AI model.',cols:['Keyword','Meaning','Volume/mo','KD','Intent','Cluster'],num:[2,3],rows:[
  {s:'a',c:['cách pha cà phê phin','how to brew phin coffee','14,800','32','Informational','Brewing']},
  {s:'a',c:['cà phê sữa đá','iced milk coffee','40,500','48','Informational','Brewing']},
  {s:'b',c:['সেরা স্মার্টফোন','best smartphone','22,200','41','Commercial','Comparisons']},
  {s:'b',c:['মোবাইলের দাম','phone price','60,500','55','Transactional','Prices']},
  {s:'c',c:['ร้านอาหารเชียงใหม่','Chiang Mai restaurants','18,100','37','Local','Chiang Mai']},
  {s:'d',c:['paano mag-ipon ng pera','how to save money','9,900','24','Informational','Saving']}]},
 architecture:{d:'The Architect agent plans silos and pillar pages for each site.',cols:['Silo','Pillar page','Pages','Click depth','Status'],num:[2,3],rows:[
  {s:'a',c:['Brewing','/cach-pha/','18','2',{pill:'ok',text:'Live'}]},
  {s:'a',c:['Hanoi cafés','/quan-ha-noi/','11','3',{pill:'ok',text:'Live'}]},
  {s:'b',c:['Comparisons','/tulona/','14','2',{pill:'ok',text:'Live'}]},
  {s:'c',c:['Street food','/street-food/','9','3',{pill:'warn',text:'4 orphan pages'}]},
  {s:'d',c:['Saving','/ipon/','12','2',{pill:'info',text:'In design'}]}]},
 content:{d:'The Content Writer drafts, then each article goes through native-speaker review before it publishes.',cols:['Title','Language','Words','Stage','Reviewer'],num:[2],rows:[
  {s:'a',c:['Phin coffee for beginners','Vietnamese','1,400',{pill:'info',text:'Draft'},'—']},
  {s:'a',c:['Saigon-style iced milk coffee','Vietnamese','1,150',{pill:'warn',text:'Awaiting approval'},'VN reviewer']},
  {s:'b',c:['10 best phones under 20,000 taka','Bengali','2,100',{pill:'warn',text:'Native review'},'BD reviewer']},
  {s:'b',c:['Battery review: a 7-day test','Bengali','1,600',{pill:'ok',text:'Published'},'BD reviewer']},
  {s:'c',c:['A guide to Yaowarat street food','Thai','1,800',{pill:'ok',text:'Published'},'TH reviewer']},
  {s:'d',c:['Saving on a daily wage','Filipino','1,300',{pill:'info',text:'Draft'},'—']}]},
 seo:{d:'The SEO/GEO Optimizer checks on-page quality and how each page appears in search.',cols:['Page','Check','Result','Next step'],rows:[
  {s:'a',c:['/cach-pha/phin/','HowTo schema',{pill:'ok',text:'Pass'},'—']},
  {s:'b',c:['/tulona/…','Meta description',{pill:'warn',text:'9 pages are keyword lists'},'Rewritten as page summaries']},
  {s:'b',c:['/dam/…','Product schema',{pill:'bad',text:'Price missing'},'Needs price data']},
  {s:'c',c:['/bangkok/…','Headings',{pill:'ok',text:'Pass'},'—']},
  {s:'d',c:['Article template','Core Web Vitals',{pill:'info',text:'Testing',live:true},'Waiting for build']}]},
 aio:{d:'Tracks which queries show an AI Overview and whether the site is cited. Google states no special optimization is needed beyond normal SEO.',cols:['Query','AI Overview shown','Site cited','Next step'],rows:[
  {s:'a',c:['cà phê phin là gì',{pill:'ok',text:'Yes'},{pill:'ok',text:'Yes'},'Keep as is']},
  {s:'a',c:['cách pha cà phê sữa đá',{pill:'ok',text:'Yes'},{pill:'bad',text:'No'},'Put the direct answer first']},
  {s:'b',c:['সেরা স্মার্টফোন',{pill:'mut',text:'No'},'—','—']},
  {s:'c',c:['ร้านอาหารเชียงใหม่',{pill:'ok',text:'Yes'},{pill:'bad',text:'No'},'Add a list with locations']}]},
 cta:{d:'The CTA router picks a call to action based on page intent and the local offer.',cols:['Page intent','CTA','CTR','Status'],num:[2],rows:[
  {s:'a',c:['Informational','Download the brewing guide','3.1%',{pill:'ok',text:'Active'}]},
  {s:'a',c:['Local','See the café map','7.4%',{pill:'ok',text:'Active'}]},
  {s:'b',c:['Commercial','Compare prices (BDT)','5.8%',{pill:'ok',text:'Active'}]},
  {s:'b',c:['Transactional','Check today\'s price','9.2%',{pill:'info',text:'Testing',live:true}]},
  {s:'c',c:['Local','Book a table','—',{pill:'mut',text:'Paused, domain blocked'}]}]},
 factory:{d:'The Website factory runs the same flow for every new site.',cols:['Current stage','Template','Pages built','Progress'],num:[2,3],rows:[
  {s:'d',c:['Theme','Blog + calculator','0 of 36','44%']},
  {s:'e',c:['Site profile','Not chosen','0','5%']},
  {s:'a',c:['Monitor','Blog + directory','64 of 64','100%']},
  {s:'b',c:['Monitor','Reviews + tables','82 of 82','100%']}]},
 themes:{d:'Every site is built with the default Material Design 3 skill. Each theme stays distinct: source color, fonts and shape come from the site profile.',cols:['Theme','Font','Script support','Status'],rows:[
  {s:'a',c:['Warm Roast','Be Vietnam Pro','Latin with Vietnamese diacritics',{pill:'ok',text:'Installed'}]},
  {s:'b',c:['Clean Specs','Hind Siliguri','Bengali',{pill:'ok',text:'Installed'}]},
  {s:'c',c:['Night Market','Sarabun','Thai',{pill:'ok',text:'Installed'}]},
  {s:'d',c:['Calm Wallet','Not chosen','Latin',{pill:'info',text:'Building',live:true}]}]},
 experiments:{d:'Agents propose hypotheses and variants. Results are measured from data, not guessed by the model.',cols:['Experiment','Variants','Metric','Result','Status'],rows:[
  {s:'a',c:['Year in the title','A / B','CTR in GSC','+0.6 pts',{pill:'ok',text:'Done, B shipped'}]},
  {s:'b',c:['Price table above the fold','A / B','CTA clicks','+1.9 pts',{pill:'info',text:'Running, day 9',live:true}]},
  {s:'b',c:['Meta description length','A / B / C','CTR in GSC','Not enough data',{pill:'info',text:'Running',live:true}]},
  {s:'c',c:['Map at the top of the article','A / B','Engagement','—',{pill:'mut',text:'Paused'}]}]},
 gsc:{d:'Search Console data for the last 28 days, one property per site.',cols:['Clicks','Impressions','CTR','Average position'],num:[0,1,2,3],rows:[
  {s:'a',c:['18,420','412,300','4.5%','11.2']},
  {s:'b',c:['9,310','288,900','3.2%','14.8']},
  {s:'c',c:['2,140','96,500','2.2%','19.6']},
  {s:'d',c:['0','0','—','—']}]},
 ga4:{d:'GA4 data for the last 28 days, one property per site.',cols:['Users','Sessions','Engagement','Conversions'],num:[0,1,2,3],rows:[
  {s:'a',c:['21,900','27,300','61%','640']},
  {s:'b',c:['11,200','13,800','54%','510']},
  {s:'c',c:['2,600','3,000','47%','38']},
  {s:'d',c:['0','0','—','0']}]},
 rank:{d:'Positions come from Search Console for each site\'s target country. Automated rank scraping of Google is against its spam policies.',cols:['Keyword','Country','Position','7-day change'],num:[2],rows:[
  {s:'a',c:['cách pha cà phê phin','Vietnam','4',{pill:'ok',text:'up 3'}]},
  {s:'a',c:['cà phê sữa đá','Vietnam','12',{pill:'ok',text:'up 1'}]},
  {s:'b',c:['সেরা স্মার্টফোন','Bangladesh','8',{pill:'mut',text:'no change'}]},
  {s:'b',c:['মোবাইলের দাম','Bangladesh','17',{pill:'bad',text:'down 4'}]},
  {s:'c',c:['ร้านอาหารเชียงใหม่','Thailand','23',{pill:'bad',text:'down 9'}]}]}
};

 const seed: SeedData = {
  sites, agents, skills, approvals, articles, artN: 4, log, ints, settings, schedules, deploys, np, sessions,
  jobLog: [], kwReqs: [], live: emptyLive(), runs, users, notifs, mod, uid: 100,
 };
 /* Two sample runs per agent, so Run history is not empty at start. */
 agents.forEach((a, i) => {
  const t = a.task;
  a.task = a.tasks[i % a.tasks.length]!; logRunTo(seed, a, i === 2 ? 'Failed' : 'Done', (i + 1) * 11 * 6e4, rand, now);
  a.task = a.tasks[(i + 1) % a.tasks.length]!; logRunTo(seed, a, 'Done', (i + 2) * 23 * 6e4, rand, now);
  a.task = t;
 });
 seed.jobLog.sort((x, y) => y.t.getTime() - x.t.getTime());
 return seed;
}
