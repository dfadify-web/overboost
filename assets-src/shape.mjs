import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs';
const img = new Blob([fs.readFileSync(process.argv[2])], { type: 'image/png' });
const c = await Client.connect('tencent/Hunyuan3D-2.1');
const t0 = Date.now();
try {
  const r = await c.predict('/shape_generation', { image: handle_file(img), steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 384, check_box_rembg: true, num_chunks: 8000, randomize_seed: false });
  console.log('secs', (Date.now() - t0) / 1000);
  const s = JSON.stringify(r.data); console.log(s.slice(0, 1500));
  const urls = s.match(/https?:[^"]+\.(glb|obj)/g) || [];
  let i = 0; for (const u of urls) { const b = Buffer.from(await (await fetch(u)).arrayBuffer()); fs.writeFileSync(`shape${i++}.glb`, b); console.log('saved', u, b.length); }
} catch (e) { console.log('ERR', e?.message ?? e); }
process.exit(0);
