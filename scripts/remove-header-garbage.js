const fs = require("fs");

const file = "src/index.js";

let data = fs.readFileSync(file, "utf8");

// remove caracteres invisíveis no começo do arquivo
data = data.replace(/^\uFEFF/, "");
data = data.replace(/^[^\w]*(?=require)/, "");

fs.writeFileSync(file, data, "utf8");

console.log("Primeira linha corrigida.");
