# local-web-search

This is designed to be used in [ChatWise](https://chatwise.app)'s [local web search](https://docs.chatwise.app/web-search.html#local-browsers) feature.

## Development

```bash
bun ./src/cli.ts search -q "some keyword" --show
```

## Build as a MCP server

Build the MCP server:

```bash
bun run build:mcp
```

Configure mcp server:

```json
{
  "mcpServers": {
    "local-web-search-mcp": {
      "command": "bun",
      "args": ["/path/to/local-web-search/dist/mcp-server.js"],
      "env": {
        "HTTPS_PROXY": "http://127.0.0.1:7890"
      }
    }
  }
}
```

Debugging with MCP Inspector:

```bash
bunx @modelcontextprotocol/inspector -e HTTPS_PROXY=http://127.0.0.1:7890 bun ./src/mcp-server.ts
```

## License

MIT
