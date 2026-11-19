<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { AgentInput } from '../src'
import type { AgentInputContent, AgentInputExpose, AgentInputItem, AgentInputSendPayload, AgentInputTag, AgentInputTheme } from '../src'
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

const composer = ref<AgentInputExpose | null>(null)
const menu = ref<InstanceType<typeof SuggestionMenu> | null>(null)
const theme = ref<AgentInputTheme>('light')
const content = ref<AgentInputContent>([])
const agent = ref<AgentInputItem | null>(agents[0])
const loading = ref(false)
const lastSend = shallowRef<AgentInputSendPayload | null>(null)
const sendCount = ref(0)
const stopCount = ref(0)

function filterItems(items: AgentInputTag[], query: string) {
  const keyword = query.toLowerCase()
  return items.filter(item => item.label.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword))
}

function fillExample() {
  content.value = ['请读一下', tags[0], '，再打开', tags[1], '。']
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
          <p>输入 <kbd>@</kbd> 选择智能体，输入 <kbd>/</kbd> 插入正文标签。</p>
        </div>
        <button class="demo__button" type="button" @click="theme = theme === 'light' ? 'dark' : 'light'">
          {{ theme === 'light' ? '深色主题' : '浅色主题' }}
        </button>
      </header>

      <div class="demo__stage">
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
          @suggestion-keydown="menu?.handleKeydown($event)"
        >
          <template #header>
            <div class="demo__tools">
              <button type="button" class="demo__button" @click="fillExample">填入示例</button>
              <button type="button" class="demo__button" @click="content = []">清空正文</button>
            </div>
          </template>
          <template #suggestion="{ trigger, query, setAgent, insertTag }">
            <SuggestionMenu
              ref="menu"
              :title="trigger === '@' ? '选择智能体' : '插入正文标签'"
              :query="query"
              :items="filterItems(trigger === '@' ? agents : tags, query)"
              @select="trigger === '@' ? setAgent($event) : insertTag($event)"
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
    </main>
  </div>
</template>

<style lang="less" src="./demo.less"></style>
