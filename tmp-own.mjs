const res = await fetch('http://localhost:3000/api/print/layout?file=' + encodeURIComponent('自社請求書.xlsx'));
const { layout } = await res.json();
console.log('scale', layout.scale, layout.orientation, 'cols', layout.cols.join(','), 'center', layout.center);
console.log('margin', JSON.stringify(layout.margin));
for (const d of layout.drawings) console.log('DRAW', d.kind, 'x', d.x.toFixed(3), 'w', d.w.toFixed(3), 'y', Math.round(d.y), 'h', Math.round(d.h), 'r', d.r1, d.r2, 'size', d.size, JSON.stringify(d.lines).slice(0, 160), d.stroke || '');
layout.rows.forEach((row, i) => {
  const cells = row.cells
    .map((c, ci) => (c.text || c.border ? `${ci}:${JSON.stringify(String(c.text).slice(0, 14))}[${c.size}${c.bold ? 'b' : ''}${c.align[0]}${c.valign[0]}${c.formula ? 'f' : ''}${c.wrap ? 'w' : ''}]` : ''))
    .filter(Boolean)
    .join(' ');
  if (i < 30 || i > layout.rows.length - 12) console.log(i + 1, 'h', row.height, cells);
});
console.log('merges', JSON.stringify(layout.merges));
