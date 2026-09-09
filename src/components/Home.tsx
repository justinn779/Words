interface HomeProps {
  onOpenChapters: () => void
  onOpenDaily: () => void
  onOpenLibrary: () => void
  onOpenMissions: () => void
  onOpenAchievements: () => void
  onOpenSettings: () => void
}

export default function Home({ onOpenChapters, onOpenDaily, onOpenLibrary, onOpenMissions, onOpenAchievements, onOpenSettings }: HomeProps) {
  return (
    <div className="home-screen">
      <button type="button" className="home-settings-button" onClick={onOpenSettings} aria-label="設定">
        ⚙
      </button>
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
        <button type="button" onClick={onOpenLibrary}>
          我的圖書館
        </button>
        <button type="button" onClick={onOpenMissions}>
          任務
        </button>
        <button type="button" onClick={onOpenAchievements}>
          成就
        </button>
      </div>
    </div>
  )
}
