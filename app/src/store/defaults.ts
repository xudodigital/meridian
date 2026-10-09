/* Default configuration only: no sample sites, work, history, accounts or connected credentials. */
import { MODELS } from './constants';
import type { AgentConfig } from './empty';
import type { Skill, Integration, Settings, NotifyPrefs, ModId, ModTable } from './types';
export function defaultConfig() {
const skills: Skill[] = [{
  id: 's1',
  name: 'SERP research',
  desc: 'How to study a country\'s search results through a SERP data API, never by querying Google. 123 rules, each tied to a quote from Google and DataForSEO docs.',
  ver: '1.0'
}, {
  id: 's2',
  name: 'Keyword research',
  desc: 'Keyword ideas, search volume and Search Console query data, without keyword stuffing. 118 rules from Google, Google Ads and DataForSEO docs.',
  ver: '1.0'
}, {
  id: 's3',
  name: 'Site architecture',
  desc: 'URL structure, navigation, breadcrumbs, canonical URLs, pagination and sitemaps. 120 rules from Google Search Central.',
  ver: '1.0'
}, {
  id: 's4',
  name: 'Article writing',
  desc: 'People-first articles and reviews, AI-assisted drafts, dates and localisation. 119 rules from Google Search Central and the Google style guide.',
  ver: '1.0'
}, {
  id: 's5',
  name: 'On-page audit',
  desc: 'Titles, snippets, robots rules, structured data, mobile and JavaScript rendering, status codes. 129 rules from Google Search Central.',
  ver: '1.0'
}, {
  id: 's6',
  name: 'AI search features',
  desc: 'AI Overviews, AI Mode and featured snippets: what is required, what Google says is not needed, and removed features. 132 rules from Google Search Central.',
  ver: '1.0'
}, {
  id: 's7',
  name: 'Internal linking',
  desc: 'Crawlable links, anchor text, outbound link attributes and link spam. 85 rules from Google Search Central.',
  ver: '1.0'
}, {
  id: 's8',
  name: 'Web performance',
  desc: 'Core Web Vitals (LCP, INP, CLS): thresholds, measurement and documented fixes. 247 rules from web.dev and Google Search Central.',
  ver: '1.0'
}, {
  id: 's11',
  name: 'Material Design 3 (web)',
  desc: 'Default design system for building websites. Each site still gets its own theme from its source color.',
  ver: '1.1',
  def: 'Default for websites'
}, {
  id: 's12',
  name: 'Google Search Central SEO',
  desc: 'Default SEO guidance from Google\'s documentation, including the spam-policy check before publishing.',
  ver: '1.1',
  def: 'Default for SEO'
}, {
  id: 's9',
  name: 'Deploy and access checks',
  desc: 'Cloudflare Pages deploys, domains, DNS and SSL, plus DNS and HTTP probes from inside the target country. 176 rules from Cloudflare, Globalping and Google docs.',
  ver: '1.0'
}, {
  id: 's10',
  name: 'Search analytics',
  desc: 'Search Console and GA4 data through their APIs, rank tracking from Search Console, and traffic-drop checks. 157 rules from Google docs.',
  ver: '1.0'
}, {
  id: 's13',
  name: 'Images and alt text',
  desc: 'Text alternatives, image SEO and image loading. 102 rules from W3C, Google Search Central and web.dev.',
  ver: '1.0'
}, {
  id: 's14',
  name: 'Agent orchestration',
  desc: 'OpenAI task routing, shared queue, recorded costs, reviewed drafts and explicit article/deployment approvals. Matches the Meridian runtime.',
  ver: '2.0'
}];
const baseAgents: Omit<AgentConfig, 'hue'>[] = [{
  id: 'orc',
  name: 'Orchestrator',
  role: 'Splits and sequences work',
  model: MODELS[1],
  skills: ['s14'],
  workers: 1,
  tasks: ['Assigning this week\'s tasks to agents', 'Checking for stuck jobs', 'Building the next job queue']
}, {
  id: 'res',
  name: 'Research',
  role: 'Market and competitor research',
  model: MODELS[1],
  skills: ['s1'],
  workers: 2,
  tasks: ['Mapping top competitors', 'Summarizing content patterns in the local SERP', 'Looking for topic gaps']
}, {
  id: 'kw',
  name: 'Keyword',
  role: 'Clusters and prioritizes keywords',
  model: MODELS[0],
  skills: ['s1', 's2', 's12'],
  workers: 3,
  tasks: ['Clustering new keywords', 'Scoring cluster priority', 'Refreshing search volumes']
}, {
  id: 'arc',
  name: 'Architect',
  role: 'Site and URL structure',
  model: MODELS[1],
  skills: ['s3', 's12'],
  workers: 1,
  tasks: ['Designing a new silo', 'Reviewing page click depth', 'Drafting the URL map']
}, {
  id: 'wr',
  name: 'Content Writer',
  role: 'Writes and localizes articles',
  model: MODELS[1],
  skills: ['s4', 's6', 's12'],
  workers: 5,
  gate: 'Publish',
  tasks: ['Writing a pillar article', 'Writing a supporting article', 'Revising an article from reviewer notes']
}, {
  id: 'seo',
  name: 'SEO/GEO Optimizer',
  role: 'On-page, schema and search appearance',
  model: MODELS[1],
  skills: ['s5', 's6', 's12'],
  workers: 2,
  tasks: ['Auditing new pages', 'Adding FAQ schema', 'Tightening lead answers']
}, {
  id: 'lnk',
  name: 'Internal Linker',
  role: 'Links between pages on one site',
  model: MODELS[0],
  skills: ['s7', 's12'],
  workers: 1,
  tasks: ['Finding orphan pages', 'Proposing links to pillar pages', 'Fixing repeated anchor text']
}, {
  id: 'bld',
  name: 'Site Builder',
  role: 'Themes, templates and builds',
  model: MODELS[1],
  skills: ['s8', 's11', 's13'],
  workers: 1,
  tasks: ['Building page templates', 'Adjusting the theme', 'Improving Core Web Vitals']
}, {
  id: 'dep',
  name: 'Deploy & Monitor',
  role: 'Deploys and per-country access checks',
  model: MODELS[0],
  skills: ['s9'],
  workers: 1,
  gate: 'Deploy',
  tasks: ['Preparing a deploy of new pages', 'Checking domain access from the target country', 'Checking the SSL certificate']
}, {
  id: 'ana',
  name: 'Analyst',
  role: 'GSC, GA4 and rank tracking',
  model: MODELS[1],
  skills: ['s10'],
  workers: 1,
  tasks: ['Reading 28 days of GSC data', 'Finding pages that lost rankings', 'Writing the weekly report']
}, {
  id: 'gd',
  name: 'Graphic Designer',
  role: 'Featured images, infographics and charts',
  model: MODELS[1],
  skills: ['s13', 's11', 's12'],
  workers: 1,
  tasks: ['Designing a featured image', 'Drawing an infographic as SVG', 'Building a comparison chart', 'Writing alt text for new images']
}];
const ints: Omit<Integration, 'tail' | 'st' | 'msg'>[] = [{ id:'gemma',name:'Gemma localhost',use:'Local Gemma 4 through Ollama',icon:'computer',type:'key' }, {
  id: 'openai',
  name: 'OpenAI API',
  use: 'AI jobs on your chosen model.',
  icon: 'neurology',
  type: 'key',
  ai: true
}, {
  id: 'dfs',
  name: 'DataForSEO',
  use: 'Keyword volumes and SERP data by country',
  icon: 'database',
  type: 'key'
}, {
  id: 'serpapi',
  name: 'SerpApi',
  icon: 'search',
  use: 'Search results by country and language',
  type: 'key',
}, {
  id: 'searchapi',
  name: 'SearchAPI.io',
  icon: 'search',
  use: 'Search results by country and language',
  type: 'key',
}, {
  id: 'cf',
  name: 'Cloudflare',
  use: 'DNS, SSL and deploys',
  icon: 'cloud',
  type: 'key'
}, {
  id: 'probe',
  name: 'Multi-country probes',
  use: 'Checks domain access from the target country',
  icon: 'travel_explore',
  type: 'key'
}, {
  id: 'slack',
  name: 'Slack',
  use: 'Sends alerts to a channel',
  icon: 'forum',
  type: 'key'
}, {
  id: 'tg',
  name: 'Telegram',
  use: 'Sends alerts to a chat',
  icon: 'send',
  type: 'key'
}, {
  id: 'email',
  name: 'Email (SMTP)',
  use: 'Sends the weekly report and email alerts',
  icon: 'mail',
  type: 'key'
}, {
  id: 'google',
  name: 'Google sign-in',
  use: 'Connects your Google services',
  icon: 'key',
  type: 'key'
}, {
  id: 'ads', name: 'Google Ads', use: 'Monthly keyword searches by country and language', icon: 'query_stats', type: 'oauth'
}, {
  id: 'gsc',
  name: 'Google Search Console',
  use: 'Clicks, impressions, positions and rank data',
  icon: 'query_stats',
  type: 'oauth'
}, {
  id: 'ga4',
  name: 'Google Analytics 4',
  use: 'Users and sessions',
  icon: 'analytics',
  type: 'oauth'
}];
const settings: Omit<Settings, 'twofa' | 'repTo' | 'repOn'> = {
  budget: 25,
  parallel: 24,
  apPublish: true,
  apDeploy: true,
  native: true,
  timeout: 'h8',
  quiet: 'none',
  repFreq: 'Every Monday 08:00'
};
const np: NotifyPrefs = {
  approval: [true, true, false, false],
  error: [true, false, true, false],
  blocked: [true, true, true, false],
  budget: [true, true, false, false],
  review: [true, false, false, false],
  report: [true, true, false, false]
};
const mod: Record<ModId, Omit<ModTable, 'rows'>> = {
  research: {
    d: 'The Research agent maps competitors and content patterns in each country\'s search results.',
    cols: ['Research topic', 'Source', 'Finding', 'Status']
  },
  keywords: {
    d: 'The Keyword agent clusters keywords per country. Volumes come from a keyword data API, not from the AI model.',
    cols: ['Keyword', 'Meaning', 'Volume/mo', 'KD', 'Intent', 'Cluster'],
    num: [2, 3]
  },
  architecture: {
    d: 'The Architect agent plans silos and pillar pages for each site.',
    cols: ['Silo', 'Pillar page', 'Pages', 'Click depth', 'Status'],
    num: [2, 3]
  },
  content: {
    d: 'The Content Writer drafts, then each article goes through native-speaker review before it publishes.',
    cols: ['Title', 'Language', 'Words', 'Stage', 'Reviewer'],
    num: [2]
  },
  seo: {
    d: 'The SEO/GEO Optimizer checks on-page quality and how each page appears in search.',
    cols: ['Page', 'Check', 'Result', 'Next step']
  },
  aio: {
    d: 'Tracks which queries show an AI Overview and whether the site is cited. Google states no special optimization is needed beyond normal SEO.',
    cols: ['Query', 'AI Overview shown', 'Site cited', 'Next step']
  },
  cta: {
    d: 'The CTA router picks a call to action based on page intent and the local offer.',
    cols: ['Page intent', 'CTA', 'CTR', 'Status'],
    num: [2]
  },
  factory: {
    d: 'The Website factory runs the same flow for every new site.',
    cols: ['Current stage', 'Template', 'Pages built', 'Progress'],
    num: [2, 3]
  },
  themes: {
    d: 'Every site is built with the default Material Design 3 skill. Each theme stays distinct: source color, fonts and shape come from the site profile.',
    cols: ['Theme', 'Font', 'Script support', 'Status']
  },
  experiments: {
    d: 'Agents propose hypotheses and variants. Results are measured from data, not guessed by the model.',
    cols: ['Experiment', 'Variants', 'Metric', 'Result', 'Status']
  },
  gsc: {
    d: 'Search Console data for the last 28 days, one property per site.',
    cols: ['Clicks', 'Impressions', 'CTR', 'Average position'],
    num: [0, 1, 2, 3]
  },
  ga4: {
    d: 'GA4 data for the last 28 days, one property per site.',
    cols: ['Users', 'Sessions', 'Engagement', 'Conversions'],
    num: [0, 1, 2, 3]
  },
  rank: {
    d: 'Positions come from Search Console for each site\'s target country. Automated rank scraping of Google is against its spam policies.',
    cols: ['Keyword', 'Country', 'Position', '7-day change'],
    num: [2]
  }
};
const tables = {} as Record<ModId, ModTable>;
for (const id of Object.keys(mod) as ModId[]) tables[id] = {...mod[id], rows:[]};
return {skills, agents:baseAgents.map((a,i)=>({...a,hue:i%11})), ints:ints.map(n=>({...n,tail:null,st:null})), settings:{...settings,twofa:false,repTo:'',repOn:false}, np, mod:tables};
}
