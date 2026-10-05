import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { startSim } from './store/sim';
import { useStore } from './store/store';

/* Refresh server-driven progress and idle-session checks; never invent work. */
const stopSimulation = startSim(() => useStore.getState().tick(false));
import.meta.hot?.dispose(stopSimulation);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
