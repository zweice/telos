const fs = require('fs');
let css = fs.readFileSync('docs/index.css', 'utf8');

const replacements = {
    'rgba(255, 255, 255, 0.04)': 'var(--btn-bg)',
    'rgba(255, 255, 255, 0.08)': 'var(--btn-hover)',
    'rgba(255, 255, 255, 0.1)': 'var(--btn-hover)',
    'rgba(255,255,255,0.05)': 'var(--btn-bg)',
    'rgba(255,255,255,0.08)': 'var(--btn-hover)',
    'rgba(255,255,255,0.1)': 'var(--btn-hover)',
    'rgba(255,255,255,0.03)': 'var(--btn-bg)',
    'rgba(255,255,255,0.06)': 'var(--btn-hover)'
};

for (const [k, v] of Object.entries(replacements)) {
    css = css.split(k).join(v);
}
fs.writeFileSync('docs/index.css', css);
console.log('Done!');
