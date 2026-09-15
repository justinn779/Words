import { useEffect, useState } from 'react'
import Home from './components/Home'
import ChapterList from './components/ChapterList'
import LevelList from './components/LevelList'
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
  | { name: 'chapters' }
  | { name: 'levels'; chapterId: string }
  | { name: 'daily' }
  | { name: 'missions' }
  | { name: 'achievements' }
  | { name: 'settings' }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const game = useGameStore((s) => s.game)
  const levelConfig = useGameStore((s) => s.levelConfig)
  const dailyDate = useGameStore((s) => s.dailyDate)
  const initCloud = usePlayerStore((s) => s.initCloud)
  const loadAiChapters = useContentStore((s) => s.loadAiChapters)
  const animationsOn = usePlayerStore((s) => s.settings.animationsOn)

  useEffect(() => {
    initCloud()
    // Background top-up only — Daily Challenge works with zero AI content, this
    // just lets it use some once it's loaded (see src/firebase/aiContent.ts).
    ensureAiContentLoaded()
    // Picks up any AI-generated chapters other players already triggered (see
    // src/firebase/aiChapters.ts) so ChapterList/WinModal show them immediately
    // instead of offering to regenerate content that already exists.
    loadAiChapters()
  }, [initCloud, loadAiChapters])

  useEffect(() => {
    document.documentElement.classList.toggle('animations-off', !animationsOn)
  }, [animationsOn])

  // Keeps the 'levels' screen pointed at whichever chapter is actually being
  // played, even when WinModal jumps the player straight into a new chapter
  // (its "下一章節"/"下一關" buttons call startLevel directly, bypassing
  // setScreen) — otherwise exiting back out would land on the chapter the
  // player *entered* the board from, not the one they were just playing.
  // Daily Challenge levels don't have a real "levels" screen to return to
  // (WinModal's own "返回每日挑戰" exits straight to the daily screen).
  useEffect(() => {
    if (!levelConfig || dailyDate) return
    setScreen((prev) =>
      prev.name === 'levels' && prev.chapterId === levelConfig.chapterId
        ? prev
        : { name: 'levels', chapterId: levelConfig.chapterId },
    )
  }, [levelConfig, dailyDate])

  if (game) return <Board />

  const goHome = () => setScreen({ name: 'home' })

  switch (screen.name) {
    case 'home':
      return (
        <Home
          onOpenChapters={() => setScreen({ name: 'chapters' })}
          onOpenDaily={() => setScreen({ name: 'daily' })}
          onOpenMissions={() => setScreen({ name: 'missions' })}
          onOpenAchievements={() => setScreen({ name: 'achievements' })}
          onOpenSettings={() => setScreen({ name: 'settings' })}
        />
      )
    case 'chapters':
      return <ChapterList onBack={goHome} onOpenChapter={(chapterId) => setScreen({ name: 'levels', chapterId })} />
    case 'levels':
      return <LevelList chapterId={screen.chapterId} onBack={() => setScreen({ name: 'chapters' })} />
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
