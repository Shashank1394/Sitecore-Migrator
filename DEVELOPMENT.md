# Development Guide

## Package Manager: npm

This project **uses `npm` exclusively**. Do **NOT** use `pnpm` or `yarn`.

### Why npm only?

- Simpler dependency resolution for Electron + TypeScript projects
- Clearer build pipeline for both renderer and main process
- Avoids pnpm workspace complications that can break builds

---

## Quick Start

### Install Dependencies

```bash
npm install
```

This will:
- Install all dependencies from `package.json`
- Create `package-lock.json` for reproducible builds
- Set up `node_modules` with proper npm structure

### Run Development Server

```bash
npm run dev
```

This starts three processes in parallel:
1. **Vite dev server** — React/Electron renderer on `http://localhost:5173`
2. **TypeScript compiler** — Watches `tsconfig.electron.json` for main process changes
3. **Electron app** — Loads the dev renderer and main process

The app will auto-reload when you save files.

### Build for Production

```bash
npm run build
```

This:
1. Builds React/Electron renderer with Vite
2. Compiles TypeScript main process to `dist/electron/`
3. Compiles Electron preload script to `.cjs`
4. Outputs everything to `/dist` folder

### Type Check

```bash
npm run typecheck
```

Validates TypeScript in both renderer and main process without building.

---

## Project Structure

```
.
├── electron/                  # Main process + Electron setup
│   ├── main.ts               # Electron app entry point
│   ├── preload.cts           # Preload script (CommonJS format)
│   ├── mcp-client-factory.ts # MCP client initialization
│   └── renderer/             # Renderer process (React)
│       ├── App.tsx           # Main React component
│       ├── main.tsx          # React entry point
│       ├── index.html        # HTML template
│       ├── styles.css        # Global styles
│       └── electron.d.ts     # Type definitions for IPC API
├── src/                       # Core business logic
│   ├── migration/            # Migration engine
│   ├── mapping/              # YAML mapping logic
│   ├── mcp/                  # MCP client implementations
│   ├── yaml/                 # YAML parsing & loading
│   └── config/               # Configuration loading
├── .env                       # Environment variables (local only)
├── package.json             # npm configuration
├── tsconfig.json            # TypeScript config (main + src)
├── tsconfig.electron.json   # TypeScript config (electron only)
└── vite.config.ts           # Vite build configuration
```

---

## Environment Setup

### `.env` File

Create or update `.env` with your Sitecore credentials:

```env
# Sitecore XP GraphQL
SITECORE_XP_GRAPHQL_ENDPOINT=https://your-sitecore-host/sitecore/api/edge/graphql
SITECORE_XP_GRAPHQL_API_KEY={YOUR-GRAPHQL-API-KEY}

# SitecoreAI MCP
SITECORE_AI_ENDPOINT=https://your-sitecoreai-endpoint
SITECORE_AI_API_KEY=your-api-key

# Optional
SITECORE_SOURCE_DATABASE=master
SITECORE_MIGRATION_LANGUAGE=en
```

The `.env` file is loaded by `electron/main.ts` via `dotenv` when the app starts.

---

## Troubleshooting

### "Module not found" errors after running pnpm

If you accidentally ran `pnpm install` or `pnpm dev`:

```bash
# Clean up pnpm artifacts
rm -rf node_modules package-lock.json

# Reinstall with npm
npm install

# Rebuild
npm run build
```

### Build fails with TypeScript errors

Ensure all dependencies are installed:

```bash
npm install
npm run typecheck  # Check for TS errors
npm run build      # Rebuild
```

### Preload script not loading in dev mode

The preload script is compiled to `dist/electron/preload.cjs`. If it's missing:

```bash
# Rebuild TypeScript (electron target)
node node_modules/typescript/bin/tsc -p tsconfig.electron.json

# Restart dev server
npm run dev
```

### MCP connections fail

1. Verify `.env` has correct endpoints and API keys
2. Check that endpoints are accessible from your machine
3. Restart the app (MCP is initialized at startup)

---

## Build Output

After `npm run build`, check `/dist`:

```
dist/
├── renderer/              # Vite React bundle
│   ├── index.html
│   └── assets/
│       ├── index-*.css
│       └── index-*.js
├── electron/              # Compiled Electron code
│   ├── main.js
│   ├── preload.cjs        # Preload script (CommonJS)
│   ├── mcp-client-factory.js
│   └── *.js.map
├── config/                # Compiled config
├── mapping/               # Compiled mapping logic
├── mcp/                   # Compiled MCP clients
├── migration/             # Compiled migration engine
└── src/                   # Source files (index.js, etc)
```

---

## Common npm Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install all dependencies |
| `npm run dev` | Start dev server (watch mode) |
| `npm run build` | Build for production |
| `npm run typecheck` | Type-check without building |
| `npm list` | Show installed packages |
| `npm audit` | Check for security vulnerabilities |
| `npm update` | Update all packages to latest safe versions |

---

## Tips

- **Hot reload**: The dev server auto-reloads the renderer. The main process requires a manual restart if you change `electron/main.ts`.
- **DevTools**: Press `F12` in the Electron app to open DevTools for debugging.
- **Logs**: Check the terminal running `npm run dev` for both Vite and Electron output.
- **Clean build**: `rm -rf dist` then `npm run build` to rebuild from scratch.
