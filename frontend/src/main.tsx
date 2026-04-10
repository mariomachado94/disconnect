import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { unlockAudio } from './lib/sound'

// Unlock AudioContext on first user gesture so Safari allows programmatic audio playback.
// Safari requires AudioContext creation/resume to happen within a gesture event handler.
const unlockOnce = () => {
  unlockAudio()
  document.removeEventListener('click', unlockOnce)
  document.removeEventListener('keydown', unlockOnce)
}
document.addEventListener('click', unlockOnce)
document.addEventListener('keydown', unlockOnce)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
