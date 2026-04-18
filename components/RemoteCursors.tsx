// components/RemoteCursors.tsx
// Renders colored cursor labels over the Monaco editor for each remote peer.
// Positions are tracked via Monaco's editor.setDecorations API.
import { useEffect, useRef } from 'react'
import type * as MonacoType from 'monaco-editor'

const CURSOR_COLORS = ['#ff6b6b', '#51cf66', '#339af0', '#f59f00', '#cc5de8', '#20c997']

interface CursorInfo {
  peerId: string
  username: string
  line: number
  column: number
}

interface RemoteCursorsProps {
  editor: MonacoType.editor.IStandaloneCodeEditor | null
  cursors: Map<string, CursorInfo>
}

export default function RemoteCursors({ editor, cursors }: RemoteCursorsProps) {
  const decorationsRef = useRef<Map<string, string[]>>(new Map())
  const colorIndex = useRef<Map<string, number>>(new Map())
  let colorCounter = 0

  const getColor = (peerId: string) => {
    if (!colorIndex.current.has(peerId)) {
      colorIndex.current.set(peerId, colorCounter % CURSOR_COLORS.length)
      colorCounter++
    }
    return CURSOR_COLORS[colorIndex.current.get(peerId)!]
  }

  useEffect(() => {
    if (!editor) return

    cursors.forEach((cursor, peerId) => {
      const color = getColor(peerId)
      const hexNoHash = color.slice(1)

      const decorations = editor.deltaDecorations(
        decorationsRef.current.get(peerId) ?? [],
        [
          {
            range: new (window as any).monaco.Range(cursor.line, cursor.column, cursor.line, cursor.column),
            options: {
              className: `remote-cursor-${peerId}`,
              beforeContentClassName: `remote-cursor-before-${peerId}`,
              stickiness: 1,
              zIndex: 10,
              after: {
                content: ` ${cursor.username} `,
                inlineClassName: 'remote-cursor-label',
                cursorStops: 0,
              },
            },
          },
        ]
      )
      decorationsRef.current.set(peerId, decorations)

      // Inject CSS for this cursor's color (once)
      const styleId = `cursor-style-${peerId}`
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style')
        style.id = styleId
        style.textContent = `
          .remote-cursor-before-${peerId}::before {
            content: '';
            border-left: 2px solid ${color};
            margin-left: -1px;
          }
          .remote-cursor-${peerId} {
            background: ${color}22;
          }
        `
        document.head.appendChild(style)
      }
    })

    // Remove decorations for peers who left
    decorationsRef.current.forEach((decs, peerId) => {
      if (!cursors.has(peerId)) {
        editor.deltaDecorations(decs, [])
        decorationsRef.current.delete(peerId)
      }
    })
  }, [editor, cursors])

  return null
}
