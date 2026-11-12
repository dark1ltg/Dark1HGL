import { expect, test, type Page } from '@playwright/test'
import { electronTest } from './helpers'
import { WebviewTag } from 'electron'

const WIKI_URL =
  'https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/wiki'
// example.com is IANA-reserved and does not add cache-buster query params
// the way Google does in CI (?zx=).
const EXTERNAL_URL = 'https://example.com/'
const EXTERNAL_URL_RE = /^https:\/\/example\.com\/?/

function expectUrlBar(page: Page, value: string | RegExp) {
  return expect(page.locator('.WebviewControls__urlInput')).toHaveAttribute(
    'value',
    value
  )
}

electronTest('webview', async (app) => {
  const page = await app.firstWindow()

  await test.step('goes back and forth inside webview and also to Heroic screens', async () => {
    // we have to do this or it fails, the icon also has the same text
    await page.locator('span').filter({ hasText: 'Documentation' }).click()

    // we have to wait a bit for the webview to properly load these urls
    // it's not great to force a sleep, but without these it's too flaky
    await page.waitForTimeout(600)

    await expectUrlBar(page, WIKI_URL)
    await page.waitForTimeout(600)

    // we have to force a src change since we can't really click something reliably
    // inside the webview programatically
    await page.$eval('webview', (el: WebviewTag) => (el.src = EXTERNAL_URL))
    await expectUrlBar(page, EXTERNAL_URL_RE)

    // go back to previous page in webview's history
    await page.getByTitle('Go back').click()
    await expectUrlBar(page, WIKI_URL)

    // go forward again to the external page
    await page.getByTitle('Go forward').click()
    await expectUrlBar(page, EXTERNAL_URL_RE)
    await page.waitForTimeout(600)

    // simulate mouse back
    await page.dispatchEvent('body', 'mouseup', {
      button: 3,
      bubbles: true,
      cancelable: true
    })
    await expectUrlBar(page, WIKI_URL)
    await page.waitForTimeout(600)

    // simulate mouse forward
    await page.dispatchEvent('webview', 'mouseup', {
      button: 4,
      bubbles: true,
      cancelable: true
    })
    await expectUrlBar(page, EXTERNAL_URL_RE)
    await page.waitForTimeout(600)

    // it looks like we can't simulate mouse buttons INSIDE the webview to also test those

    // go back twice to end up in the library
    await page.getByTitle('Go back').click()
    await page.getByTitle('Go back').click()
    await expect(page.getByText('All Games')).toBeVisible()
  })
})
