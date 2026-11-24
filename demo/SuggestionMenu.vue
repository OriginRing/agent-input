<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentInputTag } from '../src'

interface SuggestionItem extends AgentInputTag {
  disabled?: boolean
}

interface SuggestionGroup {
  id: string
  label: string
  items: SuggestionItem[]
}

const props = defineProps<{ groups: SuggestionGroup[]; query: string }>()
const emit = defineEmits<{ select: [item: AgentInputTag, group: string] }>()
const active = ref(0)
const menu = ref<HTMLElement | null>(null)

const filteredGroups = computed(() => {
  const query = props.query.toLowerCase()
  return props.groups.map(group => ({
    ...group,
    items: group.items.filter(item => item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query)),
  })).filter(group => group.items.length)
})
const selectable = computed(() => filteredGroups.value.flatMap(group => group.items
  .filter(item => !item.disabled)
  .map(item => ({ group: group.id, item }))))

watch(selectable, items => {
  active.value = Math.max(0, items.findIndex(({ group }) => group !== 'add'))
}, { immediate: true })

function handleKeydown(event: KeyboardEvent) {
  const count = selectable.value.length
  if (!count) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    const { item, group } = selectable.value[active.value]
    emit('select', item, group)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    active.value = (active.value + direction + count) % count
    menu.value?.querySelectorAll('button:not(:disabled)')[active.value]?.scrollIntoView({ block: 'nearest' })
  }
}

defineExpose({ handleKeydown })
</script>

<template>
  <section ref="menu" class="demo-suggestions" :aria-label="groups.length > 1 ? '候选菜单' : groups[0]?.label">
    <div v-for="group in filteredGroups" :key="group.id" class="demo-suggestions__group" role="group" :aria-label="group.label">
      <p>{{ group.label }}</p>
      <ul class="demo-suggestions__options">
        <li v-for="item in group.items" :key="item.value">
          <button
            type="button"
            :disabled="item.disabled"
            :data-active="item === selectable[active]?.item && group.id === selectable[active]?.group"
            @click="emit('select', item, group.id)"
          >
            <span class="demo-suggestions__label">
              <svg v-if="group.id === 'add'" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path v-if="item.value === 'file'" d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10m-7-7 7 7m-7-7v7h7m-8 7v-4m-2 2h4" />
                <path v-else d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm9 4v6m-3-3h6" />
              </svg>
              {{ item.label }}
            </span>
            <small v-if="group.id !== 'add' && !item.disabled">{{ item.value }}</small>
          </button>
        </li>
      </ul>
    </div>
    <p v-if="!filteredGroups.length">没有匹配项</p>
  </section>
</template>
