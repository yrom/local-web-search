# local-web-search

## Build as a MCP server

Build the MCP server:

```bash
git clone git@github.com:yrom/local-web-search.git
cd local-web-search
# run after install bun: https://bun.sh/
bun install
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

## Notice:

This project is forked from [local-web-search](https://github.com/egoist/local-web-search) and modified to support [Model Context Protocol](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
