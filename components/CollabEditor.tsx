import { useEffect, useRef, useState, useCallback, type ChangeEvent } from 'react'
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

interface EditorFile {
  path: string
  name: string
  content: string
  language: string
  source: 'local' | 'shared'
}

interface CollabEditorProps {
  myPeerId: string
  broadcastOperation: (op: Omit<CodeOperation, 'from' | 'timestamp'>) => void
  incomingOp: CodeOperation | null
}

const getLanguageFromPath = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    html: 'html',
    htm: 'html',
    css: 'css',
    json: 'json',
  }

  return map[extension ?? ''] ?? 'javascript'
}

export default function CollabEditor({ myPeerId, broadcastOperation, incomingOp }: CollabEditorProps) {
  const [language, setLanguage] = useState('javascript')
  const [content, setContent] = useState(STARTER.javascript)
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [files, setFiles] = useState<EditorFile[]>([
    {
      path: 'session.js',
      name: 'session.js',
      content: STARTER.javascript,
      language: 'javascript',
      source: 'shared',
    },
  ])
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const applyingRemote = useRef(false)
  const lastContent = useRef(STARTER.javascript)
  const [remoteCursors, setRemoteCursors] = useState<Map<string, any>>(new Map())
  const pendingOps = useRef<CodeOperation[]>([])

  const syncCurrentFile = useCallback((path: string | null, nextContent: string, nextLanguage: string, source: 'local' | 'shared' = 'shared') => {
    const fallbackPath = path ?? 'session.js'
    const fallbackName = fallbackPath.split('/').pop() ?? fallbackPath

    setFiles((prev) => {
      const existing = prev.find((file) => file.path === fallbackPath)
      if (!existing) {
        return [
          {
            path: fallbackPath,
            name: fallbackName,
            content: nextContent,
            language: nextLanguage,
            source,
          },
          ...prev,
        ]
      }

      return prev.map((file) =>
        file.path === fallbackPath
          ? { ...file, content: nextContent, language: nextLanguage, source }
          : file
      )
    })
  }, [])

  const switchFile = useCallback(
    (file: EditorFile, shouldBroadcast = true) => {
      applyingRemote.current = true
      setCurrentFilePath(file.path)
      setLanguage(file.language)
      setContent(file.content)
      lastContent.current = file.content

      const model = editorRef.current?.getModel()
      if (model) {
        const fullRange = model.getFullModelRange()
        model.applyEdits([{ range: fullRange, text: file.content }])
      }
      applyingRemote.current = false

      syncCurrentFile(file.path, file.content, file.language, file.source)

      if (shouldBroadcast) {
        broadcastOperation({
          type: 'file-switch',
          position: 0,
          filePath: file.path,
          language: file.language,
          text: file.content,
        })
      }
    },
    [broadcastOperation, syncCurrentFile]
  )

  useEffect(() => {
    if (!incomingOp || incomingOp.from === myPeerId) return

    if (incomingOp.type === 'file-switch') {
      const remotePath = incomingOp.filePath ?? 'shared-file'
      const nextLanguage = incomingOp.language ?? getLanguageFromPath(remotePath)
      const remoteFile: EditorFile = {
        path: remotePath,
        name: remotePath.split('/').pop() ?? remotePath,
        content: incomingOp.text ?? '',
        language: nextLanguage,
        source: 'shared',
      }
      switchFile(remoteFile, false)
      return
    }

    if (incomingOp.type === 'language') {
      const lang = incomingOp.language ?? 'javascript'
      setLanguage(lang)
      syncCurrentFile(currentFilePath, lastContent.current, lang)
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

    let op = incomingOp as any
    pendingOps.current.forEach((localOp) => {
      op = transformOp(op, localOp as any)
    })

    applyingRemote.current = true
    const newContent = applyOp(lastContent.current, op)
    lastContent.current = newContent
    setContent(newContent)
    syncCurrentFile(currentFilePath, newContent, language)

    const model = editorRef.current?.getModel()
    if (model) {
      const fullRange = model.getFullModelRange()
      model.applyEdits([{ range: fullRange, text: newContent }])
    }
    applyingRemote.current = false
  }, [incomingOp, myPeerId, switchFile, syncCurrentFile, currentFilePath, language])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (applyingRemote.current || value === undefined) return
      const newVal = value
      const ops = diffToOps(lastContent.current, newVal, myPeerId)
      lastContent.current = newVal
      setContent(newVal)
      syncCurrentFile(currentFilePath, newVal, language)

      ops.forEach((op) => {
        pendingOps.current.push(op as any)
        broadcastOperation(op as any)
        setTimeout(() => {
          pendingOps.current = pendingOps.current.filter((p) => p !== (op as any))
        }, 200)
      })
    },
    [myPeerId, broadcastOperation, syncCurrentFile, currentFilePath, language]
  )

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
    syncCurrentFile(currentFilePath, lastContent.current, lang)
    broadcastOperation({ type: 'language', position: 0, language: lang })
  }

  const handleEditorMount = (editor: MonacoType.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition(handleCursorChange)
  }

  const handleFolderUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    if (selectedFiles.length === 0) return

    const loadedFiles = await Promise.all(
      selectedFiles.map(async (file) => {
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const fileContent = await file.text()
        return {
          path,
          name: file.name,
          content: fileContent,
          language: getLanguageFromPath(path),
          source: 'local' as const,
        }
      })
    )

    const sortedFiles = loadedFiles.sort((a, b) => a.path.localeCompare(b.path))
    setFiles((prev) => {
      const map = new Map(prev.map((file) => [file.path, file]))
      sortedFiles.forEach((file) => map.set(file.path, file))
      return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
    })

    switchFile(sortedFiles[0], true)
    event.target.value = ''
  }, [switchFile])

  const activeFile = files.find((file) => file.path === currentFilePath)

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0d1117' }}>
      <aside
        style={{
          width: 260,
          borderRight: '1px solid #30363d',
          background: '#0b1220',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: 14, borderBottom: '1px solid #1f2937' }}>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            workspace
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%',
              background: '#1f6feb',
              color: '#fff',
              border: '1px solid #388bfd',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            Upload Folder
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFolderUpload}
            style={{ display: 'none' }}
            {...({ webkitdirectory: 'true', directory: 'true' } as any)}
          />
        </div>

        <div style={{ padding: '10px 8px', overflowY: 'auto', flex: 1 }}>
          {files.map((file) => {
            const isActive = file.path === currentFilePath
            return (
              <button
                key={file.path}
                onClick={() => switchFile(file, true)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: isActive ? 'rgba(31,111,235,0.16)' : 'transparent',
                  border: '1px solid',
                  borderColor: isActive ? '#388bfd' : 'transparent',
                  borderRadius: 8,
                  padding: '9px 10px',
                  color: isActive ? '#e6edf3' : '#9fb0c3',
                  cursor: 'pointer',
                  marginBottom: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>{file.name}</div>
                <div style={{ fontSize: 10, color: '#6e7681', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {file.path}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 16px',
            background: '#161b22',
            borderBottom: '1px solid #30363d',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'monospace' }}>language:</span>
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            style={{
              background: '#21262d',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: '#6e7681' }}>{activeFile?.path ?? 'session.js'}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#3fb950',
                boxShadow: '0 0 6px #3fb950',
              }}
              title="Connected"
            />
            <span style={{ fontSize: 11, color: '#8b949e' }}>live</span>
          </div>
        </div>

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
    </div>
  )
}
