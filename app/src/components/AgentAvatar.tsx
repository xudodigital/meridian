import { useId, type CSSProperties } from 'react';
import { avatarBehavior, type AvatarAgent } from './agent-behavior';
import './agent-avatar.css';

/** Small, distinct role emblems; names and state remain in the surrounding accessible text. */
const EMBLEMS: Record<string, string[]> = {
  orc: ['M12 4v5m0 6v5M4 12h5m6 0h5', 'M9 9h6v6H9z'],
  res: ['M15.5 15.5 21 21', 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'],
  kw: ['M10 14a6 6 0 1 1 0-8 6 6 0 0 1 0 8', 'M13 11h8m-3 0v4m3-4v3'],
  arc: ['M4 20V7l8-4 8 4v13M8 20v-7h8v7M8 8h.1m8 0h.1'],
  wr: ['M4 20 5 14 16 3l5 5-11 11-6 1Z', 'm13 6 5 5'],
  seo: ['M5 19V9m7 10V5m7 14v-6', 'm4 5 4-2 4 2 7-3'],
  lnk: ['m10 8 2-2a5 5 0 0 1 7 7l-2 2', 'm14 16-2 2a5 5 0 0 1-7-7l2-2', 'm8 16 8-8'],
  bld: ['m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16'],
  dep: ['M12 3v12m-5-5 5 5 5-5', 'M4 16v5h16v-5'],
  ana: ['M3 20h18M5 16l5-6 4 3 6-9'],
  gd: ['M5 3h10l4 4v14H5Z', 'm7 17 4-6 3 4 2-2 2 4', 'M14 3v5h5'],
};

/** Vector artwork shared by Office, cards and agent details. No remote asset or furniture. */
export function AgentAvatar({ a, state = 'idle', portrait = false }: { a: AvatarAgent; state?: string; portrait?: boolean }) {
  const id = 'agent-' + useId().replace(/:/g, '');
  const behavior = avatarBehavior(a, state);
  const bad = state === 'err' || state === 'failed';
  const sleepy = state === 'off' || state === 'planned';
  const resting = behavior === 'break', dizzy = behavior === 'dizzy';
  return <svg className={'agent-avatar h' + a.hue} data-state={state} data-behavior={behavior} data-agent={a.id} data-portrait={portrait || undefined}
    style={{ '--avatar-phase': -(a.hue % 11) * .4 } as CSSProperties}
    viewBox={portrait ? '44 22 112 98' : '0 0 200 180'} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={id + '-shell'} x1="0" y1="0" x2="0.7" y2="1">
        <stop className="avatar-light" offset="0" /><stop className="avatar-tone" offset="1" />
      </linearGradient>
      <linearGradient id={id + '-suit'} x1="0" y1="0" x2="1" y2="1">
        <stop className="avatar-suit-light" offset="0" /><stop className="avatar-suit-tone" offset="1" />
      </linearGradient>
    </defs>
    {!portrait ? <><circle className="avatar-halo" cx="100" cy="90" r="72" /><ellipse className="avatar-shadow" cx="100" cy="168" rx="46" ry="5" /></> : null}
    <g className="avatar-character">
      {!portrait ? <>
        <path className="avatar-arm-rest" d={state === 'wait' || resting ? 'M71 121Q55 130 58 148' : 'M71 121Q55 130 58 148M129 121Q145 130 142 148'} />
        <path className="avatar-suit" d="M100 107c-22 0-35 13-35 35v12c0 5 4 8 9 8h52c5 0 9-3 9-8v-12c0-22-13-35-35-35Z" fill={`url(#${id}-suit)`} />
        <path className="avatar-seam" d="M76 151h48M84 115q16 9 32 0" />
        <circle className="avatar-role-disc" cx="100" cy="137" r="17" />
        <g className="avatar-role" transform="translate(88 125)">{(EMBLEMS[a.id] ?? EMBLEMS.orc)!.map((d, i) => <path key={i} d={d} />)}</g>
        {state === 'wait' ? <g className="avatar-wave"><path className="avatar-arm" d="M130 127Q156 115 152 83" /><rect className="avatar-hand" x="144" y="68" width="16" height="24" rx="8" /><path className="avatar-fingers" d="M149 71v8m6-8v8" /></g> : null}
      </> : null}
      <g className="headg">
        <path className="avatar-antenna" d="M100 31v-9" /><circle className="avatar-signal" cx="100" cy="19" r="4" />
        <rect className="avatar-ear" x="50" y="59" width="13" height="26" rx="6" /><rect className="avatar-ear" x="137" y="59" width="13" height="26" rx="6" />
        <rect className="avatar-shell" x="58" y="31" width="84" height="78" rx="30" fill={`url(#${id}-shell)`} />
        <path className="avatar-shine" d="M72 53q3-11 17-12h16" />
        <rect className="avatar-visor" x="67" y="55" width="66" height="43" rx="18" />
        <g className="avatar-eyes">{dizzy ? <>
          {[85, 115].map(x => <g className="avatar-spiral" key={x} transform={`translate(${x} 72)`}><path d="M0 0c-3-3-6 1-3 4s9 1 8-4-9-8-12-3-1 12 5 13" /></g>)}
        </> : sleepy ? <path className="avatar-eye-closed" d="M78 72q7 5 14 0m16 0q7 5 14 0" /> : <>
          <rect className="avatar-eye-light" x="78" y="64" width="14" height={bad ? 10 : 16} rx="7" /><rect className="avatar-eye-light" x="108" y="64" width="14" height={bad ? 10 : 16} rx="7" />
          <g className="avatar-gaze"><circle className="avatar-pupil" cx="86" cy="71" r="3" /><circle className="avatar-pupil" cx="114" cy="71" r="3" />
          <circle className="avatar-eye-glint" cx="87" cy="69" r="1.3" /><circle className="avatar-eye-glint" cx="115" cy="69" r="1.3" /></g>
        </>}</g>
        <path className="avatar-mouth" d={dizzy ? 'm93 86 4-2 4 4 5-2' : bad ? 'M94 89q6-6 12 0' : 'M94 85q6 6 12 0'} />
        <path className="avatar-cheek" d="M75 85h5m40 0h5" />
        <path className="avatar-panel" d="M91 103h18" />
      </g>
      {resting && !portrait ? <>
        <g className="avatar-coffee"><path className="avatar-arm" d="M130 127Q142 112 125 102" /><circle className="avatar-hand" cx="125" cy="105" r="7" />
          <g className="avatar-cup"><path className="avatar-cup-handle" d="M136 90h4c10 0 10 13 0 13h-4" /><path className="avatar-cup-body" d="M112 86h25v16q0 7-7 7h-11q-7 0-7-7Z" /><ellipse className="avatar-coffee-top" cx="124.5" cy="86" rx="12.5" ry="3" />
          <path className="avatar-steam" d="M119 78q-4-4 0-8m9 8q-4-4 0-8" /></g>
        </g>
        <g className="avatar-thought"><circle cx="139" cy="45" r="3" /><circle cx="147" cy="36" r="4" /><path d="M151 18c-4-10 9-16 15-10 8-7 19 1 16 8 11 7 2 17-8 14-8 6-24 0-23-12Z" /><path className="avatar-thought-dots" d="M158 20h.01m8 0h.01m8 0h.01" /></g>
      </> : null}
    </g>
    {dizzy && !portrait ? <g className="avatar-dizzy-stars"><ellipse className="avatar-orbit" cx="100" cy="19" rx="34" ry="10" /><g className="avatar-stars"><path d="m68 12 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /><path d="m130 9 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" /></g></g> : null}
    {bad ? <g className="avatar-state-mark alert"><circle cx="143" cy="39" r="12" /><path d="M143 32v8m0 5h.01" /></g> : state === 'done' ? <g className="avatar-state-mark okmark"><circle cx="143" cy="39" r="12" /><path d="m137 39 4 4 8-8" /></g> : null}
  </svg>;
}
