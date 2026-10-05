import { Button, Icon } from '@/components';
import { go } from '@/nav';
import { siteShown } from '@/store/rules';
import { useStore } from '@/store/store';
import { openJourney, type JourneyTarget } from './state';
import './journey.css';

/** Entry point to real, linked work. No new pipeline state or simulated progress. */
export function WorkJourney() {
  const s = useStore();
  const flows = Object.values(s.live.workflows).filter(w => siteShown(s,w.siteId,w.domain)).sort((a,b)=>Number(b.status==='running')-Number(a.status==='running') || b.updatedAt-a.updatedAt);
  const items: (JourneyTarget & {title:string;detail:string})[] = flows.map(w=>({kind:'workflow',id:String(w.id),title:`${w.name} · ${w.domain}`,detail:w.error || w.wait?.text || w.outcome || w.status}));
  if (!items.length) for (const a of s.articles.filter(a=>!a.archived && siteShown(s,a.s,a.live?.domain)).slice(0,4)) items.push({kind:'review',id:String(a.id),title:a.titleEn || a.title || a.kw,detail:a.status==='review' ? 'Waiting for your review' : a.status});
  if (!items.length) for (const r of s.kwReqs.filter(r=>siteShown(s,r.site,r.domain)).slice(0,4)) items.push({kind:'research',id:String(r.id),title:r.topic,detail:r.error || r.step || r.st});
  return <section className="journey-home"><div className="sh"><div><h2>Work journeys</h2><p className="note">Follow the request, its articles and the website they became.</p></div><Button variant="tonal" onClick={()=>go('workflows')}>All workflows</Button></div>
    {items.length ? <ul className="journey-cards">{items.slice(0,4).map(r=><li key={`${r.kind}:${r.id}`}><button type="button" onClick={()=>openJourney(r)}><Icon name="route"/><span><b>{r.title}</b><small>{r.detail}</small></span><Icon name="arrow_forward"/></button></li>)}</ul> : <p>No work is recorded yet. Start with a topic in Research and SEO, or run a workflow from Build and deploy.</p>}
  </section>;
}
