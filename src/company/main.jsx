import React from 'react';
import ReactDOM from 'react-dom/client';
import CompanyApp from './CompanyApp';
import './company.css';

// Public page: no phone gate, no shop code — only the company structure.
const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
} catch {
  // Opened outside Telegram.
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CompanyApp />
  </React.StrictMode>
);
