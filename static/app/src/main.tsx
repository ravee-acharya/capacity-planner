import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DEMO } from './bridge';
import './styles.css';

if (!DEMO) {
  // Follow the Jira light/dark theme via design tokens.
  import('@forge/bridge')
    .then(({ view }) => view.theme.enable())
    .catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
