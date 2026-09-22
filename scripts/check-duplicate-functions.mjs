import fs from "node:fs";

const path = process.argv[2] || "src/main.jsx";
const source = fs.readFileSync(path, "utf8");
const lines = source.split(/\r?\n/);
const seen = new Map();
const duplicates = [];

for (let i = 0; i < lines.length; i += 1) {
  const match = lines[i].match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (!match) continue;
  const name = match[1];
  const line = i + 1;
  if (seen.has(name)) {
    duplicates.push({ name, first: seen.get(name), duplicate: line });
  } else {
    seen.set(name, line);
  }
}

if (duplicates.length) {
  console.error("Duplicate top-level function declarations detected:");
  for (const d of duplicates) {
    console.error(`  ${d.name}: first at line ${d.first}, duplicate at line ${d.duplicate}`);
  }
  process.exit(1);
}

console.log(`No duplicate top-level function declarations found in ${path}.`);
