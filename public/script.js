let token = localStorage.getItem('token');
let userRole = localStorage.getItem('role');
let userTeam = localStorage.getItem('team');
let currentPage = 1;

// Tab switching
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const statusDiv = document.getElementById('loginStatus');
  statusDiv.textContent = 'Logging in...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: formData.get('username'), password: formData.get('password') }),
    });
    const data = await response.json();
    statusDiv.textContent = data.error || 'Login successful';
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) {
      token = data.token;
      userRole = data.role;
      userTeam = data.team;
      localStorage.setItem('token', token);
      localStorage.setItem('role', userRole);
      localStorage.setItem('team', userTeam);
      document.getElementById('login').classList.remove('active');
      document.getElementById('main').classList.remove('hidden');
      setupUI();
      loadCampaigns();
      loadPendingMessages();
      loadStats();
      if (userRole === 'superadmin') loadTeams();
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Check login on load
if (token && userRole) {
  document.getElementById('login').classList.remove('active');
  document.getElementById('main').classList.remove('hidden');
  setupUI();
  loadCampaigns();
  loadPendingMessages();
  loadStats();
  if (userRole === 'superadmin') loadTeams();
}

// Setup UI based on role
function setupUI() {
  const tabs = document.querySelector('.tabs');
  const logoutBtn = document.getElementById('logoutBtn');
  if (userRole === 'agent') {
    tabs.querySelector('[data-tab="upload"]').style.display = 'none';
    tabs.querySelector('[data-tab="update"]').style.display = 'none';
    tabs.querySelector('[data-tab="users"]').style.display = 'none';
    tabs.querySelector('[data-tab="teams"]').style.display = 'none';
    logoutBtn.style.display = 'none';
    switchTab('send');
  } else if (userRole === 'admin') {
    tabs.querySelector('[data-tab="users"]').style.display = 'block';
    tabs.querySelector('[data-tab="teams"]').style.display = 'none';
    logoutBtn.style.display = 'none';
    document.getElementById('userRole').innerHTML = '<option value="agent">Agent</option>';
    document.getElementById('userTeam').style.display = 'none';
    document.querySelector('label[for="userTeam"]').style.display = 'none';
  } else if (userRole === 'superadmin') {
    tabs.querySelector('[data-tab="users"]').style.display = 'block';
    tabs.querySelector('[data-tab="teams"]').style.display = 'block';
    logoutBtn.style.display = 'block';
  }
}

// Load campaigns
async function loadCampaigns() {
  try {
    const response = await fetch('/api/campaigns', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Failed to fetch campaigns');
    const campaigns = await response.json();
    const sendDropdown = document.getElementById('sendCampaign');
    const bulkDropdown = document.getElementById('bulkCampaign');
    const filterDropdown = document.getElementById('filterCampaign');
    const dashboardDropdown = document.getElementById('dashboardCampaign');

    const options = campaigns.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
    sendDropdown.innerHTML = '<option value="">All Campaigns</option>' + options;
    bulkDropdown.innerHTML = '<option value="">Select a Campaign</option>' + options;
    filterDropdown.innerHTML = '<option value="">All Campaigns</option>' + options;
    dashboardDropdown.innerHTML = '<option value="">All Campaigns</option>' + options;
  } catch (error) {
    console.error('Failed to load campaigns:', error);
    alert('Error loading campaigns: ' + error.message);
  }
}

// Load teams
async function loadTeams() {
  try {
    const response = await fetch('/api/teams', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Failed to fetch teams');
    const teams = await response.json();
    const teamDropdown = document.getElementById('userTeam');
    teamDropdown.innerHTML = '<option value="">None</option>' + teams.map(t => `<option value="${t._id}">${t.name}</option>`).join('');
  } catch (error) {
    console.error('Failed to load teams:', error);
    alert('Error loading teams: ' + error.message);
  }
}

// Load stats
async function loadStats(campaignId = '') {
  try {
    const url = campaignId ? `/api/stats?campaignId=${campaignId}` : '/api/stats';
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Failed to fetch stats');
    const stats = await response.json();
    document.getElementById('totalCampaigns').textContent = stats.totalCampaigns;
    document.getElementById('pendingMessages').textContent = stats.pendingMessages;
    document.getElementById('sentMessages').textContent = stats.sentMessages;
    document.getElementById('failedMessages').textContent = stats.failedMessages;
  } catch (error) {
    console.error('Failed to load stats:', error);
    alert('Error loading stats: ' + error.message);
  }
}

// WebSocket
const ws = new WebSocket(`ws://localhost:${location.port}`);
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === 'stats' && (userRole === 'superadmin' || data.teamId === userTeam)) {
    const campaignId = document.getElementById('dashboardCampaign').value;
    if (!campaignId || campaignId === data.campaignId) {
      document.getElementById('totalCampaigns').textContent = data.totalCampaigns;
      document.getElementById('pendingMessages').textContent = data.pendingMessages;
      document.getElementById('sentMessages').textContent = data.sentMessages;
      document.getElementById('failedMessages').textContent = data.failedMessages;
    }
  } else if (type === 'qr') {
    alert('Please scan this QR code to connect WhatsApp:\n' + data);
  }
};
ws.onerror = () => console.error('WebSocket error');
ws.onclose = () => console.log('WebSocket closed');

// Upload form
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const statusDiv = document.getElementById('uploadStatus');
  statusDiv.textContent = 'Uploading...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await response.json();
    statusDiv.textContent = data.message || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) {
      loadPendingMessages();
      loadCampaigns();
      loadStats();
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Start sending
document.getElementById('startBtn').addEventListener('click', async () => {
  const formData = new FormData(document.getElementById('sendForm'));
  const settings = {
    campaignId: formData.get('campaignId') || undefined, // Send undefined instead of ""
    batchSize: formData.get('batchSize'),
    minDelay: formData.get('minDelay'),
    maxDelay: formData.get('maxDelay'),
    breakAfter: formData.get('breakAfter'),
    breakDuration: formData.get('breakDuration') * 60000,
  };
  const statusDiv = document.getElementById('sendStatus');
  statusDiv.textContent = 'Starting...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(settings),
    });
    const data = await response.json();
    statusDiv.textContent = `Sent ${data.sent || 0} messages (${data.status})` || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) {
      loadPendingMessages();
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Stop sending
document.getElementById('stopBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('sendStatus');
  statusDiv.textContent = 'Stopping...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    statusDiv.textContent = data.message || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) {
      loadPendingMessages();
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Bulk update
document.getElementById('bulkUpdateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const statusDiv = document.getElementById('bulkUpdateStatus');
  statusDiv.textContent = 'Updating...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/bulk-update', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await response.json();
    statusDiv.textContent = data.message || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) {
      loadPendingMessages();
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Delete campaign
document.getElementById('deleteCampaignBtn').addEventListener('click', async () => {
  const campaignId = document.getElementById('bulkCampaign').value;
  if (!campaignId || !confirm('Are you sure you want to delete this campaign and all its messages?')) return;
  const statusDiv = document.getElementById('bulkUpdateStatus');
  statusDiv.textContent = 'Deleting...';
  statusDiv.className = '';

  try {
    const response = await fetch(`/api/campaign/${campaignId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    statusDiv.textContent = data.message || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) {
      loadPendingMessages();
      loadCampaigns();
      document.getElementById('bulkCampaign').value = '';
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Load pending messages with pagination
async function loadPendingMessages(page = currentPage) {
  const list = document.getElementById('pendingList');
  const campaignId = document.getElementById('filterCampaign').value;
  list.innerHTML = 'Loading...';
  try {
    const url = campaignId ? `/api/pending?campaignId=${campaignId}&page=${page}` : `/api/pending?page=${page}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Failed to fetch pending messages');
    const { messages, total, page: current, pages } = await response.json();
    currentPage = current;

    list.innerHTML = messages.length
      ? messages.map(m => `
          <li>
            ${m.customerId.phoneNumber} (${m.customerId.name || 'Unknown'}): "${m.campaignId?.content || 'No content'}" 
            (Campaign: ${m.campaignId?.name || 'Unnamed'}) 
            ${userRole === 'superadmin' ? `(Team: ${m.campaignId?.team || 'No Team'})` : ''} 
            ${m.campaignId?.filePath ? '(with file)' : ''}
            ${(userRole === 'superadmin' || userRole === 'admin') ? `<button class="delete-btn" onclick="deleteMessage('${m._id}')">Delete</button>` : ''}
          </li>
        `).join('')
      : 'No pending messages for this team/campaign';
    document.getElementById('pageInfo').textContent = `Page ${current} of ${pages}`;
    document.getElementById('prevPage').disabled = current === 1;
    document.getElementById('nextPage').disabled = current === pages;
  } catch (error) {
    list.innerHTML = `Error: ${error.message}`;
  }
}

// Pagination controls
document.getElementById('prevPage').addEventListener('click', () => {
  if (currentPage > 1) loadPendingMessages(currentPage - 1);
});
document.getElementById('nextPage').addEventListener('click', () => {
  loadPendingMessages(currentPage + 1);
});

// Delete message
async function deleteMessage(messageId) {
  if (!confirm('Are you sure you want to delete this message?')) return;
  try {
    const response = await fetch(`/api/message/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    alert(data.message || data.error);
    if (response.ok) loadPendingMessages();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

// Add user
document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const statusDiv = document.getElementById('userStatus');
  statusDiv.textContent = 'Adding user...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
        role: formData.get('role'),
        team: userRole === 'admin' ? userTeam : formData.get('team') || undefined,
      }),
    });
    const data = await response.json();
    statusDiv.textContent = data.message || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Add team
document.getElementById('teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const statusDiv = document.getElementById('teamStatus');
  statusDiv.textContent = 'Adding team...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: formData.get('name') }),
    });
    const data = await response.json();
    statusDiv.textContent = data.message || data.error;
    statusDiv.className = response.ok ? 'success' : 'error';
    if (response.ok) loadTeams();
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Logout WhatsApp
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to logout from WhatsApp?')) return;
  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    alert(data.message || data.error);
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

// Logout User
document.getElementById('logoutUserBtn').addEventListener('click', () => {
  token = null;
  userRole = null;
  userTeam = null;
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('team');
  document.getElementById('main').classList.add('hidden');
  document.getElementById('login').classList.add('active');
});

// Sync campaign filters
function syncCampaignFilters() {
  const dashboardCampaign = document.getElementById('dashboardCampaign');
  const filterCampaign = document.getElementById('filterCampaign');
  const value = dashboardCampaign.value;
  filterCampaign.value = value;
  loadPendingMessages();
  loadStats(value);
}

document.getElementById('dashboardCampaign').addEventListener('change', syncCampaignFilters);
document.getElementById('filterCampaign').addEventListener('change', () => {
  const filterCampaign = document.getElementById('filterCampaign');
  const dashboardCampaign = document.getElementById('dashboardCampaign');
  dashboardCampaign.value = filterCampaign.value;
  loadStats(filterCampaign.value);
  loadPendingMessages();
});