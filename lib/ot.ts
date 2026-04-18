// lib/ot.ts
// Lightweight Operational Transform for collaborative text editing.
// Supports insert, delete, replace operations with transformation against concurrent ops.

export type OpType = 'insert' | 'delete' | 'replace' | 'cursor' | 'language'

export interface TextOp {
  type: OpType
  position: number
  text?: string       // for insert / replace
  length?: number     // chars to remove (delete / replace)
  from: string
  timestamp: number
}

// Transform op A against concurrent op B (A happened "after" B in causal order)
export function transformOp(a: TextOp, b: TextOp): TextOp {
  if (a.type === 'cursor' || a.type === 'language') return a
  if (b.type === 'cursor' || b.type === 'language') return a

  const aPos = a.position
  const bPos = b.position

  if (b.type === 'insert') {
    const bLen = b.text?.length ?? 0
    if (aPos >= bPos) return { ...a, position: aPos + bLen }
    return a
  }

  if (b.type === 'delete') {
    const bLen = b.length ?? 0
    const bEnd = bPos + bLen
    if (aPos >= bEnd) return { ...a, position: aPos - bLen }
    if (aPos > bPos && aPos < bEnd) return { ...a, position: bPos }
    return a
  }

  if (b.type === 'replace') {
    const bLen = b.length ?? 0
    const bNewLen = b.text?.length ?? 0
    const bEnd = bPos + bLen
    if (aPos >= bEnd) return { ...a, position: aPos - bLen + bNewLen }
    if (aPos > bPos) return { ...a, position: bPos + bNewLen }
    return a
  }

  return a
}

// Apply an op to a string, returning the new string
export function applyOp(content: string, op: TextOp): string {
  if (op.type === 'cursor' || op.type === 'language') return content

  const pos = Math.max(0, Math.min(op.position, content.length))

  if (op.type === 'insert') {
    return content.slice(0, pos) + (op.text ?? '') + content.slice(pos)
  }

  if (op.type === 'delete') {
    const len = op.length ?? 0
    return content.slice(0, pos) + content.slice(pos + len)
  }

  if (op.type === 'replace') {
    const len = op.length ?? 0
    return content.slice(0, pos) + (op.text ?? '') + content.slice(pos + len)
  }

  return content
}

// Build ops by diffing two strings (simple Myers-lite, good enough for keystroke deltas)
export function diffToOps(oldText: string, newText: string, from: string): TextOp[] {
  const timestamp = Date.now()
  // Find common prefix
  let start = 0
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++

  // Find common suffix
  let oldEnd = oldText.length - 1
  let newEnd = newText.length - 1
  while (oldEnd >= start && newEnd >= start && oldText[oldEnd] === newText[newEnd]) { oldEnd--; newEnd-- }

  const deletedText = oldText.slice(start, oldEnd + 1)
  const insertedText = newText.slice(start, newEnd + 1)

  if (!deletedText && !insertedText) return []

  if (deletedText && insertedText) {
    return [{ type: 'replace', position: start, text: insertedText, length: deletedText.length, from, timestamp }]
  }
  if (deletedText) {
    return [{ type: 'delete', position: start, length: deletedText.length, from, timestamp }]
  }
  return [{ type: 'insert', position: start, text: insertedText, from, timestamp }]
}
