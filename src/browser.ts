import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { chromium, type Page } from "playwright-core"
import { findBrowser } from "./find-browser"

type BrowserOptions = {
  show?: boolean
  browser?: string
  proxy?: string
  executablePath?: string
  profilePath?: string
}

export type BrowserMethods = {
  close: () => Promise<void>

  withPage: <T>(fn: (page: Page) => T | Promise<T>) => Promise<T>
}

export const launchBrowser = async (
  options: BrowserOptions,
): Promise<BrowserMethods> => {
  const userDataDir = options.profilePath
    ? path.dirname(options.profilePath)
    : path.join(os.tmpdir(), "local-web-search-user-dir-temp")

  if (!fs.existsSync(userDataDir)) {
    const defaultPreferences = {
      plugins: {
        always_open_pdf_externally: true,
      },
    }

    const defaultProfileDir = path.join(userDataDir, "Default")
    fs.mkdirSync(defaultProfileDir, { recursive: true })

    fs.writeFileSync(
      path.join(defaultProfileDir, "Preferences"),
      JSON.stringify(defaultPreferences),
    )
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath:
      options.executablePath || findBrowser(options.browser).executable,
    headless: !options.show,
    args: [
      // "--enable-webgl",
      // "--use-gl=swiftshader",
      // "--enable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      options.profilePath
        ? `--profile-directory=${path.basename(options.profilePath)}`
        : null,
    ].filter((v) => v !== null),
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: {
      width: 800,
      height: 1080,
    },
    deviceScaleFactor: 1,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,zh-CN,zh;q=0.8",
    },
    acceptDownloads: false,
    bypassCSP: true,
    hasTouch: false,
    isMobile: false,
    // userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/237.84.2.178 Safari/537.36`,
    ignoreHTTPSErrors: true,
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    chromiumSandbox: false,
    reducedMotion: "no-preference",
    forcedColors: "none",
    proxy: options.proxy
      ? {
          server: options.proxy,
        }
      : undefined,
  })

  return {
    close: async () => {
      const pages = context.pages()
      await Promise.all(pages.map((page) => page.close()))
      await context.close()
    },

    withPage: async (fn) => {
      const page = await context.newPage()

      try {
        await interceptRequest(page)
        const result = await fn(page)

        await page.close()
        return result
      } catch (error) {
        await page.close()
        console.error(error)
        throw error
      }
    },
  }
}

async function interceptRequest(page: Page) {
  await applyStealthScripts(page)

  await page.route("**/*", (route) => {
    // map github blob content to raw.githubusercontent.com
    const url = route.request().url()
    if (new URL(url).hostname === "github.com" && url.includes("/blob/")) {
      let newUrl = url
      // https://github.com/run-llama/LlamaIndexTS/blob/main/LICENSE
      // => https://raw.githubusercontent.com/run-llama/LlamaIndexTS/main/LICENSE
      newUrl = url.replace(/github\.com\/([^/]+)\/([^/]+)\/blob\//, "raw.githubusercontent.com/$1/$2/")
      console.warn("redirect to", newUrl)
      return route.fulfill({
        status: 302,
        headers: {
          location: newUrl,
        },
      })
    }

    if (!["document", "script"].includes(route.request().resourceType())) {
      console.error("abort", route.request().resourceType(), route.request().url())
      return route.abort('timedout')
    }

    return route.continue()
  })
}

async function applyStealthScripts(page: Page) {
  await page.addInitScript(() => {
    // 模拟真实的屏幕尺寸和颜色深度
    Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
    Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    // Override the navigator.webdriver property
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    })

    // Mock languages and plugins to mimic a real browser
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en", "zh-CN", "zh"],
    })

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    })

    // Redefine the headless property
    Object.defineProperty(navigator, "headless", {
      get: () => false,
    })
    // @ts-ignore
    window.chrome = {
      runtime: {},
      loadTimes: function () { },
      csi: function () { },
      app: {},
    };
    // Override the permissions API
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
          } as PermissionStatus)
        : originalQuery(parameters)
    
    if (typeof WebGLRenderingContext !== "undefined") {
      const originalGetParameter = WebGLRenderingContext.prototype.getParameter
      // https://cloud.tencent.com/developer/article/2396126
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) {
          return "Google Inc. (Apple)"
        }
        if (parameter === 37446) {
          return "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)"
        }
        return originalGetParameter(parameter)
      }
    }
  })
}
