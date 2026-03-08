import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// iOS requires a touchstart listener on document for :active CSS
// and proper touch event delivery in Telegram's WKWebView
document.addEventListener('touchstart', () => {}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
