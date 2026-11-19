<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { draftLength, normalizeDraft, sameDraft, serializeDraft, sliceDraft } from './draft.js'
import type { DraftSelection } from './draft.js'
import { readEditor, readSelection, renderEditor, restoreSelection, tagFromTarget } from './editor-dom.js'
import type { EditorSnapshot } from './editor-dom.js'
import type {
  AgentInputContent,
  AgentInputExpose,
  AgentInputItem,
  AgentInputProps,
  AgentInputSendPayload,
  AgentInputSuggestion,
  AgentInputTag,
  AgentInputTrigger,
} from './types.js'

const props = withDefaults(defineProps<AgentInputProps>(), {
  theme: 'light',
  minRows: 2,
  maxRows: 6,
  placeholder: '输入消息',
  ariaLabel: '消息正文',
  loading: false,
})

const emit = defineEmits<{
  'update:modelValue': [content: AgentInputContent]
  'update:agent': [agent: AgentInputItem | null]
  'suggestion-keydown': [event: KeyboardEvent]
  'tag-click': [item: AgentInputTag]
  send: [payload: AgentInputSendPayload]
  stop: []
}>()

const slots = defineSlots<{
  header?(): unknown
  footer?(): unknown
  suggestion?(context: AgentInputSuggestion): unknown
}>()

interface ActiveSuggestion extends DraftSelection {
  trigger: AgentInputTrigger
  query: string
}

const root = ref<HTMLElement | null>(null)
const scrollArea = ref<HTMLElement | null>(null)
const editor = ref<HTMLElement | null>(null)
const panelId = `agent-input-suggestion-${useId()}`
const draft = shallowRef(normalizeDraft(props.modelValue ?? []))
const localAgent = shallowRef<AgentInputItem | null>(null)
const agent = computed(() => props.agent === undefined ? localAgent.value : props.agent)
const suggestion = shallowRef<ActiveSuggestion | null>(null)
const isComposing = ref(false)
let snapshot: EditorSnapshot | null = null
let lastSelection: DraftSelection | null = null
let pendingExternalDraft: AgentInputContent | null = null
let doc: Document | undefined
let pointerDownInside = false

const minRows = computed(() => rowCount(props.minRows, 2))
const maxRows = computed(() => Math.max(minRows.value, rowCount(props.maxRows, 6)))

function rowCount(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

function currentSelection() {
  if (!editor.value || !snapshot || doc?.activeElement !== editor.value) return null
  return readSelection(editor.value, snapshot)
}

function selectionOrEnd() {
  const end = snapshot?.length ?? draftLength(draft.value)
  return currentSelection() ?? lastSelection ?? { start: end, end }
}

function focus() {
  const element = editor.value
  const scroller = scrollArea.value
  if (!element || !scroller || !snapshot || doc?.activeElement === element) return
  const selection = selectionOrEnd()
  element.focus({ preventScroll: true })
  restoreSelection(scroller, snapshot, selection)
}

function closeSuggestion() {
  suggestion.value = null
}

function updateSuggestion(selection: DraftSelection | null, insertedText = '') {
  if (!slots.suggestion || !selection || selection.start !== selection.end) {
    closeSuggestion()
    return
  }

  const end = selection.end
  const triggerIndex = Math.max(insertedText.lastIndexOf('@'), insertedText.lastIndexOf('/'))
  const start = triggerIndex === -1 ? suggestion.value?.start : end - insertedText.length + triggerIndex
  if (start === undefined) return

  const [word, ...remaining] = sliceDraft(draft.value, start, end)
  if (typeof word !== 'string' || remaining.length || !/^[@/][^\s@/]*$/u.test(word)) {
    closeSuggestion()
    return
  }

  const trigger = word[0] as AgentInputTrigger
  const query = word.slice(1)
  const previous = suggestion.value
  if (previous?.start !== start || previous.end !== end || previous.trigger !== trigger || previous.query !== query) {
    suggestion.value = { start, end, trigger, query }
  }
}

function handleSelectionChange() {
  if (isComposing.value) return
  const selection = currentSelection()
  if (!selection) return
  lastSelection = selection
  updateSuggestion(selection)
}

function renderDraft(content: AgentInputContent, selection: DraftSelection | null, shouldFocus = false) {
  const element = editor.value
  if (!element) return
  snapshot = renderEditor(element, content)
  if (!selection) return

  const position = {
    start: Math.min(selection.start, snapshot.length),
    end: Math.min(selection.end, snapshot.length),
  }
  lastSelection = position
  if (shouldFocus) element.focus({ preventScroll: true })
  if (scrollArea.value && doc?.activeElement === element) restoreSelection(scrollArea.value, snapshot, position)
}

function commitDraft(content: AgentInputContent) {
  if (sameDraft(draft.value, content)) return false
  draft.value = content
  return true
}

function replaceSelection(
  selection: DraftSelection,
  content: AgentInputContent,
  options: { focus?: boolean; typed?: string } = {},
) {
  const inserted = normalizeDraft(content)
  const next = normalizeDraft([
    ...sliceDraft(draft.value, 0, selection.start),
    ...inserted,
    ...sliceDraft(draft.value, selection.end),
  ])
  const caret = selection.start + draftLength(inserted)
  const position = { start: caret, end: caret }
  const changed = commitDraft(next)
  renderDraft(next, position, options.focus)
  updateSuggestion(position, options.typed)
  if (changed) emit('update:modelValue', normalizeDraft(next))
}

function syncNativeInput(insertedText = '') {
  const element = editor.value
  if (!element) return
  snapshot = readEditor(element)
  const selection = currentSelection()
  if (selection) lastSelection = selection
  const changed = commitDraft(snapshot.content)
  if (!snapshot.length && snapshot.pointAt(0).node === element) {
    renderDraft([], { start: 0, end: 0 })
  }
  updateSuggestion(selection, insertedText)
  if (changed) emit('update:modelValue', normalizeDraft(draft.value))
}

function applyExternalDraft(content: AgentInputContent) {
  if (sameDraft(draft.value, content)) return
  const selection = currentSelection() ?? lastSelection
  draft.value = content
  closeSuggestion()
  renderDraft(content, selection)
}

watch(() => props.modelValue, (value) => {
  if (value === undefined) return
  const next = normalizeDraft(value)
  if (isComposing.value) pendingExternalDraft = next
  else applyExternalDraft(next)
}, { deep: true })

function handleInput(event: InputEvent) {
  if (isComposing.value || event.isComposing) return
  syncNativeInput(event.inputType === 'insertText' ? event.data ?? '' : '')
}

function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd(event: CompositionEvent) {
  isComposing.value = false
  if (pendingExternalDraft !== null) {
    const content = pendingExternalDraft
    pendingExternalDraft = null
    if (sameDraft(draft.value, content)) renderDraft(content, lastSelection)
    else applyExternalDraft(content)
    return
  }
  syncNativeInput(event.data)
}

function setAgent(item: AgentInputItem | null) {
  localAgent.value = item
  emit('update:agent', item)
}

function removeAgent() {
  setAgent(null)
  focus()
}

function insertTag(item: AgentInputTag) {
  const selection = selectionOrEnd()
  closeSuggestion()
  replaceSelection(selection, [item], { focus: true })
}

function applySuggestion(content: AgentInputContent) {
  const selection = suggestion.value
  if (!selection) return false
  closeSuggestion()
  replaceSelection(selection, content, { focus: true })
  return true
}

function insertSuggestedTag(item: AgentInputTag) {
  applySuggestion([item])
}

function setSuggestedAgent(item: AgentInputItem) {
  if (applySuggestion([])) setAgent(item)
}

function closeSuggestionPanel(options?: { clearTrigger?: boolean }) {
  if (options?.clearTrigger) applySuggestion([])
  else closeSuggestion()
}

function send() {
  if (props.loading || isComposing.value) return
  const content = normalizeDraft(draft.value)
  emit('send', { text: serializeDraft(content), content, agent: agent.value && { ...agent.value } })
}

function handleAction() {
  if (props.loading) emit('stop')
  else send()
}

function hasTag(selection: DraftSelection) {
  return sliceDraft(draft.value, selection.start, selection.end).some(part => typeof part !== 'string')
}

function deleteTag(event: Event, direction: -1 | 1, selection: DraftSelection) {
  const { start, end } = selection
  const target = start !== end ? selection : {
    start: direction === -1 ? Math.max(0, start - 1) : start,
    end: direction === 1 ? start + 1 : start,
  }
  if (!hasTag(target)) return
  event.preventDefault()
  replaceSelection(target, [])
}

function handleEditorMouseDown(event: MouseEvent) {
  if (event.button === 0 && editor.value && tagFromTarget(editor.value, event.target)) event.preventDefault()
}

function handleEditorClick(event: MouseEvent) {
  if (!editor.value) return
  const item = tagFromTarget(editor.value, event.target)
  if (item) emit('tag-click', item)
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (event.target !== editor.value || isComposing.value || event.isComposing || event.keyCode === 229) return
  if (suggestion.value && event.key !== 'Escape') {
    emit('suggestion-keydown', event)
    if (event.defaultPrevented) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      closeSuggestion()
      return
    }
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) replaceSelection(selectionOrEnd(), ['\n'])
    else send()
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key === 'Backspace') deleteTag(event, -1, selectionOrEnd())
    if (event.key === 'Delete') deleteTag(event, 1, selectionOrEnd())
  }
}

function handleBeforeInput(event: InputEvent) {
  if (isComposing.value || event.isComposing || !event.cancelable) return
  if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
    event.preventDefault()
    if (event.inputType === 'insertLineBreak') replaceSelection(selectionOrEnd(), ['\n'])
    else if (suggestion.value) closeSuggestion()
    else send()
    return
  }

  if (event.inputType.startsWith('delete') && event.inputType !== 'deleteByCut') {
    let selection = selectionOrEnd()
    const target = event.getTargetRanges?.()[0]
    if (target && snapshot) {
      const start = snapshot.offsetAt(target.startContainer, target.startOffset)
      const end = snapshot.offsetAt(target.endContainer, target.endOffset)
      if (start !== undefined && end !== undefined && start !== end) selection = { start, end }
    }
    deleteTag(event, event.inputType.endsWith('Backward') ? -1 : 1, selection)
    return
  }

  if (event.inputType === 'insertText' && event.data !== null) {
    const selection = selectionOrEnd()
    if (hasTag(selection)) {
      event.preventDefault()
      replaceSelection(selection, [event.data], { typed: event.data })
    }
  }
}

function handlePaste(event: ClipboardEvent) {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain')
  if (text) replaceSelection(selectionOrEnd(), [text])
}

function handleCut(event: ClipboardEvent) {
  const selection = currentSelection()
  if (!selection || !hasTag(selection) || !event.clipboardData) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', serializeDraft(sliceDraft(draft.value, selection.start, selection.end)))
  replaceSelection(selection, [])
}

function handlePointerDown(event: PointerEvent) {
  pointerDownInside = root.value !== null && event.composedPath().includes(root.value)
  if (!pointerDownInside) closeSuggestion()
}

function clearPointerDown() {
  pointerDownInside = false
}

function handleFocusOut(event: FocusEvent) {
  if (!suggestion.value) return
  if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return
  // WebKit can blur the editor before delivering a click to a button inside the panel.
  if (!event.relatedTarget && pointerDownInside) return
  queueMicrotask(() => {
    if (!root.value?.contains(doc?.activeElement ?? null)) closeSuggestion()
  })
}

function handleEscape(event: KeyboardEvent) {
  if (!suggestion.value || isComposing.value || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  closeSuggestion()
  focus()
}

onMounted(() => {
  doc = editor.value?.ownerDocument
  renderDraft(draft.value, null)
  doc?.addEventListener('selectionchange', handleSelectionChange)
  doc?.addEventListener('pointerdown', handlePointerDown, true)
  doc?.addEventListener('pointerup', clearPointerDown, true)
  doc?.addEventListener('pointercancel', clearPointerDown, true)
})

onBeforeUnmount(() => {
  doc?.removeEventListener('selectionchange', handleSelectionChange)
  doc?.removeEventListener('pointerdown', handlePointerDown, true)
  doc?.removeEventListener('pointerup', clearPointerDown, true)
  doc?.removeEventListener('pointercancel', clearPointerDown, true)
})

defineExpose<AgentInputExpose>({ focus, setAgent, insertTag })
</script>

<template>
  <div
    ref="root"
    class="agent-input"
    :data-theme="theme"
    :style="{ '--agent-input-min-rows': minRows, '--agent-input-max-rows': maxRows }"
    @focusout="handleFocusOut"
    @keydown.esc="handleEscape"
  >
    <div v-if="suggestion && $slots.suggestion" :id="panelId" class="agent-input__suggestion">
      <slot
        name="suggestion"
        :trigger="suggestion.trigger"
        :query="suggestion.query"
        :set-agent="setSuggestedAgent"
        :insert-tag="insertSuggestedTag"
        :close="closeSuggestionPanel"
      />
    </div>

    <div v-if="$slots.header" class="agent-input__header"><slot name="header" /></div>

    <div ref="scrollArea" class="agent-input__body">
      <div v-if="agent" class="agent-input__agent">
        <img v-if="agent.img" :src="agent.img" alt="" draggable="false">
        <span class="agent-input__agent-label">@{{ agent.label }}</span>
        <button type="button" class="agent-input__remove" :aria-label="`移除智能体 ${agent.label}`" @click="removeAgent">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
        </button>
      </div>

      <div v-if="placeholder && !draft.length && !isComposing" class="agent-input__placeholder" aria-hidden="true">
        {{ placeholder }}
      </div>

      <div
        ref="editor"
        class="agent-input__editor"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        :aria-label="ariaLabel"
        :aria-placeholder="placeholder"
        :aria-controls="suggestion ? panelId : undefined"
        @mousedown="handleEditorMouseDown"
        @click="handleEditorClick"
        @keydown="handleEditorKeydown"
        @beforeinput="handleBeforeInput"
        @input="handleInput"
        @compositionstart="handleCompositionStart"
        @compositionend="handleCompositionEnd"
        @paste="handlePaste"
        @cut="handleCut"
        @drop.prevent
      ></div>
    </div>

    <div class="agent-input__footer">
      <div v-if="$slots.footer" class="agent-input__footer-content"><slot name="footer" /></div>
      <button
        type="button"
        class="agent-input__action"
        :aria-label="loading ? '停止生成' : '发送消息'"
        @click="handleAction"
      >
        <svg v-if="loading" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-5 5 5-5 5 5" /></svg>
      </button>
    </div>
  </div>
</template>

<style lang="less" src="./agent-input.less"></style>
