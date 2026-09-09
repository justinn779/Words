import { CHAPTERS } from '../data/chapters'
import { getChapterLevels, getChapterMaxStars, getChapterStars, hasContent, isChapterUnlocked } from '../data/progression'
import { usePlayerStore } from '../store/playerStore'

interface ChapterListProps {
  onBack: () => void
  onOpenChapter: (chapterId: string) => void
}

export default function ChapterList({ onBack, onOpenChapter }: ChapterListProps) {
  const levelRecords = usePlayerStore((s) => s.levelRecords)

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>目錄</h1>
      </div>
      <ul className="chapter-list">
        {CHAPTERS.map((chapter) => {
          const playable = hasContent(chapter.id) && isChapterUnlocked(chapter.id, levelRecords)
          const stars = getChapterStars(chapter.id, levelRecords)
          const maxStars = getChapterMaxStars(chapter.id)
          const levelCount = getChapterLevels(chapter.id).length
          return (
            <li key={chapter.id}>
              <button
                type="button"
                className="chapter-item"
                disabled={!playable}
                onClick={() => onOpenChapter(chapter.id)}
              >
                <span className="chapter-title">{chapter.title}</span>
                {playable ? (
                  <span className="chapter-stars">
                    {stars} / {maxStars} ⭐
                  </span>
                ) : levelCount > 0 ? (
                  <span className="chapter-locked">🔒 需先取得前一章一半星星</span>
                ) : (
                  <span className="chapter-locked">🔒 敬請期待</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
