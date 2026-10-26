// Mancermundo entry. `?lab` opens the lab viewer (src/client/lab); everything else is the game (src/client/App): the quick-setup
// screen, then the battle. The three.js chunks load lazily behind a plain loading screen.
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

const wantsLab = new URLSearchParams(location.search).has('lab')
const Lab = lazy(() => import('./client/lab/Lab').then((m) => ({ default: m.Lab })))
const App = lazy(() => import('./client/App').then((m) => ({ default: m.App })))

function Loading() {
  return (
    <main style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#d8d6cf', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: 0, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Mancermundo</h1>
      <p style={{ margin: 0, opacity: 0.6, fontSize: '0.9rem' }}>Loading...</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<Loading />}>{wantsLab ? <Lab /> : <App />}</Suspense>
  </StrictMode>,
)
