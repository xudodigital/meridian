// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { makeState, resetStore } from '@/store/testing';
import { MotionControl } from '@/shell/MotionControl';
import { reduceMotion } from '../workspace/motion';
import { OperationScene } from './OperationScene';
let root: Root;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetStore(); useStore.setState(makeState()); localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); localStorage.clear(); });
it('opens details on request and pages them without changing the records', async () => {
  const before = useStore.getState().articles;
  await act(async () => root.render(<OperationScene kind="review" />));
  expect(document.querySelectorAll('.vs-records li')).toHaveLength(0);
  await click(document.querySelectorAll('.vs-station')[1]);
  expect(document.querySelectorAll('.vs-records li')).toHaveLength(3);
  await click(document.querySelector('[aria-label="Next records"]'));
  expect(document.querySelectorAll('.vs-records li')).toHaveLength(1);
  await click(document.querySelector('.vs-station'));
  expect(document.querySelector('.vs-inspector h3')?.textContent).toBe('In production');
  expect(document.querySelector('.vs-empty')?.textContent).toContain('No unarchived articles');
  await click(document.querySelector('.vs-toggle'));
  expect(document.querySelector('.vs-toggle')?.getAttribute('aria-expanded')).toBe('false');
  await click(document.querySelector('.vs-toggle'));
  expect(document.querySelector('.vs-toggle')?.getAttribute('aria-expanded')).toBe('true');
  expect(useStore.getState().articles).toBe(before);
});
it('pauses visual motion, including future Office handoffs, without pausing agents', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const agents = useStore.getState().agents;
  await act(async () => root.render(<MotionControl />));
  await click(document.querySelector('button'));
  expect(document.documentElement.dataset.motionPaused).toBe('true');
  expect(reduceMotion()).toBe(true);
  expect(localStorage.getItem('meridian-motion-paused')).toBe('1');
  expect(useStore.getState().agents).toBe(agents);
  await click(document.querySelector('button'));
  expect(document.documentElement.dataset.motionPaused).toBe('false');
});

it('keeps the 120-site overview bounded through every page, including live removals', async () => {
  await act(async () => root.render(<OperationScene kind="sites" />));
  expect(document.querySelectorAll('.vs-records li')).toHaveLength(0);
  await click(document.querySelector('.vs-station'));
  const seen = new Set<string>();
  for (let n = 0; n < 50; n++) {
    const rows = document.querySelectorAll('.vs-records li');
    expect(rows.length).toBeLessThanOrEqual(3);
    rows.forEach(r => seen.add(r.textContent!));
    const next = document.querySelector<HTMLButtonElement>('[aria-label="Next records"]');
    if (!next || next.disabled) break;
    await click(next);
  }
  expect(seen.size).toBe(Number(document.querySelector('.vs-count')!.textContent));
  expect(seen.size).toBeGreaterThan(90);
  await act(async () => useStore.setState(d => { d.sites = d.sites.slice(0, 1); }));
  expect(document.querySelector('.vs-pagination')?.textContent).toContain('1–1 of 1');
  await click(document.querySelector('.vs-station'));
  expect(document.querySelectorAll('.vs-records li')).toHaveLength(0);
});
