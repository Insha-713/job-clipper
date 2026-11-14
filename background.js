'use strict';

importScripts('common.js');

chrome.runtime.onInstalled.addListener(() => {
  JobClipper.reconcileAllAlarms().catch((err) => {
    console.error('Job Clipper: failed to reconcile alarms on install:', err);
  });
});

chrome.runtime.onStartup.addListener(() => {
  JobClipper.reconcileAllAlarms().catch((err) => {
    console.error('Job Clipper: failed to reconcile alarms on startup:', err);
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm || typeof alarm.name !== 'string') return;
  if (!alarm.name.startsWith(JobClipper.ALARM_PREFIX)) return;

  const jobId = alarm.name.slice(JobClipper.ALARM_PREFIX.length);
  if (!jobId) return;

  try {
    const jobs = await JobClipper.getJobs();
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !job.deadline) return;

    const roleText = job.role || 'Saved job';
    const companyText = job.company ? ' at ' + job.company : '';
    const message = `${roleText}${companyText} — Deadline: ${job.deadline}`;

    await chrome.notifications.create('job-notif:' + job.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Job Application Deadline Reminder',
      message,
      priority: 2
    });

    await JobClipper.updateJob(job.id, {
      remindedDeadline: job.deadline
    });
  } catch (err) {
    console.error('Job Clipper: error handling deadline alarm:', err);
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    await chrome.notifications.clear(notificationId);
    await JobClipper.openBoardTab();
  } catch (err) {
    console.error('Job Clipper: error handling notification click:', err);
  }
});
