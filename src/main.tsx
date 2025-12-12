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
  const swUrl = `${import.meta.env.BASE_URL}service-worker.js`

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.info('[PWA] Service worker ready:', registration.scope)
      })
      .catch((error) => {
        console.error('[PWA] Service worker registration failed', error)
      })
  })
}
