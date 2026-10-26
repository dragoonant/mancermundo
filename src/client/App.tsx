// App shell: routes between the start screen, team builder, briefing and battle from the session store;
// ?gallery shows the figure gallery; ?test=1 skips the menus and starts a battle with default rosters.
import { lazy, Suspense, useEffect } from 'react'
import { audio, installClickSounds, startMusicDirector } from './audio'
import { loadModelManifest } from './figures/manifest'
import { currentParams } from './params'
import { installTestHooks } from './store/testHooks'
import { startFromParams, useSession } from './store/session'
import { Briefing } from './ui/Briefing'
import { StartScreen } from './ui/StartScreen'

// The 3D scenes (three.js, react-three-fiber, drei) load on demand so the start screen is light: the battle, the
// team builder's figure preview and the gallery are separate chunks.
const loadBattle = () => import('./ui/BattleScreen')
const BattleScreen = lazy(() => loadBattle().then((m) => ({ default: m.BattleScreen })))
const loadBuilder = () => import('./ui/TeamBuilder')
const TeamBuilder = lazy(() => loadBuilder().then((m) => ({ default: m.TeamBuilder })))
const Gallery = lazy(() => import('./figures/Gallery').then((m) => ({ default: m.Gallery })))

function Loading() {
  return <div data-testid="loading" style={{ position: 'fixed', inset: 0, background: '#0a0a10', color: '#9aa0b8', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>Loading...</div>
}

/** After the start screen has painted, fetch the battle chunk in the background so Deploy is instant. */
function preloadBattleWhenIdle(): void {
  const run = () => {
    void loadBattle()
    void loadBuilder()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
installTestHooks()
audio.attachAutoUnlock()
installClickSounds()
startMusicDirector(audio)

let autoStarted = false

export function App() {
  const screen = useSession((s) => s.screen)
  const params = currentParams()
  useEffect(() => {
    void loadModelManifest()
    if (!params.test && !params.scenario && !params.gallery) preloadBattleWhenIdle()
    if ((params.test || params.scenario) && !autoStarted) {
      autoStarted = true
      startFromParams(params)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (params.gallery) return <Suspense fallback={<Loading />}><Gallery /></Suspense>
  switch (screen) {
    case 'builder':
      return <Suspense fallback={<Loading />}><TeamBuilder /></Suspense>
    case 'briefing':
      return <Briefing />
    case 'battle':
      return <Suspense fallback={<Loading />}><BattleScreen /></Suspense>
    default:
      return <StartScreen />
  }
}
