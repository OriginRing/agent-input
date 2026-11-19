# Vue Agent Input

面向智能体和聊天产品的 Vue 3 输入框。支持 `@` 智能体选择、`/` 正文标签、自定义候选面板，以及发送和停止事件。正文可以混排文本与可点击标签，使用 `v-model` 保存和回填草稿。

## 安装

需要 Vue 3.5 或更新的 Vue 3 版本。包以 ESM 发布，附带 TypeScript 声明和编译好的 CSS。

```sh
npm install vue-agent-input
```

## 快速开始

从 `vue-agent-input` 导入组件，并在应用中导入一次 `vue-agent-input/style.css`。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { AgentInput } from 'vue-agent-input'
import type { AgentInputContent, AgentInputSendPayload } from 'vue-agent-input'
import 'vue-agent-input/style.css'

const draft = ref<AgentInputContent>([])

function handleSend({ text }: AgentInputSendPayload) {
  console.log(text)
  draft.value = []
}
</script>

<template>
  <AgentInput v-model="draft" placeholder="输入消息…" @send="handleSend" />
</template>
```

在正文中按 Enter 发送，按 Shift+Enter 换行。空草稿也会触发 `send`，此时 `text` 为 `''`，`content` 为 `[]`。草稿由调用方清空，智能体通过 `v-model:agent` 独立管理。

## 自定义 `@` 和 `/` 候选

提供 `#suggestion` 插槽后，输入 `@` 或 `/` 会在组件内展开候选。插槽提供触发符和查询词，候选数据与筛选逻辑由调用方提供。下面的示例用 `@` 选择智能体，用 `/` 在光标处插入正文标签。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { AgentInput } from 'vue-agent-input'
import type { AgentInputContent, AgentInputItem, AgentInputTag } from 'vue-agent-input'
import 'vue-agent-input/style.css'

const draft = ref<AgentInputContent>([])
const agent = ref<AgentInputItem | null>(null)
const agents: AgentInputItem[] = [{ label: '研究助手', value: 'research' }]
const tags: AgentInputTag[] = [{ label: '季度报告', value: 'report.pdf' }]

function filterCandidates(items: AgentInputItem[], query: string) {
  const keyword = query.toLowerCase()
  return items.filter(item =>
    item.label.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword),
  )
}

function handleTagClick(item: AgentInputTag) {
  console.log(item.value)
}
</script>

<template>
  <AgentInput v-model="draft" v-model:agent="agent" @tag-click="handleTagClick">
    <template #suggestion="{ trigger, query, setAgent, insertTag }">
      <button
        v-for="item in filterCandidates(trigger === '@' ? agents : tags, query)"
        :key="item.value"
        type="button"
        @click="trigger === '@' ? setAgent(item) : insertTag(item)"
      >
        {{ item.label }}
      </button>
    </template>
  </AgentInput>
</template>
```

`setAgent(item)` 和 `insertTag(item)` 都会移除当前触发符及查询词，并恢复正文焦点。`close()` 收起面板并保留已输入的文字。`close({ clearTrigger: true })` 适用于连接器等自定义候选，会移除触发符及查询词并恢复焦点。

按 Escape 关闭候选面板。需要自定义方向键或 Enter 选择时，监听 `suggestion-keydown`，并对接管的按键调用 `event.preventDefault()`。面板打开时，未接管的 Enter 会收起面板。

## 正文标签与发送数据

`AgentInputContent` 由字符串和 `AgentInputTag` 按顺序组成。标签的 `label` 用于显示，`img` 和 `color` 分别设置可选图片和文字颜色。使用 Backspace 或 Delete 可以整块删除相邻标签。

`send` 的参数为 `{ text, content, agent }`。`text` 是可提交的纯文本，`content` 保留标签对象和顺序，`agent` 是当前智能体或 `null`。序列化时，标签展开为 `value`，和相邻内容之间缺少空白时会补一个空格。下面的草稿会生成 `请看 report.pdf 谢谢`。

```ts
import type { AgentInputContent } from 'vue-agent-input'

const draft: AgentInputContent = [
  '请看',
  { label: '季度报告', value: 'report.pdf' },
  '谢谢',
]
```

## API

### Props

| Prop | 类型 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `modelValue` | `AgentInputContent` | `[]` | 通过 `v-model` 绑定草稿。 |
| `agent` | `AgentInputItem \| null` | `null` | 通过 `v-model:agent` 绑定正文首行的智能体。`AgentInputItem` 包含 `label`、`value` 和可选的 `img`。 |
| `theme` | `'light' \| 'dark'` | `'light'` | 选择浅色或深色主题。 |
| `minRows` | `number` | `2` | 正文最少显示的行数。 |
| `maxRows` | `number` | `6` | 正文最多显示的行数，超出时在正文区域内滚动。 |
| `placeholder` | `string` | `'输入消息'` | 正文为空时显示的提示。 |
| `ariaLabel` | `string` | `'消息正文'` | 编辑区的无障碍名称。 |
| `loading` | `boolean` | `false` | 将发送按钮切换为停止按钮。 |

### 事件

| 事件 | 回调参数 | 触发时机 |
| --- | --- | --- |
| `send` | `AgentInputSendPayload` | 点击发送按钮，或在正文中按 Enter 发送。 |
| `stop` | — | `loading` 为 `true` 时点击停止按钮。 |
| `tag-click` | `AgentInputTag` | 点击正文标签，或在标签聚焦时按 Enter 或空格。 |
| `suggestion-keydown` | `KeyboardEvent` | 候选面板打开时收到的正文按键。 |
| `update:modelValue` | `AgentInputContent` | 草稿更新，对应 `v-model`。 |
| `update:agent` | `AgentInputItem \| null` | 选择或移除智能体，对应 `v-model:agent`。 |

接入流式请求时，调用方设置 `loading`，在 `stop` 回调中取消请求，并在请求结束后将 `loading` 恢复为 `false`。

### 插槽

| 插槽 | 位置和用途 |
| --- | --- |
| `header` | 位于正文上方，可放工具栏或已选连接器。 |
| `footer` | 填满发送按钮左侧的可用宽度，两者相隔 `0.5rem`。 |
| `suggestion` | 位于组件内部的 `header` 上方。接收 `{ trigger, query, setAgent, insertTag, close }`，类型为 `AgentInputSuggestion`。最大高度为 `min(16rem, 50dvh)`，超出时在面板内滚动。 |

### 实例方法

通过 `ref<AgentInputExpose | null>(null)` 获取组件实例。

| 方法 | 用途 |
| --- | --- |
| `focus()` | 将焦点移回正文。 |
| `setAgent(item)` | 设置首行智能体，传 `null` 清除。 |
| `insertTag(item)` | 用标签替换当前或最近的正文选区，未建立选区时追加到末尾。 |

## 主题与样式

使用 `theme="dark"` 切换到深色主题。正文标签默认文字色为 `#06f`，背景透明，在悬停或键盘聚焦时显示背景。可在组件根元素上覆盖 CSS 变量，也可通过单个标签的 `color` 设置文字颜色。

```vue
<AgentInput
  theme="dark"
  style="--agent-input-tag-color: #8ab4ff; --agent-input-tag-background: #303846"
/>
```

常用变量还有 `--agent-input-surface`、`--agent-input-text`、`--agent-input-border` 和 `--agent-input-focus`。

## 本地开发

```sh
npm install
npm run dev
npm run typecheck
npm run build:demo
npx playwright install chromium webkit
npm test
```

运行 `npm pack` 会先构建组件库，再生成包含 JavaScript、CSS、类型声明和 `LICENSE` 的本地安装包。

## 许可证

MIT © 2026 originRing
