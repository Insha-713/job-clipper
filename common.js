(function (root) {
  'use strict';

  const STORAGE_KEY = 'jobs';
  const STATUSES = ['Saved', 'Applied', 'Interview', 'Result'];
  const ALARM_PREFIX = 'job-deadline:';
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const IMMEDIATE_DELAY_MS = 3000;

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Parses a strict YYYY-MM-DD string into local date parts without UTC shift.
   */
  function parseLocalDate(dateStr) {
    if (typeof dateStr !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(year, month - 1, day);

    if (
      probe.getFullYear() !== year ||
      probe.getMonth() !== month - 1 ||
      probe.getDate() !== day
    ) {
      return null;
    }

    return { year, month, day };
  }

  /**
   * Computes when the deadline reminder alarm should fire.
   * - Fires at 09:00 local time one day before the deadline.
   * - If the deadline is less than a day away (including today), fires in ~3 seconds.
   * - Returns null if the deadline date has already completely passed (before today).
   */
  function computeReminderSchedule(deadlineStr, nowMs = Date.now()) {
    const parts = parseLocalDate(deadlineStr);
    if (!parts) return null;

    const { year, month, day } = parts;
    const deadlineEndMs = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
    if (deadlineEndMs < nowMs) {
      return null;
    }

    const deadlineTargetMs = new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
    const oneDayBeforeMs = deadlineTargetMs - ONE_DAY_MS;

    if (oneDayBeforeMs <= nowMs) {
      return { when: nowMs + IMMEDIATE_DELAY_MS, immediate: true };
    }

    return { when: oneDayBeforeMs, immediate: false };
  }

  /**
   * Normalizes a saved job link for opening in a new tab.
   * Adds https:// if no scheme is present and blocks unsafe schemes like javascript:.
   */
  function normalizeExternalUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';

    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
    const candidate = hasScheme ? trimmed : 'https://' + trimmed.replace(/^\/+/, '');

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
      return '';
    } catch {
      return '';
    }
  }

  async function getJobs() {
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  }

  async function saveJobs(jobs) {
    await chrome.storage.local.set({ [STORAGE_KEY]: jobs });
  }

  function alarmNameForJob(jobId) {
    return ALARM_PREFIX + jobId;
  }

  async function clearJobAlarm(jobId) {
    if (!jobId) return;
    await chrome.alarms.clear(alarmNameForJob(jobId));
  }

  async function syncJobAlarm(job) {
    if (!job || !job.id) return;
    await clearJobAlarm(job.id);

    const schedule = computeReminderSchedule(job.deadline);
    if (!schedule) return;

    await chrome.alarms.create(alarmNameForJob(job.id), {
      when: schedule.when
    });
  }

  /**
   * Ensures stored alarms match persisted jobs after extension install or browser restart.
   * Skips jobs whose current deadline already triggered a notification.
   */
  async function reconcileAllAlarms() {
    const [jobs, existingAlarms] = await Promise.all([
      getJobs(),
      chrome.alarms.getAll()
    ]);

    const validJobIds = new Set(jobs.map((j) => j.id));

    for (const alarm of existingAlarms) {
      if (alarm.name.startsWith(ALARM_PREFIX)) {
        const id = alarm.name.slice(ALARM_PREFIX.length);
        if (!validJobIds.has(id)) {
          await chrome.alarms.clear(alarm.name);
        }
      }
    }

    const existingAlarmNames = new Set(existingAlarms.map((a) => a.name));

    for (const job of jobs) {
      if (!job.deadline) {
        await clearJobAlarm(job.id);
        continue;
      }
      if (job.remindedDeadline && job.remindedDeadline === job.deadline) {
        continue;
      }
      const name = alarmNameForJob(job.id);
      if (!existingAlarmNames.has(name)) {
        await syncJobAlarm(job);
      }
    }
  }

  async function addJob(input) {
    const nowIso = new Date().toISOString();
    const status = STATUSES.includes(input.status) ? input.status : 'Saved';
    const job = {
      id: generateId(),
      role: String(input.role || '').trim(),
      company: String(input.company || '').trim(),
      link: String(input.link || '').trim(),
      deadline: parseLocalDate(String(input.deadline || '').trim())
        ? String(input.deadline || '').trim()
        : '',
      status,
      remindedDeadline: '',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const jobs = await getJobs();
    jobs.unshift(job);
    await saveJobs(jobs);
    await syncJobAlarm(job);
    return job;
  }

  async function updateJob(jobId, patch) {
    const jobs = await getJobs();
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return null;

    const current = jobs[idx];
    const nextDeadline =
      patch.deadline !== undefined
        ? (parseLocalDate(String(patch.deadline).trim()) ? String(patch.deadline).trim() : '')
        : current.deadline;

    const isEdit = patch.deadline !== undefined || patch.resyncAlarm === true;
    const updated = {
      ...current,
      role: patch.role !== undefined ? String(patch.role).trim() : current.role,
      company: patch.company !== undefined ? String(patch.company).trim() : current.company,
      link: patch.link !== undefined ? String(patch.link).trim() : current.link,
      deadline: nextDeadline,
      status: patch.status !== undefined && STATUSES.includes(patch.status)
        ? patch.status
        : current.status,
      // Reset reminder state on edit so the alarm is re-created cleanly.
      remindedDeadline:
        patch.remindedDeadline !== undefined
          ? patch.remindedDeadline
          : (isEdit ? '' : current.remindedDeadline),
      updatedAt: new Date().toISOString()
    };

    jobs[idx] = updated;
    await saveJobs(jobs);

    // Re-create alarm when a job is edited (and skip when only status or remindedDeadline changes).
    if (patch.remindedDeadline === undefined && isEdit) {
      await syncJobAlarm(updated);
    }

    return updated;
  }

  async function deleteJob(jobId) {
    const jobs = await getJobs();
    const filtered = jobs.filter((j) => j.id !== jobId);
    await saveJobs(filtered);
    await clearJobAlarm(jobId);
  }

  function escapeCsvCell(value) {
    const str = String(value == null ? '' : value);
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function buildCsvContent(jobs) {
    const header = ['Role', 'Company', 'Link', 'Deadline', 'Status'];
    const rows = [header.map(escapeCsvCell).join(',')];

    for (const job of jobs) {
      rows.push(
        [
          job.role || '',
          job.company || '',
          job.link || '',
          job.deadline || '',
          job.status || 'Saved'
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }

    // Prepend UTF-8 BOM (\uFEFF) so Microsoft Excel opens UTF-8 characters cleanly.
    return '\uFEFF' + rows.join('\r\n');
  }

  async function openBoardTab() {
    const boardUrl = chrome.runtime.getURL('board.html');
    const existingTabs = await chrome.tabs.query({ url: boardUrl });
    if (existingTabs.length > 0 && existingTabs[0].id !== undefined) {
      const tab = existingTabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return tab;
    }
    return chrome.tabs.create({ url: boardUrl });
  }

  root.JobClipper = {
    STORAGE_KEY,
    STATUSES,
    ALARM_PREFIX,
    generateId,
    parseLocalDate,
    computeReminderSchedule,
    normalizeExternalUrl,
    getJobs,
    saveJobs,
    alarmNameForJob,
    clearJobAlarm,
    syncJobAlarm,
    reconcileAllAlarms,
    addJob,
    updateJob,
    deleteJob,
    escapeCsvCell,
    buildCsvContent,
    openBoardTab
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
