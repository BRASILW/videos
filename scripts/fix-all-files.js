const fs = require("fs");
const path = require("path");

const files = [
    "src/index.js",
    "src/rank-call-config.json",
    "src/rules-panel-config-2.json"
];

const fixes = [
    ["Ã§", "ç"],
    ["Ã£", "ã"],
    ["Ã¡", "á"],
    ["Ã©", "é"],
    ["Ãª", "ê"],
    ["Ã³", "ó"],
    ["Ãº", "ú"],
    ["Ã­", "í"],
    ["Ãµ", "õ"],
    ["Ã‡", "Ç"],

    ["â€¢", "•"],
    ["âœ…", "✅"],
    ["âš ï¸", "⚠️"],
    ["â±", "⏱"],
    ["â˜€", "☀"],
    ["âŒ", "❌"],
    ["âœ", "✔"],

    ["SequÃªncia", "Sequência"],
    ["PÃ¡gina", "Página"],
    ["HistÃ³ricos", "Históricos"],
    ["AtualizaÃ§Ã£o", "Atualização"],
    ["horÃ¡rio", "horário"],
    ["mÃ­nimo", "mínimo"]
];

for (const file of files) {
    const full = path.resolve(file);

    if (!fs.existsSync(full)) {
        console.log("Não encontrado:", file);
        continue;
    }

    let data = fs.readFileSync(full, "utf8");
    let count = 0;

    for (const [bad, good] of fixes) {
        const before = data;
        data = data.split(bad).join(good);

        if (before !== data) count++;
    }

    fs.writeFileSync(full, data, "utf8");

    console.log(file, "corrigido:", count);
}

console.log("Finalizado.");