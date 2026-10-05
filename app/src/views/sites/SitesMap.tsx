import type { CSSProperties } from 'react';
import { Button, Empty, Info, Pill } from '@/components';
import { ACC, mapData, type CountryStat } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { nSites } from './filter';
import { GEO, MK, landDots } from './geo';

type MarkerStyle = CSSProperties & { '--s': string };

/** Marker position in percent of the map box, and its size from the number of sites (the prototype's mapHTML()). */
function markerStyle(c: CountryStat, g: readonly [number, number]): MarkerStyle {
  return { left: ((g[0] + 180) / 3.6).toFixed(2) + '%', top: ((80 - g[1]) / 1.4).toFixed(2) + '%', '--s': Math.round(11 + Math.sqrt(c.n) * 2.4) + 'px' };
}

/** What is wrong in a country, in the words of the access pill: a block by local networks, or domains that do not answer. */
export const countryLabel = (c: CountryStat): string => c.k !== 'bad' ? MK[c.k] : c.blocked ? ACC.blocked[1] : ACC.down[1];
/** " · 1 blocked by ISP", " · 2 not reachable", " · 1 in setup" or nothing: the worst thing about a country's sites. */
const worst = (c: CountryStat): string =>
  c.blocked ? ` · ${c.blocked} blocked` : c.down ? ` · ${c.down} not reachable` : c.setup ? ` · ${c.setup} in setup` : '';

/** The prototype's mapHTML(): dotted world map with one marker per country, the detail card and the country list. */
export function SitesMap() {
  const [sites, siteFilter, mapSel] = useStoreShallow(s => [s.sites, s.siteFilter, s.mapSel] as const);
  const select = useStore(s => s.selectMapCountry);
  const data = mapData({ sites, siteFilter });
  if (!data.length) return <Empty icon="public">{sites.length ? 'No sites to show on the map.' : 'There are no sites yet. Add a domain and its country appears on the map.'}</Empty>;
  const sel = data.find(c => c.cc === mapSel) ?? data[0];
  return (
    <section className="mapsec">
      <div className="mapgrid">
        <div className="map">
          <div className="mapin">
            <svg viewBox="0 0 720 280" aria-hidden="true"><path d={landDots()} /></svg>
            {data.map(c => {
              const g = GEO[c.cc];
              return g ? (
                <button key={c.cc} type="button" className={'mk ' + c.k} aria-pressed={c.cc === sel.cc} aria-label={`${c.name}: ${nSites(c.n)}, ${c.blocked} blocked${c.down ? `, ${c.down} not reachable` : ''}`}
                  style={markerStyle(c, g)} onClick={() => select(c.cc)}><span>{c.cc}</span></button>
              ) : null;
            })}
          </div>
          <div className="lg">{(Object.keys(MK) as CountryStat['k'][]).map(k => <span key={k}><i className={k}></i>{MK[k]}</span>)}</div>
        </div>
        <CountryCard c={sel} />
      </div>
      <div className="clist">
        {data.map(c => (
          <button key={c.cc} type="button" className="crow" aria-pressed={c.cc === sel.cc} onClick={() => select(c.cc)}>
            <span className="cc sm" aria-hidden="true">{c.cc}</span>
            <div><b>{c.name}</b><span>{nSites(c.n)}{worst(c)}</span></div>
            <i className={c.k} title={countryLabel(c)}></i>
          </button>
        ))}
      </div>
      <Info label="How to read the map"><p>Dot size shows how many sites a country has. The colour is the worst state among them, so one domain that is blocked or cannot be reached turns the country red. The map outline is a rough sketch, not survey data.</p></Info>
    </section>
  );
}

/** The detail panel beside the map for the selected country. */
function CountryCard({ c }: { c: CountryStat }) {
  const showInList = useStore(s => s.showCountryInList);
  return (
    <article className="card mapd">
      <header>
        <span className="cc" aria-hidden="true">{c.cc}</span>
        <div className="who"><h3>{c.name}</h3><p>{nSites(c.n)} · {c.lang}</p></div>
        <Pill kind={c.k}>{countryLabel(c)}</Pill>
      </header>
      <dl><dt>Live</dt><dd>{c.live}</dd><dt>Being set up</dt><dd>{c.setup}</dd><dt>Paused</dt><dd>{c.paused}</dd><dt>{ACC.blocked[1]}</dt><dd>{c.blocked}</dd>{c.down ? <><dt>{ACC.down[1]}</dt><dd>{c.down}</dd></> : null}</dl>
      {c.bad.length ? (
        <div>
          <p className="note">Cannot be opened from {c.name}:</p>
          <ul>{c.bad.slice(0, 4).map(d => <li key={d}>{d}</li>)}{c.bad.length > 4 ? <li>and {c.bad.length - 4} more</li> : null}</ul>
        </div>
      ) : null}
      <footer><Button variant="tonal" icon="list" onClick={() => showInList(c.cc)}>Show these sites in the list</Button></footer>
    </article>
  );
}
