import { useEffect, useState } from 'react'
import Home from './components/Home'
import LevelGrid from './components/LevelGrid'
import DailyChallenge from './components/DailyChallenge'
import Missions from './components/Missions'
import Achievements from './components/Achievements'
import Settings from './components/Settings'
import Board from './components/Board'
import { useGameStore } from './store/gameStore'
import { usePlayerStore } from './store/playerStore'
import { ensureAiContentLoaded } from './firebase/aiContent'
import { useContentStore } from './store/contentStore'
import './App.css'

type Screen =
  | { name: 'home' }
  | { name: 'levels' }
  | { name: 'daily' }
  | { name: 'missions' }
  | { name: 'achievements' }
  | { name: 'settings' }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const game = useGameStore((s) => s.game)
  const dailyDate = useGameStore((s) => s.dailyDate)
  const initCloud = usePlayerStore((s) => s.initCloud)
  const loadLevels = useContentStore((s) => s.loadLevels)
  const animationsOn = usePlayerStore((s) => s.settings.animationsOn)

  useEffect(() => {
    initCloud()
    // Background top-up only — Daily Challenge works with zero AI content, this
    // just lets it use some once it's loaded (see src/firebase/aiContent.ts).
    ensureAiContentLoaded()
    // Picks up any generated levels other players already triggered (see
    // src/firebase/levels.ts) so LevelGrid/WinModal show them immediately
    // instead of offering to regenerate content that already exists.
    loadLevels()
  }, [initCloud, loadLevels])

  useEffect(() => {
    document.documentElement.classList.toggle('animations-off', !animationsOn)
  }, [animationsOn])

  // Jump straight to the level grid once a level finishes (WinModal's own
  // "下一關" calls startLevel directly, bypassing setScreen) — otherwise
  // exiting back out would land wherever the player was before, not the grid.
  // Daily Challenge levels exit straight to the daily screen instead (see
  // WinModal's "返回每日挑戰"), so this only applies to the regular sequence.
  useEffect(() => {
    if (!game || dailyDate) return
    setScreen((prev) => (prev.name === 'levels' ? prev : { name: 'levels' }))
  }, [game, dailyDate])

  if (game) return <Board />

  const goHome = () => setScreen({ name: 'home' })

  switch (screen.name) {
    case 'home':
      return (
        <Home
          onOpenLevels={() => setScreen({ name: 'levels' })}
          onOpenDaily={() => setScreen({ name: 'daily' })}
          onOpenMissions={() => setScreen({ name: 'missions' })}
          onOpenAchievements={() => setScreen({ name: 'achievements' })}
          onOpenSettings={() => setScreen({ name: 'settings' })}
        />
      )
    case 'levels':
      return <LevelGrid onBack={goHome} />
    case 'daily':
      return <DailyChallenge onBack={goHome} />
    case 'missions':
      return <Missions onBack={goHome} />
    case 'achievements':
      return <Achievements onBack={goHome} />
    case 'settings':
      return <Settings onBack={goHome} />
  }
}

export default App
