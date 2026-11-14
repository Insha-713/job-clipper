'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const boardSummary = document.getElementById('board-summary');
  const searchInput = document.getElementById('search-input');
  const addJobBtn = document.getElementById('add-job-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const columns = Array.from(document.querySelectorAll('.board-column'));

  const modal = document.getElementById('job-modal');
  const modalForm = document.getElementById('job-modal-form');
  const modalTitle = document.getElementById('modal-title');
  const modalRole = document.getElementById('modal-role');
  const modalCompany = document.getElementById('modal-company');
  const modalLink = document.getElementById('modal-link');
  const modalDeadline = document.getElementById('modal-deadline');
  const modalStatus = document.getElementById('modal-status');
  const modalError = document.getElementById('modal-error');
  const modalSaveBtn = document.getElementById('modal-save-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  let allJobs = [];
  let draggedJobId = null;
  let editingJobId = null;

  function getDeadlineBadgeState(deadlineStr) {
    const parts = JobClipper.parseLocalDate(deadlineStr);
    if (!parts) return null;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const deadlineDayStart = new Date(parts.year, parts.month - 1, parts.day).getTime();
    const diffDays = Math.round((deadlineDayStart - todayStart) / (24 * 60 * 60 * 1000));

    if (diffDays < 0) return { label: `Deadline: ${deadlineStr} (Passed)`, tone: 'past' };
    if (diffDays === 0) return { label: `Deadline: ${deadlineStr} (Today)`, tone: 'soon' };
    if (diffDays === 1) return { label: `Deadline: ${deadlineStr} (Tomorrow)`, tone: 'soon' };
    return { label: `Deadline: ${deadlineStr}`, tone: 'normal' };
  }

  function createJobCard(job) {
    const card = document.createElement('article');
    card.className = 'job-card';
    card.draggable = true;
    card.dataset.jobId = job.id;

    card.addEventListener('dragstart', (event) => {
      draggedJobId = job.id;
      card.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', job.id);
      }
    });

    card.addEventListener('dragend', () => {
      draggedJobId = null;
      card.classList.remove('is-dragging');
      for (const col of columns) {
        col.classList.remove('is-drag-over');
      }
    });

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-role';
    titleEl.textContent = job.role || 'Untitled role';
    card.appendChild(titleEl);

    const companyEl = document.createElement('p');
    companyEl.className = 'card-company' + (job.company ? '' : ' is-muted');
    companyEl.textContent = job.company || 'No company specified';
    card.appendChild(companyEl);

    const badgeInfo = getDeadlineBadgeState(job.deadline);
    if (badgeInfo) {
      const deadlineEl = document.createElement('div');
      deadlineEl.className = 'card-deadline is-' + badgeInfo.tone;
      deadlineEl.textContent = badgeInfo.label;
      card.appendChild(deadlineEl);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const normalizedUrl = JobClipper.normalizeExternalUrl(job.link);
    if (normalizedUrl) {
      const linkEl = document.createElement('a');
      linkEl.className = 'card-link';
      linkEl.href = normalizedUrl;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = 'Open job page';
      actions.appendChild(linkEl);
    } else {
      const noLinkEl = document.createElement('span');
      noLinkEl.className = 'card-no-link';
      noLinkEl.textContent = 'No link';
      actions.appendChild(noLinkEl);
    }

    const btnGroup = document.createElement('div');
    btnGroup.className = 'card-btn-group';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-card';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(job));
    btnGroup.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-card btn-card-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      try {
        await JobClipper.deleteJob(job.id);
        await refreshBoard();
      } catch (err) {
        console.error('Job Clipper: failed to delete job:', err);
        deleteBtn.disabled = false;
      }
    });
    btnGroup.appendChild(deleteBtn);

    actions.appendChild(btnGroup);
    card.appendChild(actions);

    return card;
  }

  function renderBoard() {
    const query = searchInput.value.trim().toLowerCase();
    const filteredJobs = query
      ? allJobs.filter((job) => {
          const roleMatch = (job.role || '').toLowerCase().includes(query);
          const companyMatch = (job.company || '').toLowerCase().includes(query);
          return roleMatch || companyMatch;
        })
      : allJobs;

    const totalCount = allJobs.length;
    if (query) {
      boardSummary.textContent = `Showing ${filteredJobs.length} of ${totalCount} ${totalCount === 1 ? 'job' : 'jobs'}`;
    } else {
      boardSummary.textContent = `${totalCount} ${totalCount === 1 ? 'job' : 'jobs'} tracked`;
    }

    for (const status of JobClipper.STATUSES) {
      const listEl = document.querySelector(`.column-list[data-list-for="${status}"]`);
      const countEl = document.querySelector(`.column-count[data-count-for="${status}"]`);
      if (!listEl || !countEl) continue;

      const columnJobs = filteredJobs.filter(
        (job) => (JobClipper.STATUSES.includes(job.status) ? job.status : 'Saved') === status
      );

      countEl.textContent = String(columnJobs.length);

      if (columnJobs.length === 0) {
        const emptyEl = document.createElement('p');
        emptyEl.className = 'column-empty';
        emptyEl.textContent = query ? 'No matching jobs' : `No jobs in ${status}`;
        listEl.replaceChildren(emptyEl);
      } else {
        const fragment = document.createDocumentFragment();
        for (const job of columnJobs) {
          fragment.appendChild(createJobCard(job));
        }
        listEl.replaceChildren(fragment);
      }
    }
  }

  async function refreshBoard() {
    allJobs = await JobClipper.getJobs();
    renderBoard();
  }

  function openAddModal() {
    editingJobId = null;
    modalTitle.textContent = 'Add Job';
    modalSaveBtn.textContent = 'Add job';
    modalRole.value = '';
    modalCompany.value = '';
    modalLink.value = '';
    modalDeadline.value = '';
    modalStatus.value = 'Saved';
    modalError.textContent = '';
    modal.showModal();
    modalRole.focus();
  }

  function openEditModal(job) {
    editingJobId = job.id;
    modalTitle.textContent = 'Edit Job';
    modalSaveBtn.textContent = 'Save changes';
    modalRole.value = job.role || '';
    modalCompany.value = job.company || '';
    modalLink.value = job.link || '';
    modalDeadline.value = job.deadline || '';
    modalStatus.value = JobClipper.STATUSES.includes(job.status) ? job.status : 'Saved';
    modalError.textContent = '';
    modal.showModal();
    modalRole.focus();
  }

  function closeModal() {
    editingJobId = null;
    modalError.textContent = '';
    if (modal.open) {
      modal.close();
    }
  }

  // Drag-and-drop listeners on each column
  for (const col of columns) {
    const targetStatus = col.dataset.status;

    col.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      col.classList.add('is-drag-over');
    });

    col.addEventListener('dragleave', (event) => {
      // Only clear highlight when actually leaving the column element
      if (!col.contains(event.relatedTarget)) {
        col.classList.remove('is-drag-over');
      }
    });

    col.addEventListener('drop', async (event) => {
      event.preventDefault();
      col.classList.remove('is-drag-over');

      const transferId = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
      const jobId = transferId || draggedJobId;
      if (!jobId || !JobClipper.STATUSES.includes(targetStatus)) return;

      const existing = allJobs.find((j) => j.id === jobId);
      if (!existing || existing.status === targetStatus) return;

      try {
        await JobClipper.updateJob(jobId, { status: targetStatus });
        await refreshBoard();
      } catch (err) {
        console.error('Job Clipper: failed to move card:', err);
      }
    });
  }

  searchInput.addEventListener('input', () => {
    renderBoard();
  });

  addJobBtn.addEventListener('click', openAddModal);
  modalCancelBtn.addEventListener('click', closeModal);
  modalCloseBtn.addEventListener('click', closeModal);

  modalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    modalError.textContent = '';

    const role = modalRole.value.trim();
    const company = modalCompany.value.trim();
    const link = modalLink.value.trim();
    const deadline = modalDeadline.value.trim();
    const status = modalStatus.value;

    if (!role) {
      modalError.textContent = 'Please enter a role title.';
      modalRole.focus();
      return;
    }

    modalSaveBtn.disabled = true;
    try {
      if (editingJobId) {
        await JobClipper.updateJob(editingJobId, {
          role,
          company,
          link,
          deadline,
          status,
          resyncAlarm: true
        });
      } else {
        await JobClipper.addJob({ role, company, link, deadline, status });
      }
      closeModal();
      await refreshBoard();
    } catch (err) {
      console.error('Job Clipper: failed to save job:', err);
      modalError.textContent = 'Could not save job. Please try again.';
    } finally {
      modalSaveBtn.disabled = false;
    }
  });

  exportCsvBtn.addEventListener('click', async () => {
    try {
      const jobs = await JobClipper.getJobs();
      const csvContent = JobClipper.buildCsvContent(jobs);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'job-clipper-jobs.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Job Clipper: failed to export CSV:', err);
    }
  });

  // Live updates when jobs are clipped from the popup while the board is open
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[JobClipper.STORAGE_KEY]) {
      allJobs = Array.isArray(changes[JobClipper.STORAGE_KEY].newValue)
        ? changes[JobClipper.STORAGE_KEY].newValue
        : [];
      renderBoard();
    }
  });

  await refreshBoard();
});
