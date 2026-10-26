// Mancermundo entry. Until the game screens return (S5a) the page is the 3D lab viewer (src/client/lab): a Zone Mortalis board
// with two starter gangs deployed. The three.js chunks load lazily behind a plain start screen.
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

const Lab = lazy(() => import('./client/lab/Lab').then((m) => ({ default: m.Lab })))

function Loading() {
  return (
    <main style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#d8d6cf', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: 0, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Mancermundo</h1>
      <p style={{ margin: 0, opacity: 0.6, fontSize: '0.9rem' }}>Loading the lab...</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<Loading />}>
      <Lab />
    </Suspense>
  </StrictMode>,
)
