import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

// Drive CSS traffic-light inset / drag regions (macOS hiddenInset titlebar).
const platform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'darwin'
    : typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
      ? 'win32'
      : 'other'
document.documentElement.dataset.platform = platform

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
