import { usePlayerStore } from '../store/playerStore'

interface HomeProps {
  onOpenChapters: () => void
  onOpenDaily: () => void
  onOpenMissions: () => void
  onOpenAchievements: () => void
  onOpenSettings: () => void
}

/** Short label for the home screen's top-left profile chip — Settings.tsx's
 * AUTH_LABEL is a full sentence meant for a settings row, too long here. */
const AUTH_SHORT_LABEL: Record<string, string> = {
  disabled: '本機玩家',
  'signed-out': '登入中…',
  anonymous: '訪客玩家',
  google: 'Google 玩家',
}

export default function Home({ onOpenChapters, onOpenDaily, onOpenMissions, onOpenAchievements, onOpenSettings }: HomeProps) {
  const coins = usePlayerStore((s) => s.coins)
  const authStatus = usePlayerStore((s) => s.authStatus)
  const displayName = usePlayerStore((s) => s.displayName)
  const profileName = displayName || AUTH_SHORT_LABEL[authStatus] || authStatus

  return (
    <div className="home-screen">
      <div className="home-header">
        <button type="button" className="home-profile" onClick={onOpenSettings} aria-label={`帳號：${profileName}，前往設定`}>
          <span className="home-profile-name">{profileName}</span>
          <span className="home-profile-coins">🪙 {coins}</span>
        </button>
        <button type="button" className="home-settings-button" onClick={onOpenSettings} aria-label="設定">
          ⚙
        </button>
      </div>
      <div className="home-main">
        <div className="home-book">
          <div className="home-book-cover" onClick={onOpenChapters} role="button" tabIndex={0}>
            <span className="home-title">文字接龍</span>
            <span className="home-subtitle">Word Solitaire</span>
            <span className="home-book-icon">📖</span>
          </div>
        </div>
        <button type="button" className="home-primary" onClick={onOpenChapters}>
          繼續閱讀
        </button>
        <div className="home-menu">
          <button type="button" onClick={onOpenDaily}>
            每日挑戰
          </button>
          <button type="button" onClick={onOpenMissions}>
            任務
          </button>
          <button type="button" onClick={onOpenAchievements}>
            成就
          </button>
        </div>
      </div>
    </div>
  )
}
