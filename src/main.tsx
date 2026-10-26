// Placeholder page (S1): the engine is being rebuilt for Necromunda; the real app returns with S5a.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const REPO = 'https://github.com/dragoonant/mancermundo'

function Placeholder() {
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '1.5rem',
        textAlign: 'center',
        color: '#d8d6cf',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Mancermundo</h1>
      <p style={{ margin: 0, opacity: 0.8 }}>Engine rebuild in progress.</p>
      <p style={{ margin: 0, opacity: 0.6, fontSize: '0.9rem' }}>A fan-made 3D Necromunda skirmish game. Not affiliated with Games Workshop.</p>
      <a href={REPO} style={{ color: '#e0a04a' }}>
        Source on GitHub
      </a>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
)
