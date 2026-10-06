# Changelog

Versions follow semver. Each release is a git tag `vX.Y.Z`.

## 1.1.0
- 12 providers, auto-detected from key prefix or live probe
- Automatic or manual model, `listModels()`
- Startup check where the AI greets you in the logs
- Retries on 429 / 5xx, typed errors with stable codes
- `VERSION` export

## 1.0.0
- First release: Gemini, OpenAI, Groq, Anthropic; streaming `chat()`
