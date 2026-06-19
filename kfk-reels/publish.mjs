// KFK IG publisher — runs in GitHub Actions on a cron. Publishes any due reels.
import fs from 'fs';

const QUEUE = 'kfk-reels/queue.json';
const TOKEN = process.env.IG_TOKEN;

async function publishReel(job) {
  const B = job.apiBase;
  const params = new URLSearchParams({ media_type: 'REELS', video_url: job.videoUrl, caption: job.caption || '', access_token: TOKEN });
  if (job.coverUrl) params.set('cover_url', job.coverUrl);
  const cr = await fetch(`${B}/${job.igUserId}/media`, { method: 'POST', body: params });
  const cj = await cr.json();
  if (cj.error) throw new Error(cj.error.message || 'container failed');
  const creationId = cj.id;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const sr = await fetch(`${B}/${creationId}?fields=status_code&access_token=${encodeURIComponent(TOKEN)}`);
    const sj = await sr.json();
    if (sj.status_code === 'FINISHED') break;
    if (sj.status_code === 'ERROR') throw new Error('processing failed on Instagram');
  }
  const pubParams = new URLSearchParams({ creation_id: creationId, access_token: TOKEN });
  const pr = await fetch(`${B}/${job.igUserId}/media_publish`, { method: 'POST', body: pubParams });
  const pj = await pr.json();
  if (pj.error) throw new Error(pj.error.message || 'publish failed');
  return pj.id;
}

async function main() {
  if (!TOKEN) { console.error('No IG_TOKEN secret set.'); process.exit(0); }
  let queue = [];
  try { queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8')); } catch {}
  const now = Date.now();
  let changed = false;
  for (const job of queue) {
    if (job.status !== 'scheduled') continue;
    if (!job.atMs || job.atMs > now) continue;
    try {
      const id = await publishReel(job);
      job.status = 'posted'; job.postedId = id; job.postedAt = now; changed = true;
      console.log('Posted reel', job.id, '->', id);
    } catch (e) {
      job.attempts = (job.attempts || 0) + 1;
      job.lastError = String(e.message || e);
      if (job.attempts >= 5) { job.status = 'failed'; }
      changed = true;
      console.error('Failed reel', job.id, job.lastError);
    }
  }
  const week = 7 * 86400000;
  queue = queue.filter(j => !(j.status === 'posted' && j.postedAt && (now - j.postedAt) > week));
  if (changed) fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + '\n');
}

main();
