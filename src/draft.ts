import type { AgentInputContent, AgentInputTag } from './types.js'

export interface DraftSelection {
  start: number
  end: number
}

const partLength = (part: string | AgentInputTag) => typeof part === 'string' ? part.length : 1

export function draftLength(content: AgentInputContent): number {
  return content.reduce((length, part) => length + partLength(part), 0)
}

export function normalizeDraft(content: AgentInputContent): AgentInputContent {
  const result: AgentInputContent = []
  for (const part of content) {
    if (typeof part !== 'string') {
      result.push({ ...part })
      continue
    }
    if (part === '') continue
    const previous = result[result.length - 1]
    const text = part.replace(/\r\n?/g, '\n')
    if (typeof previous === 'string') result[result.length - 1] = previous + text
    else result.push(text)
  }
  return result
}

export function sameDraft(first: AgentInputContent, second: AgentInputContent): boolean {
  return first.length === second.length && first.every((part, index) => {
    const other = second[index]
    if (typeof part === 'string' || typeof other === 'string') return part === other
    return part.label === other.label && part.value === other.value &&
      part.img === other.img && part.color === other.color
  })
}

export function sliceDraft(content: AgentInputContent, start: number, end = Infinity): AgentInputContent {
  const result: AgentInputContent = []
  let offset = 0
  for (const part of content) {
    const next = offset + partLength(part)
    if (offset >= end) break
    if (next > start && start < end) {
      result.push(typeof part === 'string'
        ? part.slice(Math.max(0, start - offset), end - offset)
        : part)
    }
    offset = next
  }
  return result
}

export function serializeDraft(content: AgentInputContent): string {
  let text = ''
  let previousWasTag = false
  for (const part of content) {
    const isTag = typeof part !== 'string'
    const value = isTag ? part.value : part
    if (value === '') continue
    if ((isTag || previousWasTag) && text && !/\s$/.test(text) && !/^\s/.test(value)) text += ' '
    text += value
    previousWasTag = isTag
  }
  return text
}
