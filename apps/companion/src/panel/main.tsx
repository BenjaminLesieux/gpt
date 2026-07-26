import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelApp } from './PanelApp';
import '@/lib/i18n';
import '../styles/app.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found in index.html');

createRoot(rootElement).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
);
