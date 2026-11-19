# Vue Agent Input

支持智能体选择、原子标签和自定义上拉面板的 Vue 3 输入框。样式使用 Less 构建，消费端直接导入编译好的 CSS。

## 安装与使用

本地执行 `npm pack` 生成 `vue-agent-input-0.1.0.tgz`，在 Vue 3.5+ 项目中安装该文件。

```sh
npm install /path/to/vue-agent-input-0.1.0.tgz
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { AgentInput } from 'vue-agent-input'
import type { AgentInputContent, AgentInputItem, AgentInputSendPayload, AgentInputTag } from 'vue-agent-input'
import 'vue-agent-input/style.css'

const draft = ref<AgentInputContent>([])
const agent = ref<AgentInputItem | null>(null)
const loading = ref(false)
const researcher = { label: '研究助手', value: 'research' }
const report: AgentInputTag = { label: '季度报告', value: 'report.pdf', color: '#a23c1f' }

function send(payload: AgentInputSendPayload) {
  console.log(payload.text, payload.content, payload.agent)
  draft.value = []
  loading.value = true
}
</script>

<template>
  <AgentInput
    v-model="draft"
    v-model:agent="agent"
    :loading="loading"
    :min-rows="2"
    :max-rows="6"
    @send="send"
    @stop="loading = false"
  >
    <template #header>消息草稿</template>
    <template #suggestion="{ trigger, query, setAgent, insertTag }">
      <button v-if="trigger === '@' && researcher.label.includes(query)" type="button" @click="setAgent(researcher)">
        {{ researcher.label }}
      </button>
      <button v-else-if="trigger === '/' && report.label.includes(query)" type="button" @click="insertTag(report)">
        {{ report.label }}
      </button>
    </template>
  </AgentInput>
</template>
```

## 属性

| 属性 | 类型 | 默认值或用途 |
| --- | --- | --- |
| `v-model` | `Array<string \| AgentInputTag>` | `[]`，按顺序保存文本和标签。 |
| `v-model:agent` | `AgentInputItem \| null` | `null`，独立保存头部唯一的智能体。 |
| `theme` | `'light' \| 'dark'` | `'light'`。 |
| `minRows` / `maxRows` | `number` | `2` / `6`。达到最大行数后正文滚动。 |
| `placeholder` | `string` | `'输入消息'`。 |
| `ariaLabel` | `string` | `'消息正文'`。 |
| `loading` | `boolean` | `false`。开启后发送按钮切换为停止按钮。 |

`AgentInputItem` 包含 `label`、`value` 和可选的 `img` 图片地址。正文的 `AgentInputTag` 还接受可选的 `color`，用于设置标签文字的 CSS 颜色。可以在组件根元素覆盖 `--agent-input-surface`、`--agent-input-text`、`--agent-input-tag-color` 等主题变量。

## 插槽与方法

- `#header` 在正文区域上方渲染，`#footer` 在发送按钮左侧渲染。头部智能体放在正文第一行开头，后续行使用完整正文宽度。
- `#suggestion` 接收 `{ trigger, query, setAgent, insertTag, close }`。面板优先向上展开，上方空间不足且下方更宽裕时向下展开。调用方决定候选数据、筛选和列表内容。两个选择方法都会替换当前触发符及查询词，操作完成后恢复正文焦点。`close()` 保留已输入的文字。
- `suggestion-keydown` 在面板打开时提供正文的 `KeyboardEvent`。调用方接管方向键或 Enter 时调用 `event.preventDefault()`。未处理的 Enter 关闭面板。Escape 关闭面板，Shift+Enter 换行。
- 通过 `ref<AgentInputExpose>()` 可调用 `focus()`、`setAgent(itemOrNull)` 和 `insertTag(tag)`。ref 上的 `setAgent` 直接设置头部智能体。ref 上的 `insertTag` 替换当前或最近一次正文选区，尚无选区时在末尾追加。

## 发送与停止

普通状态下点击发送或按 Enter 触发 `send({ text, content, agent })`。空内容也会触发发送并返回空字符串和空数组。标签在 `text` 中使用 `value`，遇相邻非空白文字或标签时补一个空格。`content` 保留标签的展示数据和顺序，头部智能体通过 `agent` 单独提供。发送后可清空正文并继续使用同一个智能体。

`loading` 开启时点击停止按钮触发 `stop`。由调用方结束请求并关闭 `loading`。

## 本地开发

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm run build:demo
npx playwright install chromium webkit
npm test
```
