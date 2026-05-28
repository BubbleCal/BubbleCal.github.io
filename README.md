# yah01-blog

Static personal blog generated from the Sonic backup at:

```sh
/Users/yang/Documents/sonic-blog-backups/20260528-215807
```

Generate the static pages:

```sh
npm run generate
```

Run locally:

```sh
npm run serve
```

By default the generator publishes only Sonic posts with `type = 0` and `status = 0`.

The site is generated in two languages:

- `/zh/` uses the original Chinese posts from the Sonic backup.
- `/en/` uses generated English translations from `scripts/english-posts.mjs`.

The root page detects the browser language, remembers the manual language switch, and redirects to the matching language version.
