import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../apps/pwa/dist/", import.meta.url);
const hashes = {};
async function scan(path = "") {
  for (const entry of await readdir(new URL(path, root), {
    withFileTypes: true,
  })) {
    const name = path + entry.name;
    if (entry.isDirectory()) await scan(name + "/");
    else if (name !== "sw.js")
      hashes[name] =
        "sha256-" +
        createHash("sha256")
          .update(await readFile(new URL(name, root)))
          .digest("base64");
  }
}
await scan();
const sw = new URL("sw.js", root);
await writeFile(
  sw,
  "self.__LATCH_DIGESTS__=" +
    JSON.stringify(hashes) +
    ";\n" +
    (await readFile(sw, "utf8")),
);
