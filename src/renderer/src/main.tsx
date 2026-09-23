import './styles/tokens.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GamesProvider } from './context/GamesContext'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GamesProvider>
        <App />
      </GamesProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
