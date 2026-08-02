// ActiveCollab API v1 client. Verified empirically against a self-hosted v8.0.31 instance
// (2026-08-02). Auth header name and endpoint shapes are NOT fully documented upstream,
// so if a call here starts failing against a different ActiveCollab version, that's why.

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

export async function issueToken(baseUrl, username, password) {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/issue-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      client_name: 'activecollab-cli',
      client_vendor: 'activecollab-cli',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.is_ok) {
    throw new Error(data.message || `Login failed (HTTP ${res.status})`);
  }
  return data.token;
}

export class Client {
  constructor({ baseUrl, token }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  async request(path) {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      headers: { 'X-Angie-AuthApiToken': this.token },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.message || message;
      } catch {
        /* body wasn't JSON, keep the plain HTTP status */
      }
      throw new Error(`${path} -> ${message}`);
    }
    return res.json();
  }

  info() {
    return this.request('/info');
  }

  users() {
    return this.request('/users');
  }

  async findUserByEmail(email) {
    const users = await this.users();
    return users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  }

  projects() {
    return this.request('/projects');
  }

  myTasks(userId) {
    return this.request(`/users/${userId}/tasks`);
  }

  taskDetail(projectId, taskId) {
    return this.request(`/projects/${projectId}/tasks/${taskId}`);
  }

  notifications() {
    return this.request('/notifications');
  }
}
