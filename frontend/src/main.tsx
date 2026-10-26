import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

try {
  if (localStorage.getItem('shipscope-theme') === 'light') {
    document.documentElement.dataset.theme = 'light'
  }
} catch {
  /* storage unavailable — stay on the dark default */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
