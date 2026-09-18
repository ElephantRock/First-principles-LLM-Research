import { resolve } from "node:path";
import { loadCausalAttentionBundle, validateContentManifest } from "./index.js";

const root = resolve(process.argv[2] ?? "../../course");
await validateContentManifest(root);
const bundle = await loadCausalAttentionBundle(root);
console.log(JSON.stringify({ ok: true, course: bundle.course.id, unit: bundle.unit.id, contentHash: bundle.contentHash }, null, 2));
