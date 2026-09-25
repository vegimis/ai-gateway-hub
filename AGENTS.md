<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- AI gateway lives in `src/lib/ai-gateway/` with zero deps (fetch + web streams only) — so it can be copied into any project/runtime unchanged.
- Gateway key resolution: config.apiKey > config.env > process.env (ENV_KEYS in keys.ts) — one convention across all apps.
