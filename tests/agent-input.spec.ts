import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const textbox = (page: Page) => page.getByRole('textbox', { name: '消息正文' })
const button = (page: Page, name: string) => page.getByRole('button', { name })
const panel = (page: Page) => page.locator('.agent-input__suggestion')
const tags = (page: Page) => textbox(page).locator('.agent-input__tag')
const report = { label: '季度报告', value: 'report.pdf', color: 'var(--demo-report-label)' }

async function expectPayload(page: Page, payload: Record<string, unknown>) {
  const result = page.getByTestId('payload')
  await expect(result).toBeVisible()
  await expect.poll(async () => JSON.parse(await result.innerText())).toMatchObject(payload)
}

async function placeBesideTag(tag: Locator, edge: 'before' | 'after') {
  await tag.evaluate((element, side) => {
    const range = document.createRange()
    element.parentElement!.focus()
    if (side === 'before') range.setStartBefore(element)
    else range.setStartAfter(element)
    range.collapse(true)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  }, edge)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('places the agent beside the first line and gives subsequent lines the full editor width', async ({ page }) => {
  const editor = textbox(page)
  const agent = page.locator('.agent-input__agent')
  await editor.focus()
  await page.keyboard.insertText('测试文本')
  await editor.press('Shift+Enter')
  await page.keyboard.insertText('第二行正文')

  const glyph = (character: string) => editor.evaluate((element, value) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent!.indexOf(value)
      if (offset === -1) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + value.length)
      const { x, y, height } = range.getBoundingClientRect()
      return { x, y, height }
    }
    throw new Error(`Missing character ${value}`)
  }, character)

  const chip = (await agent.boundingBox())!
  const first = await glyph('测')
  const second = await glyph('第')
  expect(first.x).toBeGreaterThan(chip.x + chip.width)
  expect(first.y + first.height / 2).toBeLessThan(chip.y + chip.height)
  expect(Math.abs(second.x - chip.x)).toBeLessThan(1)
  expect(second.y).toBeGreaterThan(first.y)

  await button(page, '移除智能体 通用助手').click()
  expect(Math.abs((await glyph('测')).x - chip.x)).toBeLessThan(1)
  await expect(editor).toBeFocused()
  await editor.press('Enter')
  await expectPayload(page, { text: '测试文本\n第二行正文', agent: null })
})

test('keeps the empty caret between the agent and placeholder before and after clearing', async ({ page }) => {
  const editor = textbox(page)
  const agent = page.locator('.agent-input__agent')
  const placeholder = page.locator('.agent-input__placeholder')

  async function expectEmptyCaret() {
    await expect(editor).toBeFocused()
    await expect(placeholder).toBeVisible()
    const hint = (await placeholder.boundingBox())!
    const chip = await agent.count() ? await agent.boundingBox() : null
    await expect.poll(async () => editor.evaluate((element, position) => {
      const selection = element.ownerDocument.getSelection()
      if (!selection?.rangeCount || !selection.isCollapsed || !element.contains(selection.anchorNode)) return false
      const caret = selection.getRangeAt(0).getBoundingClientRect()
      return caret.height > 0 && caret.x >= position.chipEnd &&
        Math.abs(caret.x - position.hintStart) < 1 && Math.abs(caret.y - position.hintTop) < caret.height
    }, { chipEnd: chip ? chip.x + chip.width : hint.x, hintStart: hint.x, hintTop: hint.y })).toBe(true)
  }

  await editor.click({ position: { x: 240, y: 12 } })
  await expectEmptyCaret()
  await button(page, '插入报告标签').click()
  await button(page, '插入报告标签').click()
  await expect(tags(page)).toHaveCount(2)
  await button(page, '清空正文').click()
  await expect(tags(page)).toHaveCount(0)
  await expectEmptyCaret()

  await page.keyboard.insertText('文')
  await editor.press('Backspace')
  await expectEmptyCaret()
  await page.keyboard.insertText('重新输入')
  await editor.press('Enter')
  await expectPayload(page, { text: '重新输入', content: ['重新输入'], agent: { value: 'general' } })
  await expectEmptyCaret()

  await button(page, '移除智能体 通用助手').click()
  await expect(agent).toHaveCount(0)
  await expectEmptyCaret()
})

test('sends empty and whitespace-only drafts and stops independently', async ({ page }) => {
  const editor = textbox(page)
  await button(page, '发送消息').click()
  await expectPayload(page, { text: '', content: [], agent: { value: 'general' } })
  await editor.press('Enter')
  await expect(page.getByText('发送 1 次 · 停止 0 次')).toBeVisible()
  await button(page, '停止生成').click()
  await editor.press('Enter')
  await expect(page.getByText('发送 2 次 · 停止 1 次')).toBeVisible()
  await expectPayload(page, { text: '', content: [] })
  await button(page, '停止生成').click()
  await editor.pressSequentially('   ')
  await editor.press('Enter')
  await expectPayload(page, { text: '   ', content: ['   '] })
})

test('uses caller suggestions for agents and tags and restores the caret after mouse selection', async ({ page }) => {
  const editor = textbox(page)
  await editor.pressSequentially('@')
  await expect(panel(page)).toBeVisible()
  await editor.press('ArrowDown')
  await editor.press('Enter')
  await expect(page.getByText('@研究助手')).toBeVisible()
  await expect(editor).toBeFocused()
  await expect(panel(page)).toHaveCount(0)

  await editor.pressSequentially('abcd')
  await editor.press('ArrowLeft')
  await editor.press('ArrowLeft')
  await editor.pressSequentially('/rep')
  await expect(button(page, '参考链接')).toHaveCount(0)
  await button(page, '季度报告').click()
  await expect(editor).toBeFocused()
  await expect(panel(page)).toHaveCount(0)
  await editor.pressSequentially('!')
  await editor.press('Enter')
  await expectPayload(page, { text: 'ab report.pdf !cd', content: ['ab', report, '!cd'], agent: { value: 'research' } })
  await expect(page.getByText('@研究助手')).toBeVisible()
  await expect(tags(page)).toHaveCount(0)
  await button(page, '移除智能体 研究助手').click()
  await expect(page.getByText('@研究助手')).toHaveCount(0)
})

test('dismisses the panel without discarding typed text or sending', async ({ page }) => {
  const editor = textbox(page)
  await editor.pressSequentially('/unknown')
  await expect(page.getByText('没有匹配项')).toBeVisible()
  await editor.press('Enter')
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByText('发送 0 次 · 停止 0 次')).toBeVisible()

  await editor.pressSequentially(' @')
  const candidate = panel(page).getByRole('button', { name: '通用助手 general' })
  await candidate.focus()
  await candidate.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(editor).toBeFocused()
  await editor.pressSequentially(' /')
  await page.getByRole('heading', { name: '最近一次发送' }).click()
  await expect(panel(page)).toHaveCount(0)
  await editor.press('Enter')
  await expectPayload(page, { text: '/unknown @ /' })
})

test('inserts at a saved selection and serializes adjacent tags and line breaks', async ({ page }) => {
  const editor = textbox(page)
  await editor.pressSequentially('abXYcd')
  await editor.press('ArrowLeft')
  await editor.press('ArrowLeft')
  await editor.press('Shift+ArrowLeft')
  await editor.press('Shift+ArrowLeft')
  await button(page, '插入报告标签').click()
  await button(page, '插入报告标签').click()
  await expect(tags(page)).toHaveCount(2)
  await editor.press('Shift+Enter')
  await editor.pressSequentially('z')
  await editor.press('Enter')
  await expectPayload(page, { text: 'ab report.pdf report.pdf\nzcd', content: ['ab', report, report, '\nzcd'] })
})

test('deletes adjacent tags atomically with both keys and across a selection', async ({ page }) => {
  const editor = textbox(page)
  await button(page, '插入报告标签').click()
  await editor.press('Backspace')
  await expect(tags(page)).toHaveCount(0)

  await button(page, '插入报告标签').click()
  await placeBesideTag(tags(page).first(), 'before')
  await editor.press('Delete')
  await expect(tags(page)).toHaveCount(0)

  await button(page, '填入示例').click()
  await expect(tags(page)).toHaveCount(2)
  await editor.focus()
  await editor.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 1)
    range.setEnd(element.lastChild!, 0)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  })
  await editor.press('Backspace')
  await expect(tags(page)).toHaveCount(0)
  await editor.press('Enter')
  await expectPayload(page, { content: ['请。'] })
})

test('keeps personalized tag colors after refill and works in a narrow dark layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await button(page, '填入示例').click()
  await expect(tags(page).first().locator('.agent-input__tag-label')).toHaveCSS('color', 'rgb(163, 51, 18)')
  await expect(tags(page).nth(1)).toHaveCSS('color', 'rgb(41, 41, 41)')
  await button(page, '深色主题').click()
  await expect(tags(page).first().locator('.agent-input__tag-label')).toHaveCSS('color', 'rgb(255, 173, 145)')
  await expect(tags(page).nth(1)).toHaveCSS('color', 'rgb(242, 242, 242)')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await button(page, '清空正文').click()
  await textbox(page).pressSequentially('/')
  const bounds = await panel(page).boundingBox()
  const root = await page.locator('.agent-input').boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(root!.y)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375)
})

test('keeps suggestions visible when the composer sits at the top of the viewport', async ({ page }) => {
  const root = page.locator('.agent-input')
  await root.evaluate(element => {
    const style = (element as HTMLElement).style
    style.position = 'fixed'
    style.inset = '0 1rem auto'
  })
  await textbox(page).pressSequentially('/')
  await expect(panel(page)).toHaveAttribute('data-side', 'below')
  expect((await panel(page).boundingBox())!.y).toBeGreaterThan((await root.boundingBox())!.height)
  await button(page, '季度报告').click()
  await expect(tags(page)).toHaveCount(1)
})

test('preserves plain-text pastes and scrolls within the row limit', async ({ page }) => {
  const editor = textbox(page)
  const body = page.locator('.agent-input__body')
  await expect(body).toHaveCSS('height', '48px')
  await editor.focus()
  await editor.evaluate(element => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/plain', 'a  b\r\nc')
    clipboard.setData('text/html', '<strong>alternative</strong>')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  })
  await expect(editor.locator('strong')).toHaveCount(0)
  for (let index = 0; index < 6; index++) {
    await editor.press('Shift+Enter')
    await editor.pressSequentially('a')
  }
  await expect(body).toHaveCSS('height', '120px')
  expect(await body.evaluate(element => element.scrollHeight)).toBeGreaterThan(120)
  expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await editor.press('Enter')
  await expectPayload(page, { text: 'a  b\nc' + '\na'.repeat(6) })
})

test('does not submit during composition and synchronizes the committed draft', async ({ page }) => {
  const editor = textbox(page)
  await editor.focus()
  await editor.dispatchEvent('compositionstart')
  await page.keyboard.insertText('研究')
  await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
  await expect(page.getByText('发送 0 次 · 停止 0 次')).toBeVisible()
  await editor.dispatchEvent('compositionend', { data: '研究' })
  await editor.press('Enter')
  await expectPayload(page, { text: '研究', content: ['研究'] })
})

test('accepts an actual Chromium composition commit', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium DevTools Protocol provides composition input')
  const editor = textbox(page)
  await editor.focus()
  const devTools = await context.newCDPSession(page)
  await devTools.send('Input.imeSetComposition', { text: 'yan', selectionStart: 3, selectionEnd: 3 })
  await expect(page.getByText('发送 0 次 · 停止 0 次')).toBeVisible()
  await devTools.send('Input.insertText', { text: '研究' })
  await editor.press('Enter')
  await expectPayload(page, { text: '研究', content: ['研究'] })
})
