// ActiveCollab API v1 client.
// Every endpoint here was verified against a live self-hosted ActiveCollab 8.0.31
// instance (2026-08-13). Where the API is surprising, the surprise is documented
// inline rather than smoothed over, because the next reader will hit it too.

const USER_AGENT = 'acollab-cli';

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(message, { status, path, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export async function issueToken(baseUrl, username, password) {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/issue-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The instance sits behind a WAF that 403s some clients on User-Agent alone
      // (verified: "Python-urllib" is rejected while curl is not). Always be explicit.
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      username,
      password,
      client_name: 'acollab-cli',
      client_vendor: 'acollab-cli',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.is_ok) {
    throw new ApiError(data.message || `Login failed (HTTP ${res.status})`, {
      status: res.status,
      path: '/issue-token',
    });
  }
  return data.token;
}

export class Client {
  constructor({ baseUrl, token, concurrency = 6 }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.concurrency = concurrency;
    this.requestCount = 0;
  }

  async request(path) {
    const res = await this.fetchOk(path);
    return res.json();
  }

  // Returns the raw Response so binary bodies can be streamed instead of parsed.
  async fetchOk(path, { timeoutMs } = {}) {
    this.requestCount += 1;
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      headers: {
        'X-Angie-AuthApiToken': this.token,
        'User-Agent': USER_AGENT,
      },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      let body;
      try {
        body = await res.json();
        message = body.message || message;
      } catch {
        /* not JSON, keep the plain status */
      }
      throw new ApiError(message, { status: res.status, path, body });
    }
    return res;
  }

  // Runs tasks with a concurrency cap. The API is fine with ~6 in flight; going
  // wider does not measurably help and risks tripping the WAF.
  async mapLimit(items, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  // --- identity ---------------------------------------------------------

  info() {
    return this.request('/info');
  }

  // Richer than /users/{id}: carries the logged-in user id plus instance settings
  // (timezone, date format) that we need to render dates the way the user sees them.
  userSession() {
    return this.request('/user-session');
  }

  users() {
    return this.request('/users');
  }

  async findUserByEmail(email) {
    const users = await this.users();
    return users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  }

  // --- projects ---------------------------------------------------------

  projects() {
    return this.request('/projects');
  }

  archivedProjects() {
    return this.request('/projects/archive');
  }

  projectTasks(projectId) {
    return this.request(`/projects/${projectId}/tasks`);
  }

  // The only way to read completed tasks: /users/{id}/tasks omits them entirely
  // and ?include_completed=1 is silently ignored.
  projectArchivedTasks(projectId, page = 1) {
    return this.request(`/projects/${projectId}/tasks/archive?page=${page}`);
  }

  // The archive is paginated at a FIXED 30 per page (verified: per_page, limit and
  // count are all ignored). Fetching only the first page silently loses most of a
  // busy project's history, so walk until a short page arrives.
  async allProjectArchivedTasks(projectId, { maxPages = 40 } = {}) {
    const PAGE_SIZE = 30;
    const out = [];
    let page = 1;
    for (; page <= maxPages; page += 1) {
      const batch = await this.projectArchivedTasks(projectId, page);
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return { tasks: out, truncated: page > maxPages };
  }

  projectTimeRecords(projectId) {
    return this.request(`/projects/${projectId}/time-records`);
  }

  // --- tasks ------------------------------------------------------------

  // Open (non-completed) assignments for a user. Works for OTHER users too, as
  // long as the caller has permission to see them.
  userTasks(userId) {
    return this.request(`/users/${userId}/tasks`);
  }

  // There is no global /tasks/{id} route; the project id is mandatory.
  taskDetail(projectId, taskId) {
    return this.request(`/projects/${projectId}/tasks/${taskId}`);
  }

  taskTimeRecords(projectId, taskId) {
    return this.request(`/projects/${projectId}/tasks/${taskId}/time-records`);
  }

  // --- attachments ------------------------------------------------------

  // The only working way to fetch a file. The `download_url` on every attachment
  // object points at proxy.php with a `--DOWNLOAD-TOKEN--` placeholder and 404s
  // whether that placeholder is replaced by the API token or removed. This route
  // takes the normal API header and needs no project id. The Content-Disposition
  // filename is mangled for non-ASCII names (× arrives as Ã), so callers name the
  // file from the attachment object, not from the response.
  downloadAttachment(attachmentId, options) {
    return this.fetchOk(`/attachments/${attachmentId}/download`, options);
  }

  // --- activity ---------------------------------------------------------

  notifications() {
    return this.request('/notifications');
  }

  // Server-side full-text search. `type` accepts a single class name ("Task",
  // "Project", ...); the array form type[]= returns a 500, so it is not offered.
  search(query, { type, page } = {}) {
    const params = new URLSearchParams({ q: query });
    if (type) params.set('type', type);
    if (page) params.set('page', String(page));
    return this.request(`/search?${params.toString()}`);
  }

  whatsNew() {
    return this.request('/whats-new');
  }

  // --- reference data ---------------------------------------------------

  taskLabels() {
    return this.request('/labels/task-labels');
  }

  teams() {
    return this.request('/teams');
  }

  companies() {
    return this.request('/companies');
  }

  jobTypes() {
    return this.request('/job-types');
  }
}
