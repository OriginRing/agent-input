<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { draftLength, normalizeDraft, sameDraft, serializeDraft, sliceDraft } from './draft.js'
import type { DraftSelection } from './draft.js'
import { createEditorTag, readEditor, readSelection, renderEditor, restoreSelection, tagFromTarget } from './editor-dom.js'
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
  enableAtTrigger: true,
  enableSlashTrigger: true,
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
  hasTriggerText: boolean
}

interface TagEdit {
  element: HTMLButtonElement
  item: AgentInputTag
  field: HTMLSpanElement
  input: HTMLInputElement
  initialValue: string
}

interface TagSelect {
  element: HTMLButtonElement
  item: Extract<AgentInputTag, { type: 'select' }>
  start: number
  selectedIndex: number
}

const root = ref<HTMLElement | null>(null)
const scrollArea = ref<HTMLElement | null>(null)
const editor = ref<HTMLElement | null>(null)
const id = useId()
const panelId = `agent-input-suggestion-${id}`
const tagMenuId = `agent-input-tag-menu-${id}`
const tagMenu = ref<HTMLElement | null>(null)
const tagSelect = shallowRef<TagSelect | null>(null)
const activeOption = ref(0)
const draft = shallowRef(normalizeDraft(props.modelValue ?? []))
const localAgent = shallowRef<AgentInputItem | null>(null)
const agent = computed(() => props.agent === undefined ? localAgent.value : props.agent)
const suggestion = shallowRef<ActiveSuggestion | null>(null)
const isComposing = ref(false)
let snapshot: EditorSnapshot | null = null
let lastSelection: DraftSelection | null = null
let tagEdit: TagEdit | null = null
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

function isTriggerEnabled(trigger: AgentInputTrigger) {
  return trigger === '@' ? props.enableAtTrigger : props.enableSlashTrigger
}

watch([() => props.enableAtTrigger, () => props.enableSlashTrigger], () => {
  const active = suggestion.value
  if (active && !isTriggerEnabled(active.trigger)) closeSuggestion()
})

function openSuggestion(trigger: AgentInputTrigger) {
  const element = editor.value
  const scroller = scrollArea.value
  if (!isTriggerEnabled(trigger) || !slots.suggestion || !element || !scroller || !snapshot || isComposing.value) return

  finishTagEdit(true)
  closeTagSelect()
  const end = selectionOrEnd().end
  const position = { start: end, end }
  element.focus({ preventScroll: true })
  restoreSelection(scroller, snapshot, position)
  lastSelection = position
  suggestion.value = { ...position, trigger, query: '', hasTriggerText: false }
}

function updateSuggestion(selection: DraftSelection | null, insertedText?: string) {
  if (!slots.suggestion || !selection || selection.start !== selection.end) {
    closeSuggestion()
    return
  }

  const end = selection.end
  const previous = suggestion.value
  const text = insertedText ?? ''
  const triggerIndex = Math.max(text.lastIndexOf('@'), text.lastIndexOf('/'))
  const start = triggerIndex === -1 ? previous?.start : end - text.length + triggerIndex
  const trigger = triggerIndex === -1 ? previous?.trigger : text[triggerIndex] as AgentInputTrigger
  if (start === undefined || trigger === undefined) return
  if (!isTriggerEnabled(trigger)) {
    closeSuggestion()
    return
  }
  const hasTriggerText = triggerIndex !== -1 || previous?.hasTriggerText === true

  if (!hasTriggerText && insertedText === undefined && end !== previous?.end) {
    closeSuggestion()
    return
  }

  const [word = '', ...remaining] = sliceDraft(draft.value, start, end)
  if (end < start || typeof word !== 'string' || remaining.length || (hasTriggerText && word[0] !== trigger)) {
    closeSuggestion()
    return
  }

  const query = hasTriggerText ? word.slice(1) : word
  if (/[\s@/]/u.test(query)) {
    closeSuggestion()
    return
  }

  if (previous?.start !== start || previous.end !== end || previous.trigger !== trigger ||
    previous.query !== query || previous.hasTriggerText !== hasTriggerText) {
    suggestion.value = { start, end, trigger, query, hasTriggerText }
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
  closeTagSelect()
  tagEdit = null
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
  updateSuggestion(position, options.typed ?? '')
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
  finishTagEdit(true)
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
  finishTagEdit(true)
  closeTagSelect()
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

function finishTagEdit(save: boolean) {
  const element = editor.value
  const edit = tagEdit
  if (!element || !edit) return
  tagEdit = null

  const { field, input, item, initialValue } = edit
  const changed = save && input.value !== initialValue
  const tag = changed ? createEditorTag(element.ownerDocument, { ...item, value: input.value }) : edit.element
  field.replaceWith(tag)
  snapshot = readEditor(element)
  if (changed && commitDraft(snapshot.content)) emit('update:modelValue', normalizeDraft(draft.value))
}

function editTag(element: HTMLButtonElement, item: AgentInputTag) {
  const start = snapshot?.offsetAt(element, 0)
  if (start === undefined) return
  closeSuggestion()
  lastSelection = { start: start + 1, end: start + 1 }

  const doc = element.ownerDocument
  const field = doc.createElement('span')
  field.className = 'agent-input__tag-edit'
  field.contentEditable = 'false'

  const input = doc.createElement('input')
  input.type = 'text'
  input.className = 'agent-input__tag-input'
  input.setAttribute('aria-label', `编辑标签 ${item.label}`)
  input.placeholder = item.label
  input.value = item.value
  field.dataset.text = input.value || input.placeholder
  field.append(input)
  tagEdit = { element, item, field, input, initialValue: input.value }

  // The native input edits the value without passing its editing events to the draft editor.
  for (const name of ['beforeinput', 'compositionstart', 'compositionend', 'paste', 'cut', 'drop']) {
    input.addEventListener(name, event => event.stopPropagation())
  }
  input.addEventListener('input', event => {
    event.stopPropagation()
    field.dataset.text = input.value || input.placeholder
  })
  input.addEventListener('blur', () => {
    if (tagEdit?.input === input) finishTagEdit(true)
  })
  input.addEventListener('keydown', event => {
    if (tagEdit?.input !== input || event.isComposing || event.keyCode === 229) return
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    finishTagEdit(event.key === 'Enter')
    focus()
  })

  element.replaceWith(field)
  input.focus({ preventScroll: true })
  input.select()
}

function closeTagSelect(restoreFocus = false) {
  const select = tagSelect.value
  if (!select) return
  tagSelect.value = null
  select.element.setAttribute('aria-expanded', 'false')
  select.element.removeAttribute('aria-controls')
  if (restoreFocus) select.element.focus({ preventScroll: true })
}

function positionTagMenu(event?: Event) {
  const select = tagSelect.value
  const menu = tagMenu.value
  const container = root.value
  const scroller = scrollArea.value
  if (!select || !menu || !container || !scroller || event?.target === menu) return

  const anchor = select.element.getBoundingClientRect()
  const body = scroller.getBoundingClientRect()
  const viewport = container.ownerDocument.documentElement
  const gap = 4
  const gutter = 8
  if (anchor.bottom <= Math.max(0, body.top) || anchor.top >= Math.min(viewport.clientHeight, body.bottom)) {
    closeTagSelect()
    return
  }

  const bounds = container.getBoundingClientRect()
  const below = viewport.clientHeight - anchor.bottom - gap - gutter
  const above = anchor.top - gap - gutter
  const maxWidth = viewport.clientWidth - gutter * 2
  menu.style.maxWidth = `${maxWidth}px`
  menu.style.minWidth = `${Math.min(anchor.width, maxWidth)}px`
  menu.style.removeProperty('--agent-input-tag-menu-room')
  const upwards = below < menu.offsetHeight && above > below
  menu.style.setProperty('--agent-input-tag-menu-room', `${Math.max(0, upwards ? above : below)}px`)
  const left = Math.max(gutter, Math.min(anchor.left, viewport.clientWidth - menu.offsetWidth - gutter))
  const top = upwards ? anchor.top - gap - menu.offsetHeight : anchor.bottom + gap
  menu.style.left = `${left - bounds.left - container.clientLeft}px`
  menu.style.top = `${top - bounds.top - container.clientTop}px`
}

function openTagSelect(element: HTMLButtonElement, item: TagSelect['item']) {
  const start = snapshot?.offsetAt(element, 0)
  if (start === undefined || !item.options.length) return
  closeSuggestion()
  closeTagSelect()
  lastSelection = { start: start + 1, end: start + 1 }
  const selectedIndex = item.options.findIndex(option => option.value === item.value)
  const select = { element, item, start, selectedIndex }
  activeOption.value = Math.max(0, selectedIndex)
  tagSelect.value = select
  element.setAttribute('aria-expanded', 'true')
  element.setAttribute('aria-controls', tagMenuId)
  void nextTick(() => {
    if (tagSelect.value !== select) return
    positionTagMenu()
    if (!tagSelect.value) return
    tagMenu.value?.focus({ preventScroll: true })
    scrollToActiveOption()
  })
}

function setTagOption(index: number) {
  const select = tagSelect.value
  if (!select) return
  closeTagSelect()
  const { start, item } = select
  replaceSelection({ start, end: start + 1 }, [{ ...item, value: item.options[index].value }], { focus: true })
}

function scrollToActiveOption() {
  tagMenu.value?.children[activeOption.value]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function handleTagMenuKeydown(event: KeyboardEvent) {
  const select = tagSelect.value
  if (!select) return
  const count = select.item.options.length
  switch (event.key) {
    case 'Escape':
      closeTagSelect(true)
      break
    case 'Enter':
    case ' ':
      setTagOption(activeOption.value)
      break
    case 'ArrowDown':
      activeOption.value = (activeOption.value + 1) % count
      break
    case 'ArrowUp':
      activeOption.value = (activeOption.value + count - 1) % count
      break
    case 'Home':
      activeOption.value = 0
      break
    case 'End':
      activeOption.value = count - 1
      break
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
  if (tagSelect.value) scrollToActiveOption()
}

function handleEditorClick(event: MouseEvent) {
  if (!editor.value) return
  const tag = tagFromTarget(editor.value, event.target)
  if (!tag) return
  finishTagEdit(true)
  if (tagSelect.value?.element === tag.element) closeTagSelect(true)
  else if (tag.item.type === 'select') openTagSelect(tag.element, tag.item)
  else if (tag.item.type === 'input') editTag(tag.element, tag.item)
  emit('tag-click', tag.item)
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (isComposing.value || event.isComposing || event.keyCode === 229) return
  if (event.target !== editor.value) {
    if (!editor.value || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    const tag = tagFromTarget(editor.value, event.target)
    if (tag?.item.type === 'select') {
      event.preventDefault()
      openTagSelect(tag.element, tag.item)
    }
    return
  }
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
  const path = event.composedPath()
  pointerDownInside = root.value !== null && path.includes(root.value)
  if (!pointerDownInside) closeSuggestion()
  if (tagSelect.value && !path.includes(tagSelect.value.element) &&
    (!tagMenu.value || !path.includes(tagMenu.value))) closeTagSelect()
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
  doc?.addEventListener('scroll', positionTagMenu, true)
  doc?.defaultView?.addEventListener('resize', positionTagMenu)
})

onBeforeUnmount(() => {
  tagEdit = null
  doc?.removeEventListener('selectionchange', handleSelectionChange)
  doc?.removeEventListener('pointerdown', handlePointerDown, true)
  doc?.removeEventListener('pointerup', clearPointerDown, true)
  doc?.removeEventListener('pointercancel', clearPointerDown, true)
  doc?.removeEventListener('scroll', positionTagMenu, true)
  doc?.defaultView?.removeEventListener('resize', positionTagMenu)
})

defineExpose<AgentInputExpose>({ focus, openSuggestion, setAgent, insertTag })
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

    <div
      v-if="tagSelect"
      :id="tagMenuId"
      ref="tagMenu"
      class="agent-input__tag-menu"
      role="listbox"
      tabindex="-1"
      :aria-label="tagSelect.item.label"
      :aria-activedescendant="`${tagMenuId}-${activeOption}`"
      @keydown="handleTagMenuKeydown"
      @focusout="closeTagSelect()"
    >
      <div
        v-for="(option, index) in tagSelect.item.options"
        :id="`${tagMenuId}-${index}`"
        :key="option.value"
        class="agent-input__tag-option"
        role="option"
        :aria-selected="index === tagSelect.selectedIndex"
        :data-active="index === activeOption"
        @pointerenter="activeOption = index"
        @mousedown.prevent
        @click="setTagOption(index)"
      >{{ option.label }}</div>
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
