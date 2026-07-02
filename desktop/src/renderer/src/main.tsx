import React from 'react'
import ReactDOM from 'react-dom/client'

// Bundled fonts (offline — Electron CSP blocks external font CDNs).
import '@fontsource-variable/fraunces'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/hanken-grotesk/600.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'

import App from './App'
import './styles/tokens.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
