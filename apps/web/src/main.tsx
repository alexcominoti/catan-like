import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { I18nProvider } from './i18n/index.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root nao encontrado');
createRoot(root).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
