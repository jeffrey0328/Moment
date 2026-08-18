import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initializeNativeOAuth } from './lib/native'
import './styles.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

void initializeNativeOAuth()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
