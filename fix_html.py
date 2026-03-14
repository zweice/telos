import re
with open('docs/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(r'<style>[\s\S]*?</style>', '<link rel="stylesheet" href="index.css" />', html)

with open('docs/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("done")
