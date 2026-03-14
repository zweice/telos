import re

with open('docs/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

style_match = re.search(r'<style>(.*?)</style>', html, flags=re.DOTALL)
if style_match:
    css = style_match.group(1)
    with open('docs/index.css', 'w', encoding='utf-8') as f:
        f.write(css.strip())
    
    # Replace style with link
    new_head = """<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="index.css">"""
    
    html = html.replace(style_match.group(0), new_head)
    with open('docs/index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Extracted styles to docs/index.css")
else:
    print("Could not find style block")
