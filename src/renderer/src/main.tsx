import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/tokens.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GamesProvider } from './context/GamesContext'
import { GuideProvider } from './context/GuideContext'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GamesProvider>
        <GuideProvider>
          <App />
        </GuideProvider>
      </GamesProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
