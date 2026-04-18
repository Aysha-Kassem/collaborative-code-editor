// components/CollabEditor.tsx
// Main editor component: Monaco + OT + WebRTC DataChannel integration.
import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type * as MonacoType from 'monaco-editor'
import RemoteCursors from './RemoteCursors'
import { diffToOps, applyOp, transformOp } from '../lib/ot'
import type { CodeOperation } from '../hooks/useWebRTC'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

const STARTER: Record<string, string> = {
  javascript: `// Collaborative JavaScript session\nfunction greet(name) {\n  return \`Hello, \${name}!\`\n}\n\nconsole.log(greet('World'))`,
  python: `# Collaborative Python session\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))`,
  typescript: `// Collaborative TypeScript session\nconst greet = (name: string): string => {\n  return \`Hello, \${name}!\`\n}\n\nconsole.log(greet('World'))`,
  go: `// Collaborative Go session\npackage main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello, World!")\n}`,
  rust: `// Collaborative Rust session\nfn main() {\n  println!("Hello, World!");\n}`,
}

const LANGUAGES = ['javascript', 'typescript', 'python', 'go', 'rust', 'html', 'css', 'json']

interface CollabEditorProps {
  myPeerId: string
  broadcastOperation: (op: Omit<CodeOperation, 'from' | 'timestamp'>) => void
  incomingOp: CodeOperation | null
}

export default function CollabEditor({ myPeerId, broadcastOperation, incomingOp }: CollabEditorProps) {
  const [language, setLanguage] = useState('javascript')
  const [content, setContent] = useState(STARTER.javascript)
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const applyingRemote = useRef(false)
  const lastContent = useRef(STARTER.javascript)
  const [remoteCursors, setRemoteCursors] = useState<Map<string, any>>(new Map())
  const pendingOps = useRef<CodeOperation[]>([])

  // ── Handle incoming remote op ──────────────────────────────────────────────
  useEffect(() => {
    if (!incomingOp || incomingOp.from === myPeerId) return

    if (incomingOp.type === 'language') {
      const lang = incomingOp.language ?? 'javascript'
      setLanguage(lang)
      return
    }

    if (incomingOp.type === 'cursor') {
      setRemoteCursors((prev) => {
        const m = new Map(prev)
        m.set(incomingOp.from, {
          peerId: incomingOp.from,
          username: incomingOp.from.slice(0, 6),
          line: incomingOp.cursor?.line ?? 1,
          column: incomingOp.cursor?.column ?? 1,
        })
        return m
      })
      return
    }

    // Apply text op with OT transformation against any concurrent local ops
    let op = incomingOp as any
    pendingOps.current.forEach((localOp) => {
      op = transformOp(op, localOp as any)
    })

    applyingRemote.current = true
    const newContent = applyOp(lastContent.current, op)
    lastContent.current = newContent
    setContent(newContent)

    // Apply directly to Monaco model without triggering onChange
    const model = editorRef.current?.getModel()
    if (model) {
      const fullRange = model.getFullModelRange()
      model.applyEdits([{ range: fullRange, text: newContent }])
    }
    applyingRemote.current = false
  }, [incomingOp, myPeerId])

  // ── Handle local editor change → diff → broadcast ─────────────────────────
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (applyingRemote.current || value === undefined) return
      const newVal = value
      const ops = diffToOps(lastContent.current, newVal, myPeerId)
      lastContent.current = newVal

      ops.forEach((op) => {
        pendingOps.current.push(op as any)
        broadcastOperation(op as any)
        // Clear from pending after a tick (once broadcast acknowledged)
        setTimeout(() => {
          pendingOps.current = pendingOps.current.filter((p) => p !== (op as any))
        }, 200)
      })
    },
    [myPeerId, broadcastOperation]
  )

  // ── Cursor position broadcast ──────────────────────────────────────────────
  const handleCursorChange = useCallback(
    (e: MonacoType.editor.ICursorPositionChangedEvent) => {
      broadcastOperation({
        type: 'cursor',
        position: 0,
        cursor: { line: e.position.lineNumber, column: e.position.column },
      })
    },
    [broadcastOperation]
  )

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    if (STARTER[lang]) {
      setContent(STARTER[lang])
      lastContent.current = STARTER[lang]
    }
    broadcastOperation({ type: 'language', position: 0, language: lang })
  }

  const handleEditorMount = (editor: MonacoType.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition(handleCursorChange)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: '#161b22',
        borderBottom: '1px solid #30363d', flexShrink: 0
      }}>
        <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'monospace' }}>language:</span>
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          style={{
            background: '#21262d', color: '#e6edf3', border: '1px solid #30363d',
            borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer'
          }}>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#3fb950', boxShadow: '0 0 6px #3fb950'
          }} title="Connected" />
          <span style={{ fontSize: 11, color: '#8b949e' }}>live</span>
        </div>
      </div>

      {/* Monaco */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MonacoEditor
          height="100%"
          language={language}
          value={content}
          onChange={handleChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            fontSize: 14,
            fontFamily: '"Fira Code", "Cascadia Code", monospace',
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderLineHighlight: 'gutter',
            cursorBlinking: 'smooth',
            smoothScrolling: true,
            padding: { top: 16, bottom: 16 },
            wordWrap: 'on',
          }}
        />
        <RemoteCursors editor={editorRef.current} cursors={remoteCursors} />
      </div>
    </div>
  )
}
