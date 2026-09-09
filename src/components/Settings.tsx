import { usePlayerStore } from '../store/playerStore'

interface SettingsProps {
  onBack: () => void
}

const AUTH_LABEL: Record<string, string> = {
  disabled: '未啟用雲端同步（本機儲存）',
  'signed-out': '登入中…',
  anonymous: '訪客帳號（尚未綁定）',
  google: '已綁定 Google 帳號',
}

export default function Settings({ onBack }: SettingsProps) {
  const settings = usePlayerStore((s) => s.settings)
  const toggleSound = usePlayerStore((s) => s.toggleSound)
  const toggleAnimations = usePlayerStore((s) => s.toggleAnimations)
  const authStatus = usePlayerStore((s) => s.authStatus)
  const linkGoogle = usePlayerStore((s) => s.linkGoogle)

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>設定</h1>
      </div>
      <ul className="settings-list">
        <li className="settings-row">
          <span>音效</span>
          <button type="button" className="settings-toggle" onClick={toggleSound}>
            {settings.soundOn ? '開' : '關'}
          </button>
        </li>
        <li className="settings-row">
          <span>動畫</span>
          <button type="button" className="settings-toggle" onClick={toggleAnimations}>
            {settings.animationsOn ? '開' : '關'}
          </button>
        </li>
        <li className="settings-row">
          <span>帳號狀態</span>
          <span className="settings-value">{AUTH_LABEL[authStatus] ?? authStatus}</span>
        </li>
        {authStatus === 'anonymous' && (
          <li className="settings-row">
            <span>綁定 Google 帳號可跨裝置保留進度</span>
            <button type="button" className="settings-toggle" onClick={() => linkGoogle()}>
              綁定
            </button>
          </li>
        )}
      </ul>
      <p className="daily-note">
        將此頁加入主畫面即可安裝為獨立 App（PWA）。若瀏覽器支援，位址列會出現安裝按鈕。
      </p>
    </div>
  )
}
