import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { launchBrowser, type BrowserMethods } from "./browser"
import { SELECTORS_TO_REMOVE, shouldSkipDomain } from "./utils"
import { WebSearchError } from "./error"
import { getReadabilityScript } from "./macro" with { type: "macro" }
import { toMarkdown } from "./to-markdown"
import Queue from "p-queue"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer({
    name: "LocalWebSearch",
    version: "1.0.0"
});

const state = {
    browser: null as BrowserMethods | null,
    queue: new Queue({ concurrency: 4 }),
}

const SearchResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string().optional(),
})
const PageContentSchema = z.object({
    url: z.string(),
    author: z.string().optional(),
    publishedTime: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
})
type SearchResult = z.infer<typeof SearchResultSchema>
type PageContent = z.infer<typeof PageContentSchema>
async function useBrowser() {
    if (!state.browser) {
        state.browser = await launchBrowser({
            show: false,
            // browser: "Google Chrome",
            proxy: process.env["HTTP_PROXY"] || process.env["HTTPS_PROXY"],
        })
    }
    return state.browser
}


function getSearchUrl({ query, maxResults }: { query: string, maxResults?: number }) {
    const searchParams = new URLSearchParams({
        q: query,
        num: `${maxResults || 10}`,
    })

    // web tab
    searchParams.set("udm", "14")

    const url = `https://www.google.com/search?${searchParams.toString()}`

    return url
}
async function search(
    browser: BrowserMethods,
    options: {
        query: string
        maxResults?: number
    },
): Promise<SearchResult[] | null> {
    const url = getSearchUrl(options)

    let searchResults = await browser.withPage(async (page) => {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
        })
        const results = await page.evaluate(() => {
            // Find all search result containers
            const elements = document.querySelectorAll('div.g');
            if (!elements || elements.length === 0) {
                return [];
            }

            // Extract data from each result
            return Array.from(elements).map((el) => {
                // Find required elements within result container
                const titleEl = el.querySelector('h3');            // Title element
                const linkEl = el.querySelector('a');              // Link element
                const snippetEl = el.querySelector('div.VwiC3b');  // Snippet element

                // Skip results missing required elements
                if (!titleEl || !linkEl || !snippetEl) {
                    return null;
                }
                const link = linkEl.getAttribute('href') || '';

                // Return structured result data
                return {
                    title: titleEl.textContent || '',        // Result title
                    url: link,  // Result URL
                    snippet: snippetEl.textContent || '',    // Result description
                };
            }).filter(result => result !== null && result.url.length > 0);  // Remove invalid results
        });

        // Return compiled list of results
        return results;
    })
    if (searchResults)
        searchResults = searchResults.filter((result) => {
            const url = result!.url
            return !shouldSkipDomain(url)
        });
    if (!searchResults || searchResults.length === 0) throw new WebSearchError(`No search results found for query "${options.query}"`)

    return (searchResults as SearchResult[]).slice(0, options.maxResults || 15);

}


async function visitLink(browser: BrowserMethods, url: string): Promise<PageContent | null> {
    const readabilityScript = await getReadabilityScript()
    const result = await browser.withPage(async (page) => {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
        })
        return await page.evaluate(
            ([readabilityScript, selectorsToRemove]) => {
                const Readability = new Function(
                    "module",
                    `${readabilityScript}\nreturn module.exports`,
                )({})

                const document = window.document.cloneNode(true) as HTMLDocument;
                document
                    .querySelectorAll(selectorsToRemove.join(","))
                    .forEach((el) => el.remove())

                const article = new Readability(document).parse()

                const title = article?.title || document.title
                const author = article?.byline
                const publishedTime = article?.publishedTime
                const content = article?.content
                return { title, author, publishedTime, content }
            },
            [readabilityScript, SELECTORS_TO_REMOVE] as const,
        )
    })

    if (!result) return null

    const content = toMarkdown(result.content)

    return { ...result, url, content }
}

server.tool(
    "google_search",
    "Search for a query by Google and return the results",
    {
        query: z.string().describe("The search query to perform, should be clear and concise keywords"),
        maxResults: z.number()
            .or(z.string())
            .optional()
            .describe("The maximum number of results to return, default is 10"),
    },
    async ({ query, maxResults }) => {
        const browser = await useBrowser()
        try {
            const results = await search(browser, {
                query,
                maxResults: (typeof maxResults === 'string') ? Number(maxResults) : maxResults || 10,
            })
            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) } as TextContent]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `Error: ${error}` } as TextContent], isError: true,
            }
        }
    }
);

server.tool(
    "visit_link",
    "Visit a link and extract web content",
    { url: z.string().describe("URL of the page to visit") },
    async ({ url }) => {
        const browser = await useBrowser()

        try {
            const result = await visitLink(browser, url)
            if (!result) return { content: [{ type: "text", text: "Failed to load page of url: " + url }], isError: true }
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) } as TextContent]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `Error: ${error}` } as TextContent], isError: true,
            }
        }
    }
);
server.tool(
    "visit_links",
    "Visit multiple links and extract content from each",
    {
        urls: z.array(z.string()).describe("List of URLs to visit, should be an array of strings"),
    },
    async ({ urls }) => {
        const browser = await useBrowser()
        const results = await Promise.all(urls.map(async (url) => {
            try {
                const result = await visitLink(browser, url)
                if (!result) return { url, text: "Failed to load page of url: " + url }
                return { url, text: JSON.stringify(result, null, 2) }
            } catch (error) {
                return { url, text: `Error: ${error}` }
            }
        }))
        return {
            content: results.map(({ url, text }) => ({ type: "text", text: text }) as TextContent)
        }
    }
);
// Initialize MCP server connection using stdio transport
server.connect(new StdioServerTransport()).catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});

// Cleanup function to close the server and browser
async function cleanup() {
    if (state.browser) {
        await state.browser.close()
        state.browser = null
    }
    process.exit(0);
}

// Register cleanup handlers
process.on('exit', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGHUP', cleanup);