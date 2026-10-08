# Changelog

Versions follow semver. Each release is a git tag `vX.Y.Z`.

## 1.3.0
- Live model discovery: if the built-in default is retired (404), the gateway fetches the provider's model list and switches to the newest suitable model — future models work without a library update
- `gateway.latestModel()`, `pickModel()`, `MODEL_PREFERENCES` (edit to change the auto-pick tier), `discoverModels: false` to opt out
- Model listing now uses the same timeout as chat

## 1.2.0
- Multiple keys with automatic failover (`apiKey: "key1 key2"` or `apiKeys: [...]`)
- Model choice is family-aware per provider; valid model ids are never silently rewritten
- Defaults: `gemini-flash-latest`, `gpt-5-mini`, `claude-haiku-4-5`
- Security: removed `VITE_AI_API_KEY` (Vite would ship it to the browser)
- `timeoutMs` option (default 60 s) and `timeout` error code — a hanging provider no longer blocks forever
- Cancelled requests no longer fall through to the next key

## 1.1.0
- 12 providers, auto-detected from key prefix or live probe
- Automatic or manual model, `listModels()`
- Startup check where the AI greets you in the logs
- Retries on 429 / 5xx, typed errors with stable codes
- `VERSION` export

## 1.0.0
- First release: Gemini, OpenAI, Groq, Anthropic; streaming `chat()`
