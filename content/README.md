# Content workflow

Published Markdown posts live under `content/posts/<slug>/`.

Drafts live under `content/drafts/<slug>/` and are not included in site generation, RSS, or sitemap.

Each post folder uses this shape:

```text
post.json
zh.md
en.md
```

To publish a draft, move its folder from `content/drafts` to `content/posts`, then run:

```sh
npm run generate
```
