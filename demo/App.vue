<script setup lang="ts">
import { nextTick, ref, shallowRef } from 'vue'
import { AgentInput } from '../src'
import type { AgentInputContent, AgentInputExpose, AgentInputItem, AgentInputSendPayload, AgentInputSuggestion, AgentInputTag, AgentInputTheme } from '../src'
import SuggestionMenu from './SuggestionMenu.vue'

const agents: AgentInputItem[] = [
  { label: '通用助手', value: 'general' },
  { label: '研究助手', value: 'research' },
  { label: '代码助手', value: 'coding' },
]

const tags: AgentInputTag[] = [
  { label: '季度报告', value: 'report.pdf', color: 'var(--demo-report-label)' },
  { label: '参考链接', value: 'reference.url' },
  { label: '选中内容', value: 'selection' },
]

const connectors: AgentInputItem[] = [
  { label: 'GitHub', value: 'github' },
  { label: 'Notion', value: 'notion' },
  { label: 'Google Drive', value: 'google-drive' },
]

const mentionGroups = [
  {
    id: 'add', label: '添加', items: [
      { label: '上传文件', value: 'file' },
      { label: '上传文件夹', value: 'folder' },
    ],
  },
  { id: 'agent', label: '智能体', items: agents },
  { id: 'connector', label: '连接器', items: connectors },
]
const tagGroups = [{ id: 'tag', label: '插入正文标签', items: tags }]

const composer = ref<AgentInputExpose | null>(null)
const menu = ref<InstanceType<typeof SuggestionMenu> | null>(null)
const filePicker = ref<HTMLInputElement | null>(null)
const theme = ref<AgentInputTheme>('light')
const content = ref<AgentInputContent>([])
const agent = ref<AgentInputItem | null>(agents[0])
const selectedConnectors = ref<AgentInputItem[]>([])
const loading = ref(false)
const lastSend = shallowRef<AgentInputSendPayload | null>(null)
const lastTagClick = shallowRef<AgentInputTag | null>(null)
const sendCount = ref(0)
const stopCount = ref(0)

function handleSuggestion(item: AgentInputTag, group: string, suggestion: AgentInputSuggestion) {
  if (group === 'add') {
    const picker = filePicker.value
    if (!picker) return
    const isFolder = item.value === 'folder'
    picker.webkitdirectory = isFolder
    picker.multiple = isFolder
    suggestion.close({ clearTrigger: true })
    picker.click()
  } else if (group === 'agent') {
    suggestion.setAgent(item)
  } else if (group === 'tag') {
    suggestion.insertTag(item)
  } else if (group === 'connector') {
    if (!selectedConnectors.value.some(connector => connector.value === item.value)) {
      selectedConnectors.value.push(item)
    }
    suggestion.close({ clearTrigger: true })
  }
}

function handleFileSelection(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  for (const file of input.files ?? []) console.log(file)
  input.value = ''
}

function removeConnector(value: string) {
  selectedConnectors.value = selectedConnectors.value.filter(connector => connector.value !== value)
  composer.value?.focus()
}

function fillExample() {
  content.value = ['请读一下', tags[0], '，再打开', tags[1], '。']
}

async function clearDraft() {
  content.value = []
  await nextTick()
  composer.value?.focus()
}

function handleSend(payload: AgentInputSendPayload) {
  lastSend.value = payload
  sendCount.value++
  loading.value = true
  content.value = []
}

function handleStop() {
  stopCount.value++
  loading.value = false
}
</script>

<template>
  <div class="demo" :data-theme="theme">
    <main class="demo__main">
      <header class="demo__heading">
        <div>
          <h1>智能体输入框</h1>
          <p>输入 <kbd>@</kbd> 查看添加选项、智能体和连接器，输入 <kbd>/</kbd> 插入正文标签。</p>
        </div>
        <div class="demo__tools">
          <button class="demo__button" type="button" @click="composer?.openSuggestion('@')">打开 @ 候选</button>
          <button class="demo__button" type="button" @click="composer?.openSuggestion('/')">打开 / 候选</button>
          <button class="demo__button" type="button" @click="theme = theme === 'light' ? 'dark' : 'light'">
            {{ theme === 'light' ? '深色主题' : '浅色主题' }}
          </button>
        </div>
      </header>

      <div class="demo__stage">
        <input ref="filePicker" type="file" hidden @change="handleFileSelection">
        <AgentInput
          ref="composer"
          v-model="content"
          v-model:agent="agent"
          :theme="theme"
          :loading="loading"
          :min-rows="2"
          :max-rows="5"
          placeholder="输入消息…"
          @send="handleSend"
          @stop="handleStop"
          @tag-click="lastTagClick = $event"
          @suggestion-keydown="menu?.handleKeydown($event)"
        >
          <template #header>
            <div class="demo__tools">
              <button type="button" class="demo__button" @click="fillExample">填入示例</button>
              <button type="button" class="demo__button" @click="clearDraft">清空正文</button>
            </div>
            <ul v-if="selectedConnectors.length" class="demo__connectors" role="list" aria-label="已选连接器">
              <li v-for="connector in selectedConnectors" :key="connector.value">
                <span>{{ connector.label }}</span>
                <button type="button" :aria-label="`移除连接器 ${connector.label}`" @click="removeConnector(connector.value)">
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            </ul>
          </template>
          <template #suggestion="suggestion">
            <SuggestionMenu
              :key="suggestion.trigger"
              ref="menu"
              :groups="suggestion.trigger === '@' ? mentionGroups : tagGroups"
              :query="suggestion.query"
              @select="(item, group) => handleSuggestion(item, group, suggestion)"
            />
          </template>
          <template #footer>
            <div class="demo__tools">
              <button type="button" class="demo__button" @click="composer?.insertTag(tags[0])">插入报告标签</button>
              <span class="demo__shortcut"><kbd>Shift</kbd> + <kbd>Enter</kbd> 换行</span>
            </div>
          </template>
        </AgentInput>
      </div>

      <section class="demo__result" aria-labelledby="result-heading">
        <header>
          <h2 id="result-heading">最近一次发送</h2>
          <span aria-live="polite">发送 {{ sendCount }} 次 · 停止 {{ stopCount }} 次</span>
        </header>
        <pre v-if="lastSend" data-testid="payload">{{ JSON.stringify(lastSend, null, 2) }}</pre>
        <p v-else>点击发送按钮或按 Enter 查看事件载荷。</p>
      </section>

      <section v-if="lastTagClick" class="demo__result demo__tag-result" aria-labelledby="tag-result-heading">
        <h2 id="tag-result-heading">最近点击的标签</h2>
        <pre data-testid="tag-item">{{ JSON.stringify(lastTagClick, null, 2) }}</pre>
      </section>
    </main>
  </div>
</template>

<style lang="less" src="./demo.less"></style>
