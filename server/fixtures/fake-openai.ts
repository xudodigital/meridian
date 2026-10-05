import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const KEYWORDS = {
  summary: 'Two ideas.',
  keywords: [
    { keyword: 'cara membuat cold brew', meaning: 'how to make cold brew', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' },
    { keyword: 'rasio cold brew', meaning: 'cold brew ratio', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' },
  ],
  notes: 'No volumes.',
};
const ARTICLE = {
  title: 'Cara Membuat Cold Brew di Rumah', titleEn: 'How to make cold brew at home',
  titleTag: 'Cara Membuat Cold Brew di Rumah | Kopi', metaDescription: 'Rasio, lama rendam dan cara menyimpan cold brew.',
  slug: 'Cara Membuat Cold Brew!',
  byline: { text: 'Tim redaksi kopi.example', en: 'kopi.example editorial team' },
  disclosure: { text: 'Disusun dengan bantuan AI dari sumber di bawah dan ditinjau manusia sebelum terbit.', en: 'Drafted with AI help from the sources below and reviewed by a person before publishing.' },
  blocks: [
    { type: 'p', text: 'Cold brew dibuat dengan merendam kopi dalam air dingin.', en: 'Cold brew is made by steeping coffee in cold water.' },
    { type: 'h2', text: 'Takaran', en: 'Ratio' },
    { type: 'list', items: [{ text: 'Kopi giling kasar', en: 'Coarse ground coffee' }, { text: 'Air', en: 'Water' }] },
    { type: 'table', rows: [[{ text: 'Rasio', en: 'Ratio' }], [{ text: '1:8', en: '1:8' }]] },
  ],
  sources: [
    { title: 'AEKI: Cold Brew', url: 'https://www.aeki-aice.org/cold-brew/' },
    { title: 'Not a page', url: 'javascript:alert(1)' },
  ],
  reviewerNotes: ['Check the 1:8 ratio at AEKI.'],
};

export async function startFakeOpenAI(dir: string, loggedOut = false) {
  const read = (name: string) => existsSync(join(dir,name)) ? readFileSync(join(dir,name),'utf8') : null;
  const server = createServer(async (req,res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)); };
    if (loggedOut || read('logged-out') !== null) { send(401,{error:{message:'Invalid OpenAI API key.'}}); return; }
    if (req.url === '/v1/models') { send(200,{data:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(id=>({id}))}); return; }
    if (req.url !== '/v1/responses' || req.method !== 'POST') { send(404,{}); return; }
    let raw=''; for await (const chunk of req) raw+=chunk;
    const body=JSON.parse(raw), prompt=body.input[0].content.filter((c: {type:string})=>c.type==='input_text').map((c:{text:string})=>c.text).join('\n'), start=Date.now();
    const task=prompt.match(/^Meridian task: ([a-z0-9-]+)\s*$/m)?.[1] ?? null;
    const keyword=!task && prompt.includes('You are the Keyword agent');
    const kind=task ?? (keyword?'keyword':'article');
    const call={kind, body, model:body.model, prompt, start, end:Date.now()};
    appendFileSync(join(dir,'calls.jsonl'), JSON.stringify(call)+'\n');
    if (read('hang') !== null) return;
    const delay=Number(read('delay') || 0);
    if (delay) { await new Promise<void>(resolve=>{const timer=setTimeout(resolve,delay);res.once('close',()=>{clearTimeout(timer);resolve();});}); if(res.destroyed)return; }
    const fixture=(name:string)=> {const f=new URL('./fake-answers/'+name+'.json',import.meta.url);return existsSync(f)?readFileSync(f,'utf8'):null;};
    const echo=Number(read('echo') || 0);
    const text=echo ? 'こんにちは、世界。ภาษาไทย 🙂\n'.repeat(echo) : task ? (read(task+'.txt') ?? fixture(task) ?? '{}') : keyword ? JSON.stringify(KEYWORDS) : read('article.txt') ?? JSON.stringify(ARTICLE);
    const rates: Record<string,[number,number]>={'gpt-6-luna':[.1,.5], 'gpt-6.1-sol':[2,10], 'gpt-6-astra':[10,50]};
    const rate=rates[body.model] || rates['gpt-6.1-sol'];
    const cost=read('cost') ?? read('base-cost'), output=500;
    let input=cost === null ? 1000 : Math.round((Number(cost)*1000000-output*rate[1])/rate[0]);
    if (input>272000) input=Math.round((Number(cost)*1000000-output*rate[1]*1.5)/(rate[0]*2));
    const failure=read('error');
    const override=read('response.json');
    if(override!==null) {send(Number(read('http-status')||200),JSON.parse(override));return;}
    send(200,{id:'resp_test', model:body.model, status:failure?'failed':'completed', error:failure?{message:failure}:null, usage:{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:0}}, output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const addr=server.address();
  return { url:`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, close:()=>{server.closeAllConnections();server.close();} };
}
