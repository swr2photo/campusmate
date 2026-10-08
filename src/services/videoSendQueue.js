import { useSyncExternalStore } from 'react';

let jobs = [];
const listeners = new Set();
let running = false;
const publish = () => { jobs = [...jobs]; listeners.forEach(fn => fn()); };
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const useVideoSendJobs = () => useSyncExternalStore(subscribe, () => jobs, () => jobs);

async function drain() {
  if (running) return;
  running = true;
  try {
    let job;
    while ((job = jobs.find(entry => entry.status === 'queued'))) {
      job.status = 'processing'; publish();
      try {
        await job.run(phase => { job.phase = phase; publish(); });
        jobs = jobs.filter(entry => entry !== job);
      } catch (error) {
        job.status = 'failed';
        job.error = error?.code === 'permission-denied'
          ? 'ไม่มีสิทธิ์ส่งในห้องนี้ กรุณาตรวจสอบสมาชิกห้องและกฎ Firestore'
          : error.message || 'ส่งไม่สำเร็จ';
      }
      publish();
    }
  } finally { running = false; }
}
export function enqueueVideoSend(job) {
  if (jobs.some(entry => entry.id === job.id)) return;
  jobs.push({ ...job, status: 'queued', phase: 'รอส่ง' }); publish();
  // Let the composer close before starting native export and encryption work.
  setTimeout(() => { void drain(); }, 100);
}
export function retryVideoSend(id) {
  const job = jobs.find(entry => entry.id === id && entry.status === 'failed');
  if (job) { job.status = 'queued'; job.error = null; publish(); void drain(); }
}
export function dismissVideoSend(id) {
  jobs = jobs.filter(entry => entry.id !== id || entry.status !== 'failed'); publish();
}
