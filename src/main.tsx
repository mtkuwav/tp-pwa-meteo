import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  const swUrl = new URL('./service-worker.js', import.meta.url)

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, { type: 'module' })
      .then((registration) => {
        console.info('[PWA] Service worker ready:', registration.scope)
      })
      .catch((error) => {
        console.error('[PWA] Service worker registration failed', error)
      })
  })
}
