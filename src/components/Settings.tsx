import { useState } from 'react'
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

/** Translated messages for the Firebase Auth error codes linkGoogle() can surface.
 * Undefined code (e.g. a plain popup-closed) falls back to a generic message. */
const AUTH_LINK_ERROR_LABEL: Record<string, string> = {
  'auth/popup-closed-by-user': '已取消綁定',
  'auth/credential-already-in-use': '此 Google 帳號已綁定其他進度，請改用該帳號登入，或聯絡我們合併進度',
  'auth/unauthorized-domain': '目前網域尚未授權登入，請稍後再試或回報此問題',
  'auth/network-request-failed': '網路連線失敗，請檢查網路後再試一次',
}

export default function Settings({ onBack }: SettingsProps) {
  const settings = usePlayerStore((s) => s.settings)
  const toggleSound = usePlayerStore((s) => s.toggleSound)
  const toggleAnimations = usePlayerStore((s) => s.toggleAnimations)
  const setTutorialSeen = usePlayerStore((s) => s.setTutorialSeen)
  const authStatus = usePlayerStore((s) => s.authStatus)
  const linkGoogle = usePlayerStore((s) => s.linkGoogle)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const handleLinkGoogle = async () => {
    setLinking(true)
    setLinkError(null)
    const result = await linkGoogle()
    setLinking(false)
    if (!result.ok) {
      setLinkError((result.code && AUTH_LINK_ERROR_LABEL[result.code]) ?? '綁定失敗，請再試一次')
    }
  }

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
          <span>新手教學</span>
          <button
            type="button"
            className="settings-toggle"
            onClick={() => setTutorialSeen(false)}
            disabled={!settings.tutorialSeen}
          >
            {settings.tutorialSeen ? '重看' : '下次進關卡顯示'}
          </button>
        </li>
        <li className="settings-row">
          <span>帳號狀態</span>
          <span className="settings-value">{AUTH_LABEL[authStatus] ?? authStatus}</span>
        </li>
        {authStatus === 'anonymous' && (
          <li className="settings-row">
            <span>
              綁定 Google 帳號可跨裝置保留進度
              {linkError && <span className="settings-error"> · {linkError}</span>}
            </span>
            <button type="button" className="settings-toggle" onClick={handleLinkGoogle} disabled={linking}>
              {linking ? '綁定中…' : '綁定'}
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
