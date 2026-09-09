import { useState } from 'react'
import { motion } from 'framer-motion'
import { usePlayerStore } from '../store/playerStore'

interface Step {
  icon: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: '🎯',
    title: '目標',
    body: '把桌上打散的文字卡依類別整理好，全部送進「分類欄」。清空整桌就過關——沒有時間限制，也不會輸。',
  },
  {
    icon: '🧩',
    title: '疊在一起',
    body: '同一類別的文字卡可以互相堆疊：拖曳一張放到同類的卡上，或點一張再點目標。整疊同類別的卡也能一起移動。',
  },
  {
    icon: '🗂️',
    title: '分類卡與分類欄',
    body: '每個類別有一張「分類卡」。把它拖進空的分類欄就啟動該類別，接著把該類別的文字卡（或整疊）送進去。分類欄數量有限，要決定先完成哪一類來空出欄位。',
  },
  {
    icon: '💡',
    title: '卡住了？',
    body: '右上角有「復原」和「提示」。抽牌堆點一下翻牌，翻完可以重新循環。慢慢想沒關係。',
  },
]

export default function Tutorial() {
  const tutorialSeen = usePlayerStore((s) => s.settings.tutorialSeen)
  const setTutorialSeen = usePlayerStore((s) => s.setTutorialSeen)
  const animationsOn = usePlayerStore((s) => s.settings.animationsOn)
  const [step, setStep] = useState(0)

  if (tutorialSeen) return null

  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const finish = () => setTutorialSeen(true)

  return (
    <div className="modal-overlay">
      <motion.div
        className="modal tutorial-modal"
        initial={animationsOn ? { opacity: 0, scale: 0.9, y: 12 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: animationsOn ? 0.24 : 0, ease: 'easeOut' }}
      >
        <div className="tutorial-icon" aria-hidden>
          {current.icon}
        </div>
        <h2>{current.title}</h2>
        <p className="tutorial-body">{current.body}</p>

        <div className="tutorial-dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? 'tutorial-dot tutorial-dot-on' : 'tutorial-dot'} />
          ))}
        </div>

        <div className="tutorial-actions">
          {last ? (
            <button type="button" className="primary" onClick={finish}>
              開始遊戲
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => setStep((s) => s + 1)}>
              下一步
            </button>
          )}
          <div className="tutorial-sub-actions">
            {step > 0 && (
              <button type="button" onClick={() => setStep((s) => s - 1)}>
                上一步
              </button>
            )}
            {!last && (
              <button type="button" className="tutorial-skip" onClick={finish}>
                略過教學
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
