const fs = require("fs");

const files = [
  "src/index.js",
  "src/rules-panel-config-2.json",
  "src/rank-call-config.json"
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  let data = fs.readFileSync(file, "utf8");

  let before;

  do {
    before = data;

    data = Buffer.from(data, "latin1").toString("utf8");

  } while (data !== before && /Ã|Â|â|�/.test(data));

  fs.writeFileSync(file, data, "utf8");

  console.log(file, "corrigido");
}

console.log("Finalizado");
