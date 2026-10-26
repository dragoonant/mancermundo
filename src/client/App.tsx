// App shell: routes between the start screen, the gang picker, the briefing and the battle from the session store; ?test=1 skips the
// menus and starts a battle with the default gangs. The lab viewer (?lab) is routed by src/main.tsx. The end screen is part of the battle.
import { lazy, Suspense, useEffect } from 'react'
import { loadBodyManifest } from './figures/bodyManifest'
import { currentParams } from './params'
import { installTestHooks } from './store/testHooks'
import { startFromParams, useSession } from './store/session'
import { Briefing } from './ui/Briefing'
import { GangPicker } from './ui/GangPicker'
import { StartScreen } from './ui/StartScreen'
import { TouchStyle } from './ui/widgets'

// The 3D scene (three.js, react-three-fiber, drei) loads on demand so the start screen is light.
const loadBattle = () => import('./ui/BattleScreen')
const BattleScreen = lazy(() => loadBattle().then((m) => ({ default: m.BattleScreen })))

function Loading() {
  return (
    <div data-testid="loading" style={{ position: 'fixed', inset: 0, background: '#0a0a10', color: '#9aa0b8', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
      Loading...
    </div>
  )
}

/** After the start screen has painted, fetch the battle chunk in the background so Start is instant. */
function preloadBattleWhenIdle(): void {
  const run = () => void loadBattle()
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
installTestHooks()

let autoStarted = false

export function App() {
  const screen = useSession((s) => s.screen)
  const params = currentParams()
  useEffect(() => {
    void loadBodyManifest()
    if (!params.test) preloadBattleWhenIdle()
    else if (!autoStarted) {
      autoStarted = true
      startFromParams(params)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <TouchStyle />
      {screen === 'battle' ? (
        <Suspense fallback={<Loading />}>
          <BattleScreen />
        </Suspense>
      ) : screen === 'gangs' ? (
        <GangPicker />
      ) : screen === 'briefing' ? (
        <Briefing />
      ) : (
        <StartScreen />
      )}
    </>
  )
}
