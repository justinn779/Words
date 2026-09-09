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
              // Keying on `completed` forces a remount right when a category finishes,
              // so the CSS `animation` below (mount-only) plays as a one-shot celebration.
              key={`${item.categoryId}:${item.completed}`}
              className={item.completed ? 'todo-done todo-complete-pulse' : ''}
            >
              <span className="todo-check">{item.completed ? '✓' : ''}</span>
              <span className="todo-name">{item.name}</span>
              <span className="todo-progress">
                {item.collected}/{item.required}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
