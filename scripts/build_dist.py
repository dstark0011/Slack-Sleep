"""Inline styles, data and script into one file: dist/slack.html.

That single file opens offline, can be copied to your phone, or published as
a claude.ai artifact.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
html = (ROOT / "web" / "index.html").read_text()
css = (ROOT / "web" / "styles.css").read_text()
js = (ROOT / "web" / "app.js").read_text()
data = (ROOT / "data" / "slack-data.js").read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}</style>")
html = html.replace('<script src="../data/slack-data.js"></script>', f"<script>\n{data}</script>")
html = html.replace('<script src="app.js"></script>', f"<script>\n{js}</script>")
assert not re.search(r'src="(app|\.\./data)', html)
out = ROOT / "dist" / "slack.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print("wrote", out)
