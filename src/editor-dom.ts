import type { DraftSelection } from './draft.js'
import type { AgentInputContent, AgentInputTag } from './types.js'

const guardCharacter = '\uFEFF'
const tagAttribute = 'data-agent-input-tag'
const guardAttribute = 'data-agent-input-guard'

interface DomPoint {
  node: Node
  offset: number
}

interface TextPosition {
  node: Text
  start: number
  end: number
  guardIndex: number
}

export interface EditorSnapshot {
  content: AgentInputContent
  length: number
  offsetAt(node: Node, offset: number): number | undefined
  pointAt(offset: number): DomPoint
}

function readTag(element: Element): AgentInputTag | undefined {
  const data = element.getAttribute(tagAttribute)
  return data === null ? undefined : JSON.parse(data) as AgentInputTag
}

export function tagFromTarget(editor: HTMLElement, target: EventTarget | null): AgentInputTag | undefined {
  if (!(target instanceof Element)) return
  const tag = target.closest(`[${tagAttribute}]`)
  if (tag && editor.contains(tag)) return readTag(tag)
}

export function renderEditor(editor: HTMLElement, content: AgentInputContent): EditorSnapshot {
  const doc = editor.ownerDocument
  const fragment = doc.createDocumentFragment()

  // Empty gaps need a caret position, especially between two non-editable tags in WebKit.
  function appendGuard() {
    const guard = doc.createElement('span')
    guard.setAttribute(guardAttribute, '')
    guard.textContent = guardCharacter
    fragment.append(guard)
  }

  for (const [index, part] of content.entries()) {
    if (typeof part === 'string') {
      fragment.append(doc.createTextNode(part))
      continue
    }
    if (typeof content[index - 1] !== 'string') appendGuard()
    const tag = doc.createElement('button')
    tag.type = 'button'
    tag.className = 'agent-input__tag'
    tag.contentEditable = 'false'
    tag.setAttribute(tagAttribute, JSON.stringify(part))
    if (part.img) {
      const image = doc.createElement('img')
      image.src = part.img
      image.alt = ''
      image.draggable = false
      tag.append(image)
    }
    const label = doc.createElement('span')
    label.className = 'agent-input__tag-label'
    label.textContent = part.label
    if (part.color) label.style.color = part.color
    tag.append(label)
    fragment.append(tag)
  }

  const last = content[content.length - 1]
  if (typeof last !== 'string' || last.endsWith('\n')) appendGuard()
  editor.replaceChildren(fragment)
  return readEditor(editor)
}

export function readEditor(editor: HTMLElement): EditorSnapshot {
  const content: AgentInputContent = []
  const boundaries = new Map<Node, number[]>()
  const textPositions = new Map<Node, TextPosition>()
  let length = 0

  function appendText(text: string) {
    if (!text) return
    const last = content[content.length - 1]
    if (typeof last === 'string') content[content.length - 1] = last + text
    else content.push(text)
    length += text.length
  }

  function visit(node: Node, guard?: { pending: boolean }) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text
      const raw = textNode.data
      const guardIndex = guard?.pending ? raw.indexOf(guardCharacter) : -1
      if (guardIndex !== -1 && guard) guard.pending = false
      const start = length
      appendText(guardIndex === -1 ? raw : raw.slice(0, guardIndex) + raw.slice(guardIndex + 1))
      textPositions.set(node, { node: textNode, start, end: length, guardIndex })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    const tag = readTag(element)
    if (tag) {
      boundaries.set(node, [length, length + 1])
      content.push(tag)
      length++
      return
    }
    if (element.tagName === 'BR') {
      // Browsers add a trailing BR as a caret placeholder in empty blocks.
      boundaries.set(node, [length])
      if (element.nextSibling) appendText('\n')
      return
    }

    const childBoundaries = [length]
    const childGuard = element.hasAttribute(guardAttribute) ? { pending: true } : guard
    let previousWasBlock = false
    for (const [index, child] of [...node.childNodes].entries()) {
      const isBlock = /^(DIV|P)$/.test(child.nodeName)
      if (index > 0 && (isBlock || previousWasBlock)) appendText('\n')
      childBoundaries[index] = length
      visit(child, childGuard)
      childBoundaries.push(length)
      previousWasBlock = isBlock
    }
    boundaries.set(node, childBoundaries)
  }

  visit(editor)

  return {
    content,
    length,
    offsetAt(node, offset) {
      const text = textPositions.get(node)
      if (text) return text.start + offset - Number(text.guardIndex !== -1 && offset > text.guardIndex)
      const positions = boundaries.get(node)
      if (positions) return positions[Math.min(offset, positions.length - 1)]
    },
    pointAt(offset) {
      const target = Math.max(0, Math.min(offset, length))
      for (const text of textPositions.values()) {
        if (target < text.start || target > text.end) continue
        const position = target - text.start
        return { node: text.node, offset: position + Number(text.guardIndex !== -1 && position >= text.guardIndex) }
      }
      const rootPositions = boundaries.get(editor) ?? [0]
      const index = rootPositions.findIndex(position => position >= target)
      return { node: editor, offset: index === -1 ? editor.childNodes.length : index }
    },
  }
}

export function readSelection(editor: HTMLElement, snapshot: EditorSnapshot): DraftSelection | null {
  const selection = editor.ownerDocument.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  const start = snapshot.offsetAt(range.startContainer, range.startOffset)
  const end = snapshot.offsetAt(range.endContainer, range.endOffset)
  return start === undefined || end === undefined ? null : { start, end }
}

export function restoreSelection(scrollArea: HTMLElement, snapshot: EditorSnapshot, selection: DraftSelection) {
  const doc = scrollArea.ownerDocument
  const start = snapshot.pointAt(selection.start)
  const end = snapshot.pointAt(selection.end)
  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  doc.getSelection()?.removeAllRanges()
  doc.getSelection()?.addRange(range)

  const caret = range.getBoundingClientRect()
  const bounds = scrollArea.getBoundingClientRect()
  if (caret.height && caret.bottom > bounds.bottom) scrollArea.scrollTop += caret.bottom - bounds.bottom
  if (caret.height && caret.top < bounds.top) scrollArea.scrollTop -= bounds.top - caret.top
}
