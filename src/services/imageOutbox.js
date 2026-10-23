// Platform-independent queue. Dependencies own storage, network and identity.
// A task keeps the same message ID across retries and process restarts.
export function createImageOutbox({ initial = [], prepare, upload, prepareSend, send, persist, isCurrent, onComplete, concurrency = 2 }) {
  let tasks = initial.map(task => ({ ...task, status: task.status === 'failed' ? 'failed' : 'queued', progress: null }));
  let active = true, online = true, running = 0, timer, writes = Promise.resolve();
  const listeners = new Set(), turnWaiters = new Set();
  const snapshot = () => tasks.map(task => ({ ...task }));
  const emit = () => { const next = snapshot(); for (const listener of listeners) listener(next); for (const check of [...turnWaiters]) check(); };
  const save = () => { const next = snapshot(); writes = writes.catch(() => {}).then(() => persist(next)); return writes; };
  const assertCurrent = () => { if (!active || !isCurrent()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' }); };
  const update = (task, patch) => { Object.assign(task, patch); if (active) emit(); };
  const waitForTurn = task => new Promise((resolve, reject) => {
    const check = () => {
      if (!active || !isCurrent()) { turnWaiters.delete(check); reject(Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' })); return; }
      const index = tasks.indexOf(task);
      if (!tasks.slice(0, index).some(previous => previous.conversationId === task.conversationId
        && previous.roomKind === task.roomKind && previous.status !== 'failed')) {
        turnWaiters.delete(check); resolve();
      }
    };
    turnWaiters.add(check); check();
  });
  const schedule = () => {
    if (timer || !active) return;
    timer = setTimeout(() => { timer = null; pump(); }, 0);
  };
  const run = async task => {
    try {
      assertCurrent();
      await save();
      if (!task.downloadUrl) {
        if (!task.prepared) {
          const prepared = await prepare({ ...task });
          assertCurrent(); update(task, prepared); await save();
        }
        if (!online) { update(task, { status: 'queued', stage: 'waiting' }); await save(); return; }
        assertCurrent();
        const url = await upload({ ...task }, ({ stage, progress }) => {
          if (active) update(task, { stage, progress });
        });
        // Preserve a completed upload for retrying only the message commit.
        Object.assign(task, typeof url === 'string' ? { downloadUrl: url } : url); await save();
      }
      assertCurrent(); update(task, { stage: 'sending', progress: 1 });
      await waitForTurn(task);
      assertCurrent();
      if (prepareSend) {
        const patch = await prepareSend({ ...task });
        assertCurrent();
        if (patch) { update(task, patch); await save(); }
      }
      assertCurrent();
      const accepted = await send({ ...task });
      if (!accepted) throw new Error('ยังส่งข้อความไม่สำเร็จ กรุณาลองอีกครั้ง');
      tasks = tasks.filter(entry => entry.id !== task.id);
      await save();
      if (active) emit();
      await onComplete?.({ ...task });
    } catch (error) {
      if (!tasks.includes(task)) return;
      if (error?.code === 'ACCOUNT_CHANGED') {
        task.status = 'queued';
      } else {
        if (error?.resetUpload) { delete task.downloadUrl; delete task.mediaEpoch; delete task.groupEncrypted; delete task.directEncrypted; }
        update(task, { status: 'failed', progress: null, error: /[ก-๙]/.test(error?.message || '') ? error.message : 'ส่งรูปภาพไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
          retryable: !error?.isModerationViolation });
      }
      await save().catch(() => {});
    } finally { running--; schedule(); }
  };
  const pump = () => {
    if (!active || !isCurrent()) return;
    while (running < concurrency) {
      const task = tasks.find(entry => entry.status === 'queued' && (online || !entry.prepared));
      if (!task) break;
      running++; update(task, { status: 'uploading', stage: task.downloadUrl ? 'sending' : 'preparing', error: null });
      void run(task);
    }
  };
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    enqueue(items) {
      assertCurrent();
      if (items.length + tasks.length > 30) throw new Error('มีรูปที่รอส่งมากเกินไป กรุณาส่งให้เสร็จหรือลบรายการที่ส่งไม่สำเร็จก่อน');
      for (const task of items) {
        if (!tasks.some(entry => entry.id === task.id)) tasks.push({ ...task, status: 'queued', stage: 'preparing', progress: null, retryable: true });
      }
      emit();
      void save().then(schedule, () => {
        for (const task of tasks.filter(entry => items.some(item => item.id === entry.id))) update(task, { status: 'failed', error: 'บันทึกรูปที่รอส่งไม่ได้ กรุณาลองอีกครั้ง', retryable: true });
      });
    },
    retry(id) {
      assertCurrent(); const task = tasks.find(entry => entry.id === id);
      if (!task || task.status !== 'failed' || task.retryable === false) return;
      update(task, { status: 'queued', error: null, progress: null }); schedule();
    },
    async remove(id) {
      assertCurrent();
      const task = tasks.find(entry => entry.id === id);
      if (!task || task.status !== 'failed') return;
      tasks = tasks.filter(entry => entry !== task); emit();
      try { await save(); } catch (error) { tasks.push(task); emit(); throw error; }
      return task;
    },
    setOnline(value) { online = value; if (online) schedule(); },
    dispose() { active = false; clearTimeout(timer); listeners.clear(); for (const check of [...turnWaiters]) check(); },
  };
}
