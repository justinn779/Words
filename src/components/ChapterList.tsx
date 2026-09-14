import { useState } from 'react'
import { CHAPTERS } from '../data/chapters'
import {
  getChapterDisplayTitle,
  getChapterLevels,
  getChapterMaxStars,
  getChapterStars,
  getContentChapterOrder,
  hasContent,
  isChapterStarGateOpen,
  isChapterUnlocked,
  isNextNewChapterGateOpen,
} from '../data/progression'
import { usePlayerStore } from '../store/playerStore'
import { useContentStore, GENERATING_NEW_CHAPTER } from '../store/contentStore'
import { AI_CHAPTER_IDS } from '../firebase/aiChapters'

interface ChapterListProps {
  onBack: () => void
  onOpenChapter: (chapterId: string) => void
}

export default function ChapterList({ onBack, onOpenChapter }: ChapterListProps) {
  const levelRecords = usePlayerStore((s) => s.levelRecords)
  const aiChapters = useContentStore((s) => s.aiChapters)
  const generatingChapterId = useContentStore((s) => s.generatingChapterId)
  const generateChapter = useContentStore((s) => s.generateChapter)
  const generateNewChapter = useContentStore((s) => s.generateNewChapter)
  const extraLevels = Object.values(aiChapters).flatMap((e) => e.levels)
  const contentOrder = getContentChapterOrder(extraLevels)
  const [genError, setGenError] = useState<{ chapterId: string; message: string } | null>(null)

  // Rows to render: the fixed 8-chapter roster, plus any entirely new chapters
  // generated beyond it (ai-chapter-{order} ids — see progression.ts's
  // chapterSortKey for how these get ordered after every chapters.ts entry).
  const dynamicIds = contentOrder.filter((id) => !CHAPTERS.some((c) => c.id === id))
  const rows = [
    ...CHAPTERS.map((c) => ({ id: c.id, title: c.title })),
    ...dynamicIds.map((id) => ({ id, title: getChapterDisplayTitle(id, contentOrder, aiChapters[id]?.title) })),
  ]

  const lastStaticId = CHAPTERS[CHAPTERS.length - 1]?.id
  const allStaticChaptersFilled = lastStaticId ? hasContent(lastStaticId, extraLevels) : true
  const canGenerateNewChapter = allStaticChaptersFilled && isNextNewChapterGateOpen(levelRecords, extraLevels)
  const generatingNewChapter = generatingChapterId === GENERATING_NEW_CHAPTER

  const handleGenerate = async (chapterId: string) => {
    setGenError(null)
    const result = await generateChapter(chapterId)
    if (!result.ok) setGenError({ chapterId, message: result.message })
  }

  const handleGenerateNew = async () => {
    setGenError(null)
    const result = await generateNewChapter()
    if (!result.ok) setGenError({ chapterId: GENERATING_NEW_CHAPTER, message: result.message })
  }

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>目錄</h1>
      </div>
      <ul className="chapter-list">
        {rows.map((chapter) => {
          const playable = hasContent(chapter.id, extraLevels) && isChapterUnlocked(chapter.id, levelRecords, extraLevels)
          const stars = getChapterStars(chapter.id, levelRecords, extraLevels)
          const maxStars = getChapterMaxStars(chapter.id, extraLevels)
          const levelCount = getChapterLevels(chapter.id, extraLevels).length
          const generating = generatingChapterId === chapter.id
          const canGenerate =
            levelCount === 0 &&
            (AI_CHAPTER_IDS as readonly string[]).includes(chapter.id) &&
            isChapterStarGateOpen(chapter.id, levelRecords, extraLevels)
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
                ) : !canGenerate ? (
                  <span className="chapter-locked">🔒 敬請期待</span>
                ) : null}
              </button>
              {canGenerate && (
                <div className="chapter-generate-row">
                  <button
                    type="button"
                    className="settings-toggle"
                    disabled={generating}
                    onClick={() => handleGenerate(chapter.id)}
                  >
                    {generating ? '生成中…' : '🪄 用 AI 生成本章'}
                  </button>
                  {genError?.chapterId === chapter.id && <span className="settings-error">{genError.message}</span>}
                </div>
              )}
            </li>
          )
        })}
        {canGenerateNewChapter && (
          <li>
            <div className="chapter-generate-row">
              <button type="button" className="settings-toggle" disabled={generatingNewChapter} onClick={handleGenerateNew}>
                {generatingNewChapter ? '生成中…' : '🪄 用 AI 生成全新章節'}
              </button>
              {genError?.chapterId === GENERATING_NEW_CHAPTER && <span className="settings-error">{genError.message}</span>}
            </div>
          </li>
        )}
      </ul>
    </div>
  )
}
