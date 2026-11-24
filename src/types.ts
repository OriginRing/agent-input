export interface AgentInputItem {
  label: string
  value: string
  img?: string
}

export interface AgentInputTagOption {
  label: string
  value: string
}

export type AgentInputTag = (AgentInputItem & { color?: string }) & (
  | { type?: 'tag' }
  | { type: 'input' }
  | { type: 'select'; options: AgentInputTagOption[] }
)

export type AgentInputContent = Array<string | AgentInputTag>
export type AgentInputTheme = 'light' | 'dark'
export type AgentInputTrigger = '@' | '/'

export interface AgentInputProps {
  modelValue?: AgentInputContent
  agent?: AgentInputItem | null
  theme?: AgentInputTheme
  minRows?: number
  maxRows?: number
  placeholder?: string
  ariaLabel?: string
  loading?: boolean
}

export interface AgentInputSendPayload {
  text: string
  content: AgentInputContent
  agent: AgentInputItem | null
}

export interface AgentInputExpose {
  focus(): void
  openSuggestion(trigger: AgentInputTrigger): void
  setAgent(item: AgentInputItem | null): void
  insertTag(item: AgentInputTag): void
}

export interface AgentInputSuggestion {
  trigger: AgentInputTrigger
  query: string
  setAgent(item: AgentInputItem): void
  insertTag(item: AgentInputTag): void
  close(options?: { clearTrigger?: boolean }): void
}
