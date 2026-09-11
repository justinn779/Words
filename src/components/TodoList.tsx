import { useState } from 'react'
import { getTodoList } from '../engine'
import { useGameStore } from '../store/gameStore'

export default function TodoList() {
  const game = useGameStore((s) => s.game)
  const [collapsed, setCollapsed] = useState(false)
  if (!game) return null

  const items = getTodoList(game)

  return (
    <aside className={`todo-list ${collapsed ? 'todo-list-collapsed' : ''}`}>
      <button type="button" className="todo-list-header" onClick={() => setCollapsed((c) => !c)}>
        <span>本關分類</span>
        <span className="todo-list-toggle">{collapsed ? '展開 ▾' : '收合 ▴'}</span>
      </button>
      {!collapsed && (
        <ul>
          {items.map((item) => (
            <li
              // Keying on completed/revealed forces a remount right when a category
              // finishes or is first revealed, so the CSS `animation` below (mount-only)
              // plays as a one-shot celebration/reveal.
              key={`${item.categoryId}:${item.completed}:${item.revealed}`}
              className={[
                item.completed ? 'todo-done todo-complete-pulse' : '',
                !item.revealed ? 'todo-mystery' : '',
                item.revealed && !item.completed ? 'todo-reveal-pulse' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="todo-check">{item.completed ? '✓' : ''}</span>
              <span className="todo-name">{item.revealed ? item.name : '❔ 未知分類'}</span>
              <span className="todo-progress">{item.revealed ? `${item.collected}/${item.required}` : '?/?'}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
