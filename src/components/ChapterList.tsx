import { useEffect, useRef } from 'react'
import { getChapterDisplayTitle, getChapterMaxStars, getChapterStars, getContentChapterOrder, isChapterUnlocked, isNextNewChapterGateOpen } from '../data/progression'
import { usePlayerStore } from '../store/playerStore'
import { useContentStore, GENERATING_NEW_CHAPTER } from '../store/contentStore'

interface ChapterListProps {
  onBack: () => void
  onOpenChapter: (chapterId: string) => void
}

export default function ChapterList({ onBack, onOpenChapter }: ChapterListProps) {
  const levelRecords = usePlayerStore((s) => s.levelRecords)
  const aiChapters = useContentStore((s) => s.aiChapters)
  const generatingChapterId = useContentStore((s) => s.generatingChapterId)
  const refreshAndMaybeBootstrap = useContentStore((s) => s.refreshAndMaybeBootstrap)
  const extraLevels = Object.values(aiChapters).flatMap((e) => e.levels)
  const contentOrder = getContentChapterOrder(extraLevels)

  // App.tsx's one-time load-on-startup only gets ONE chance to notice "nothing
  // generated yet" and bootstrap chapter 1 — if this tab was already open
  // before an admin wipe (or that one chance lost a race), it never gets
  // retried for the rest of the session. Re-checking Firestore fresh every
  // time the chapter list is actually opened gives it another chance, right
  // where a player would notice the list is empty anyway.
  useEffect(() => {
    void refreshAndMaybeBootstrap()
    // Intentionally once per mount only — this is a deliberate extra chance,
    // not a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every chapter is generated on demand (functions/src/index.ts's
  // generateNewChapterNow) — a row only exists once it actually has content, so
  // there's no "locked, not generated yet" state per chapter anymore. The one
  // generation-status indicator that matters is whether the NEXT chapter
  // (unknown id until the server assigns one) is generating or about to —
  // rendered as a single trailing row below, not per named chapter. Starting a
  // level auto-triggers this (see gameStore.ts's startLevel ->
  // ensureNextChapterGenerating); a brand-new install with zero chapters yet
  // bootstraps the very first one the same way (see the mount effect above and
  // src/store/contentStore.ts's maybeBootstrapFirstChapter).
  const generatingNext = generatingChapterId === GENERATING_NEW_CHAPTER
  const nextChapterComing = generatingNext || isNextNewChapterGateOpen(levelRecords, extraLevels)

  const rowStats = contentOrder.map((chapterId) => ({
    id: chapterId,
    title: getChapterDisplayTitle(chapterId, contentOrder, aiChapters[chapterId]?.title),
    playable: isChapterUnlocked(chapterId, levelRecords, extraLevels),
    stars: getChapterStars(chapterId, levelRecords, extraLevels),
    maxStars: getChapterMaxStars(chapterId, extraLevels),
  }))

  // Where the player's attention belongs when the list opens: the first
  // playable chapter they haven't fully starred yet; failing that, their last
  // playable chapter. undefined if nothing's playable yet (brand-new player,
  // first chapter still generating) — nothing to scroll to in that case.
  const currentChapter = rowStats.find((r) => r.playable && r.stars < r.maxStars) ?? [...rowStats].reverse().find((r) => r.playable)

  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  useEffect(() => {
    if (!currentChapter) return
    rowRefs.current.get(currentChapter.id)?.scrollIntoView({ block: 'center' })
    // Only re-run when *which* chapter counts as current changes, not on every
    // render — a player scrolled elsewhere in the list shouldn't get yanked
    // back on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter?.id])

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>目錄</h1>
      </div>
      <ul className="chapter-list">
        {rowStats.map((chapter) => {
          const { playable, stars, maxStars } = chapter
          return (
            <li
              key={chapter.id}
              ref={(el) => {
                if (el) rowRefs.current.set(chapter.id, el)
                else rowRefs.current.delete(chapter.id)
              }}
            >
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
                ) : (
                  <span className="chapter-locked">🔒 需先取得前一章一半星星</span>
                )}
              </button>
            </li>
          )
        })}
        {nextChapterComing && (
          <li>
            <div className="chapter-item chapter-item-pending">
              <span className="chapter-title">下一章</span>
              <span className="chapter-generatable">{generatingNext ? '🪄 生成中…' : '✨ 即將自動生成'}</span>
            </div>
          </li>
        )}
      </ul>
    </div>
  )
}
