import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Register Google Material Web (M3) custom elements
import '@material/web/button/filled-button.js'
import '@material/web/button/filled-tonal-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/button/text-button.js'
import '@material/web/button/elevated-button.js'
import '@material/web/iconbutton/icon-button.js'
import '@material/web/iconbutton/filled-icon-button.js'
import '@material/web/iconbutton/filled-tonal-icon-button.js'
import '@material/web/iconbutton/outlined-icon-button.js'
import '@material/web/chips/chip-set.js'
import '@material/web/chips/assist-chip.js'
import '@material/web/chips/filter-chip.js'
import '@material/web/chips/input-chip.js'
import '@material/web/chips/suggestion-chip.js'
import '@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js'
import '@material/web/labs/segmentedbutton/outlined-segmented-button.js'
import '@material/web/labs/badge/badge.js'
import '@material/web/ripple/ripple.js'
import '@material/web/elevation/elevation.js'
import '@material/web/progress/circular-progress.js'
import '@material/web/progress/linear-progress.js'
import '@material/web/divider/divider.js'

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
