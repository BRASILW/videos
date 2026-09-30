const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "src", "index.js");
const backup = target + ".encoding-backup";

if (!fs.existsSync(target)) {
    console.log("index.js não encontrado:", target);
    process.exit(1);
}

let data = fs.readFileSync(target, "utf8");

fs.copyFileSync(target, backup);

console.log("Backup criado:", backup);

const fixes = [
    ["Ã§", "ç"],
    ["Ã£", "ã"],
    ["Ã¡", "á"],
    ["Ã©", "é"],
    ["Ã­", "í"],
    ["Ã³", "ó"],
    ["Ãº", "ú"],
    ["Ãµ", "õ"],
    ["Ãª", "ê"],
    ["Ã´", "ô"],
    ["âœ…", "✅"],
    ["âš ï¸", "⚠️"],
    ["ðŸ", "🐝"],
    ["â±ï¸", "⏱️"],
    ["Â", ""],
    ["â€", ""]
];

let count = 0;

for (const [bad, good] of fixes) {
    if (data.includes(bad)) {
        data = data.replaceAll(bad, good);
        count++;
    }
}

fs.writeFileSync(target, data, "utf8");

console.log("Correções aplicadas:", count);
console.log("Finalizado.");