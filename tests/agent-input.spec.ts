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

async function expectBareClose(control: Locator) {
  await control.hover()
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await control.focus()
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(control).toHaveCSS('border-top-width', '0px')
  await expect(control).toHaveCSS('outline-style', 'none')
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

test('gives the footer slot the remaining width with a fixed-size action and a gap', async ({ page }) => {
  const footer = page.locator('.agent-input__footer')
  const slot = footer.locator('.agent-input__footer-content')

  async function expectFooterLayout(action: Locator) {
    const bounds = (await footer.boundingBox())!
    const content = (await slot.boundingBox())!
    const control = (await action.boundingBox())!
    expect(control.width).toBe(44)
    expect(control.height).toBe(44)
    expect(content.x).toBeCloseTo(bounds.x)
    expect(control.x + control.width).toBeCloseTo(bounds.x + bounds.width)
    expect(control.x - (content.x + content.width)).toBeCloseTo(8)
  }

  await expectFooterLayout(button(page, '发送消息'))
  await page.setViewportSize({ width: 320, height: 667 })
  await expectFooterLayout(button(page, '发送消息'))
  await button(page, '发送消息').click()
  await expectFooterLayout(button(page, '停止生成'))
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

  const remove = button(page, '移除智能体 通用助手')
  await expectBareClose(remove)
  await remove.click()
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

test('opens suggestions from external buttons without inserting trigger characters', async ({ page }) => {
  const editor = textbox(page)
  await editor.pressSequentially('abcd')
  await editor.press('ArrowLeft')
  await editor.press('ArrowLeft')
  await editor.press('Shift+ArrowLeft')

  await button(page, '打开 @ 候选').click()
  await expect(panel(page)).toBeVisible()
  await expect(editor).toBeFocused()
  await expect(editor).toContainText('abcd')
  await editor.pressSequentially('research')
  await expect(button(page, '通用助手 general')).toHaveCount(0)
  await button(page, '研究助手 research').click()
  await expect(page.getByText('@研究助手')).toBeVisible()
  await expect(editor).toContainText('abcd')

  await button(page, '打开 / 候选').click()
  await expect(button(page, '季度报告')).toBeVisible()
  await editor.press('ArrowRight')
  await expect(panel(page)).toHaveCount(0)
  await editor.press('ArrowLeft')
  await button(page, '打开 / 候选').click()
  await button(page, '季度报告').click()
  await editor.press('Enter')
  await expectPayload(page, { text: 'ab report.pdf cd', content: ['ab', report, 'cd'], agent: { value: 'research' } })
})

test('stacks mention groups in a scrollable panel and manages connector chips', async ({ page }) => {
  const editor = textbox(page)
  const suggestions = panel(page)
  const selected = page.locator('.agent-input__header').getByRole('list', { name: '已选连接器' })

  await editor.pressSequentially('note@')
  const add = suggestions.getByRole('group', { name: '添加' })
  const agents = suggestions.getByRole('group', { name: '智能体' })
  const connectors = suggestions.getByRole('group', { name: '连接器' })
  expect((await add.boundingBox())!.y).toBeLessThan((await agents.boundingBox())!.y)
  expect((await agents.boundingBox())!.y).toBeLessThan((await connectors.boundingBox())!.y)
  await expect(add.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await expect(add.getByRole('button', { name: '上传文件夹', exact: true })).toBeEnabled()
  await expect(agents.getByRole('button', { name: '研究助手' })).toBeVisible()
  const size = await suggestions.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }))
  expect(size.height).toBeLessThanOrEqual(256)
  expect(size.content).toBeGreaterThan(size.height)

  await editor.press('ArrowDown')
  await editor.press('ArrowDown')
  await editor.press('ArrowDown')
  await expect.poll(() => suggestions.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await connectors.getByRole('button', { name: /GitHub/i }).click()
  await expect(selected.getByRole('listitem')).toHaveCount(1)
  await expect(selected.getByText('GitHub')).toBeVisible()
  await expect(editor).toBeFocused()
  await expect(suggestions).toHaveCount(0)

  await editor.pressSequentially('@github')
  await expect(suggestions.getByRole('group')).toHaveCount(1)
  await expect(connectors.getByRole('button', { name: /GitHub/i })).toBeVisible()
  await editor.press('Enter')
  await expect(selected.getByRole('listitem')).toHaveCount(1)

  await editor.pressSequentially('@notion')
  await editor.press('Enter')
  await expect(selected.getByRole('listitem')).toHaveCount(2)
  const remove = selected.getByRole('button', { name: '移除连接器 GitHub' })
  await expectBareClose(remove)
  await remove.click()
  await expect(selected.getByRole('listitem')).toHaveCount(1)
  await expect(selected.getByText('Notion')).toBeVisible()
  await expect(tags(page)).toHaveCount(0)
  await editor.press('Enter')
  await expectPayload(page, { text: 'note', content: ['note'], agent: { value: 'general' } })
})

test('opens native file and directory pickers and logs selected File objects', async ({ page }) => {
  async function chooseFiles(label: string, path: string) {
    await button(page, '打开 @ 候选').click()
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      panel(page).getByRole('button', { name: label, exact: true }).click(),
    ])
    await expect(panel(page)).toHaveCount(0)

    const logged = page.waitForEvent('console', {
      predicate: async message => message.type() === 'log' &&
        await message.args()[0]?.evaluate((value: unknown) => value instanceof File && value.name === 'App.vue'),
    })
    await chooser.setFiles(path)
    return (await logged).args()[0].evaluate((file: File) => file.webkitRelativePath)
  }

  expect(await chooseFiles('上传文件', 'demo/App.vue')).toBe('')
  expect(await chooseFiles('上传文件', 'demo/App.vue')).toBe('')
  expect(await chooseFiles('上传文件夹', 'demo')).toBe('demo/App.vue')
  expect(await chooseFiles('上传文件', 'demo/App.vue')).toBe('')
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

test('shows a background on tag hover and emits the item on click or keyboard activation', async ({ page }) => {
  const editor = textbox(page)
  const link = editor.getByRole('button', { name: '参考链接' })
  const custom = editor.getByRole('button', { name: '季度报告' })
  const item = page.getByTestId('tag-item')

  await button(page, '填入示例').click()
  await editor.focus()
  await expect(link).toHaveCSS('color', 'rgb(0, 102, 255)')
  await expect(link).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await link.hover()
  await expect(link).toHaveCSS('background-color', 'rgb(239, 239, 239)')
  await link.click()
  await expect(item).toBeVisible()
  expect(JSON.parse(await item.innerText())).toEqual({ label: '参考链接', value: 'reference.url' })
  await expect(editor).toBeFocused()

  await custom.focus()
  await custom.press('Enter')
  await expect.poll(async () => JSON.parse(await item.innerText())).toEqual(report)
  await expect(page.getByText('发送 0 次 · 停止 0 次')).toBeVisible()
})

test('keeps personalized tag colors after refill and works in a narrow dark layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await button(page, '填入示例').click()
  await expect(tags(page).first().locator('.agent-input__tag-label')).toHaveCSS('color', 'rgb(163, 51, 18)')
  await expect(tags(page).nth(1)).toHaveCSS('color', 'rgb(0, 102, 255)')
  await button(page, '深色主题').click()
  await expect(tags(page).first().locator('.agent-input__tag-label')).toHaveCSS('color', 'rgb(255, 173, 145)')
  await expect(tags(page).nth(1)).toHaveCSS('color', 'rgb(0, 102, 255)')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await button(page, '清空正文').click()
  await textbox(page).pressSequentially('/')
  const bounds = (await panel(page).boundingBox())!
  const root = (await page.locator('.agent-input').boundingBox())!
  expect(bounds.x).toBeGreaterThan(root.x)
  expect(bounds.x + bounds.width).toBeLessThan(root.x + root.width)
})

test('expands suggestions in the composer flow above the header', async ({ page }) => {
  const root = page.locator('.agent-input')
  const header = root.locator('.agent-input__header')
  await root.evaluate(element => {
    const style = (element as HTMLElement).style
    style.position = 'fixed'
    style.inset = '0 1rem auto'
  })
  const closed = (await root.boundingBox())!
  const headerBefore = (await header.boundingBox())!
  const editor = textbox(page)
  await editor.pressSequentially('/')

  await expect(panel(page)).toHaveCSS('position', 'static')
  const open = (await root.boundingBox())!
  const suggestions = (await panel(page).boundingBox())!
  const headerAfter = (await header.boundingBox())!
  expect(suggestions.y).toBeGreaterThan(open.y)
  expect(suggestions.y + suggestions.height).toBeLessThan(headerAfter.y)
  expect(headerAfter.y - headerBefore.y).toBeGreaterThanOrEqual(suggestions.height)
  expect(open.height - closed.height).toBeCloseTo(headerAfter.y - headerBefore.y)

  await button(page, '季度报告').click()
  await expect(tags(page)).toHaveCount(1)
  await expect(panel(page)).toHaveCount(0)
  await expect(editor).toBeFocused()
  expect((await root.boundingBox())!.height).toBeCloseTo(closed.height)
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
