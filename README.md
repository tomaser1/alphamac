# alphamac

a zetamac-style mental maths trainer for iphone, with stats that track your progress over time.

- `docs/`: the app itself (plain html, css and javascript). github pages serves this folder.
- `tools/`: python helpers. `make_icons.py` draws the app icon, `make_fake_data.py` makes a fake history to test the stats screen.

## run it on your computer

```
cd docs
python -m http.server
```

then open http://localhost:8000. offline caching is switched off on localhost so your edits show straight away.

## publish an update

1. bump `CACHE` in `docs/sw.js` (e.g. `alphamac-v1` → `alphamac-v2`)
2. commit and push
3. on the iphone, open alphamac, close it, and open it again
