const fs = require("fs");

const file = "src/index.js";

let data = fs.readFileSync(file, "utf8");

const fixes = [
  ["�Y\"o", "📜"],
  ["�Y\"S", "🔊"],
  ["�Y'S", "🔊"],
  ["�YZ�", "🎨"],
  ["�Y\"�", "📝"],
  ["�Y-�️", "🖼️"],
  ["�o�️", "✏️"],
  ["�sT️", "⚙️"],
  ["�O", "❌"],
  ["�o", "✅"],
  ["�Y>�️", "⚡"],
  ["�Ys�", "⚠️"],
  ["�T�️", "🔄"],
  ["�z.", "➕"],
  ["�Y'~", "💞"],
  ["�Y'�", "👤"],

  // restos quebrados
  ["�f�", "📌"],
  ["�?�", "➡️"],
  ["�?�", "➡️"],
  ["�?" , "➡️"],
  ["�Y��", "🗑️"],
  ["�Y<", "👋"],
  ["�s�️", "⚠️"]
];

let count = 0;

for (const [bad, good] of fixes) {
  const n = data.split(bad).length - 1;
  if (n) {
    data = data.split(bad).join(good);
    count += n;
  }
}

fs.writeFileSync(file, data, "utf8");

console.log("Corrigidos:", count);
console.log("Finalizado");
