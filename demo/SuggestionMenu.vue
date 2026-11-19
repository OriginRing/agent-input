<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AgentInputTag } from '../src'

const props = defineProps<{ items: AgentInputTag[]; query: string; title: string }>()
const emit = defineEmits<{ select: [item: AgentInputTag] }>()
const active = ref(0)
const list = ref<HTMLUListElement | null>(null)

watch(() => [props.title, props.query], () => { active.value = 0 })

function handleKeydown(event: KeyboardEvent) {
  if (!props.items.length) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    emit('select', props.items[active.value])
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    active.value = (active.value + direction + props.items.length) % props.items.length
    list.value?.children[active.value]?.scrollIntoView({ block: 'nearest' })
  }
}

defineExpose({ handleKeydown })
</script>

<template>
  <section class="demo-suggestions" :aria-label="title">
    <p>{{ title }}</p>
    <ul v-if="items.length" ref="list">
      <li v-for="(item, index) in items" :key="item.value">
        <button type="button" :data-active="index === active" @click="emit('select', item)">
          <span>{{ item.label }}</span>
          <small>{{ item.value }}</small>
        </button>
      </li>
    </ul>
    <p v-else>没有匹配项</p>
  </section>
</template>
