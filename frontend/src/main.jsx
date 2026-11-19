import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installRentalApiBlock } from './utils/rentalApi'

// External rentals API removed: answer any leftover rental calls locally (no network).
installRentalApiBlock()

// Phones: list tables become cards; entry/report tables scroll with a frozen first column.
import { installMobileTables } from "./utils/mobileTables"
installMobileTables()
import { BrowserRouter } from 'react-router-dom'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />

    </BrowserRouter>
  </StrictMode>,
)
