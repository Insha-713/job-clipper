'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('clip-form');
  const roleInput = document.getElementById('role');
  const companyInput = document.getElementById('company');
  const linkInput = document.getElementById('link');
  const deadlineInput = document.getElementById('deadline');
  const detectStatus = document.getElementById('detect-status');
  const formFeedback = document.getElementById('form-feedback');
  const addBtn = document.getElementById('add-btn');
  const openBoardBtn = document.getElementById('open-board-btn');

  function setStatus(message, tone) {
    detectStatus.textContent = message;
    detectStatus.className = 'detect-status' + (tone ? ' is-' + tone : '');
  }

  function setFeedback(message, tone) {
    formFeedback.textContent = message;
    formFeedback.className = 'form-feedback' + (tone ? ' is-' + tone : '');
  }

  function isScriptableUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'chromewebstore.google.com' ||
        (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) ||
        host === 'microsoftedge.microsoft.com'
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Self-contained function executed inside the active tab via chrome.scripting.executeScript.
   * Must not reference any variables outside its own scope.
   */
  function extractJobMetadataFromPage() {
    const MONTHS = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12
    };

    function toIsoDate(year, month, day) {
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
      if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return '';
      const probe = new Date(year, month - 1, day);
      if (
        probe.getFullYear() !== year ||
        probe.getMonth() !== month - 1 ||
        probe.getDate() !== day
      ) {
        return '';
      }
      return (
        String(year).padStart(4, '0') + '-' +
        String(month).padStart(2, '0') + '-' +
        String(day).padStart(2, '0')
      );
    }

    function parseDateFromText(raw) {
      if (!raw || typeof raw !== 'string') return '';
      const text = raw.trim();
      if (!text) return '';

      // 1. ISO date or datetime: YYYY-MM-DD or YYYY/MM/DD (including YYYY-MM-DDTHH:mm:ssZ)
      const isoMatch = /(?:^|[^\d])(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[^\d])/.exec(text);
      if (isoMatch) {
        const res = toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
        if (res) return res;
      }

      // 2. Month DD, YYYY (e.g., November 20, 2026 or Nov 20th, 2026)
      const mdyNameMatch = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text);
      if (mdyNameMatch) {
        const month = MONTHS[mdyNameMatch[1].toLowerCase()];
        if (month) {
          const res = toIsoDate(Number(mdyNameMatch[3]), month, Number(mdyNameMatch[2]));
          if (res) return res;
        }
      }

      // 3. DD Month YYYY (e.g., 20 November 2026 or 20th Nov 2026)
      const dmyNameMatch = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/i.exec(text);
      if (dmyNameMatch) {
        const month = MONTHS[dmyNameMatch[2].toLowerCase()];
        if (month) {
          const res = toIsoDate(Number(dmyNameMatch[3]), month, Number(dmyNameMatch[1]));
          if (res) return res;
        }
      }

      // 4. Numeric MM/DD/YYYY or DD/MM/YYYY
      const numMatch = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
      if (numMatch) {
        const a = Number(numMatch[1]);
        const b = Number(numMatch[2]);
        const y = Number(numMatch[3]);
        if (a > 12) {
          const res = toIsoDate(y, b, a);
          if (res) return res;
        } else if (b > 12) {
          const res = toIsoDate(y, a, b);
          if (res) return res;
        } else {
          const res = toIsoDate(y, a, b);
          if (res) return res;
        }
      }

      return '';
    }

    function isJobPostingType(typeVal) {
      if (!typeVal) return false;
      const list = Array.isArray(typeVal) ? typeVal : [typeVal];
      return list.some((t) => {
        if (typeof t !== 'string') return false;
        const normalized = t.trim().toLowerCase();
        return normalized === 'jobposting' || normalized.endsWith('/jobposting');
      });
    }

    function findJobPosting(node) {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = findJobPosting(item);
          if (found) return found;
        }
        return null;
      }
      if (isJobPostingType(node['@type'])) {
        return node;
      }
      if (Array.isArray(node['@graph'])) {
        const found = findJobPosting(node['@graph']);
        if (found) return found;
      }
      for (const key of Object.keys(node)) {
        if (key === '@context' || key === '@type') continue;
        const val = node[key];
        if (val && typeof val === 'object') {
          const found = findJobPosting(val);
          if (found) return found;
        }
      }
      return null;
    }

    function extractOrgName(org) {
      if (!org) return '';
      if (typeof org === 'string') return org.trim();
      if (Array.isArray(org)) {
        for (const item of org) {
          const name = extractOrgName(item);
          if (name) return name;
        }
        return '';
      }
      if (typeof org === 'object' && typeof org.name === 'string') {
        return org.name.trim();
      }
      return '';
    }

    let role = '';
    let company = '';
    let deadline = '';

    // 1. JSON-LD JobPosting
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const rawJson = script.textContent;
        if (!rawJson || !rawJson.trim()) continue;
        const parsed = JSON.parse(rawJson);
        const posting = findJobPosting(parsed);
        if (posting) {
          if (!role && typeof posting.title === 'string') {
            role = posting.title.trim();
          }
          if (!company) {
            company = extractOrgName(posting.hiringOrganization);
          }
          if (!deadline && typeof posting.validThrough === 'string') {
            deadline = parseDateFromText(posting.validThrough);
          }
          if (role && company && deadline) break;
        }
      } catch {
        // Ignore malformed JSON-LD blocks on third-party pages.
      }
    }

    // 2. Open Graph / meta tags
    function getMetaContent(key) {
      const el =
        document.querySelector(`meta[property="${key}"]`) ||
        document.querySelector(`meta[name="${key}"]`);
      return el && typeof el.content === 'string' ? el.content.trim() : '';
    }

    if (!role) {
      role = getMetaContent('og:title');
    }
    if (!company) {
      company = getMetaContent('og:site_name');
    }

    // 3. First h1 / document.title
    if (!role) {
      const headings = document.querySelectorAll('h1');
      for (const h1 of headings) {
        const txt = (h1.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) {
          role = txt;
          break;
        }
      }
    }
    if (!role && typeof document.title === 'string') {
      role = document.title.replace(/\s+/g, ' ').trim();
    }

    // 4. Text near deadline keywords
    if (!deadline) {
      const keywordRegex = /\b(?:application\s+deadline|deadline|last\s+date(?:\s+to\s+apply)?|apply\s+by|closes\s+on|closing\s+date|due\s+date|valid\s+through)\b/gi;

      // Check <time> elements near deadline-labeled containers first
      const timeEls = document.querySelectorAll('time[datetime]');
      for (const timeEl of timeEls) {
        const containerText = (timeEl.parentElement ? timeEl.parentElement.textContent : timeEl.textContent) || '';
        keywordRegex.lastIndex = 0;
        if (keywordRegex.test(containerText)) {
          const parsed = parseDateFromText(timeEl.getAttribute('datetime') || timeEl.textContent || '');
          if (parsed) {
            deadline = parsed;
            break;
          }
        }
      }

      // Scan visible body text near keywords
      if (!deadline && document.body) {
        const bodyText = document.body.innerText || document.body.textContent || '';
        keywordRegex.lastIndex = 0;
        let match;
        while ((match = keywordRegex.exec(bodyText)) !== null) {
          const start = match.index + match[0].length;
          const windowText = bodyText.slice(start, start + 90);
          const parsed = parseDateFromText(windowText);
          if (parsed) {
            deadline = parsed;
            break;
          }
        }
      }
    }

    // 5. Fallback to hostname for company
    if (!company && window.location && window.location.hostname) {
      company = window.location.hostname.replace(/^www\./i, '');
    }

    return { role, company, deadline };
  }

  async function detectCurrentTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];

      if (!tab || typeof tab.id !== 'number' || !isScriptableUrl(tab.url)) {
        setStatus('Manual entry mode (this page cannot be auto-filled).', 'muted');
        return;
      }

      linkInput.value = tab.url;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractJobMetadataFromPage
      });

      const data = results && results[0] && results[0].result;
      if (data) {
        if (data.role) roleInput.value = data.role;
        if (data.company) companyInput.value = data.company;
        if (data.deadline) deadlineInput.value = data.deadline;

        const detectedAny = Boolean(data.role || data.company || data.deadline);
        if (detectedAny) {
          setStatus('Pre-filled from page. Edit any field if needed.', 'info');
        } else {
          setStatus('No details auto-detected. Enter fields manually.', 'muted');
        }
      } else {
        setStatus('No details auto-detected. Enter fields manually.', 'muted');
      }
    } catch {
      // Leave fields empty and editable when scripting is blocked or fails.
      setStatus('Auto-fill unavailable on this page. Enter fields manually.', 'muted');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFeedback('', '');

    const role = roleInput.value.trim();
    const company = companyInput.value.trim();
    const link = linkInput.value.trim();
    const deadline = deadlineInput.value.trim();

    if (!role) {
      setFeedback('Please enter a role title.', 'error');
      roleInput.focus();
      return;
    }

    addBtn.disabled = true;
    try {
      await JobClipper.addJob({ role, company, link, deadline, status: 'Saved' });
      setFeedback('Added to board!', 'success');
    } catch (err) {
      console.error('Job Clipper: failed to add job:', err);
      setFeedback('Could not save job. Please try again.', 'error');
    } finally {
      addBtn.disabled = false;
    }
  });

  openBoardBtn.addEventListener('click', async () => {
    try {
      await JobClipper.openBoardTab();
    } catch (err) {
      console.error('Job Clipper: failed to open board:', err);
      setFeedback('Could not open board tab.', 'error');
    }
  });

  await detectCurrentTab();
});
