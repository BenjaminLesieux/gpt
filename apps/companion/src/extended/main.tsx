import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtendedApp } from './ExtendedApp';
import '../styles/app.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found in extended.html');

createRoot(rootElement).render(
  <StrictMode>
    <ExtendedApp />
  </StrictMode>,
);
