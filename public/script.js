// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Load campaigns into dropdowns
async function loadCampaigns() {
  try {
    const response = await fetch('/api/campaigns');
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
  }
}

// Load dashboard stats with campaign filter
async function loadStats(campaignId = '') {
  try {
    const url = campaignId ? `/api/stats?campaignId=${campaignId}` : '/api/stats';
    const response = await fetch(url);
    const stats = await response.json();
    document.getElementById('totalCampaigns').textContent = stats.totalCampaigns;
    document.getElementById('pendingMessages').textContent = stats.pendingMessages;
    document.getElementById('sentMessages').textContent = stats.sentMessages;
    document.getElementById('failedMessages').textContent = stats.failedMessages;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

// WebSocket connection
const ws = new WebSocket(`ws://localhost:${location.port}`);
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === 'stats') {
    const campaignId = document.getElementById('dashboardCampaign').value;
    if (!campaignId || campaignId === data.campaignId) {
      document.getElementById('totalCampaigns').textContent = data.totalCampaigns;
      document.getElementById('pendingMessages').textContent = data.pendingMessages;
      document.getElementById('sentMessages').textContent = data.sentMessages;
      document.getElementById('failedMessages').textContent = data.failedMessages;
    }
  }
};

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
      body: formData,
    });
    const data = await response.json();
    statusDiv.textContent = data.message;
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
    campaignId: formData.get('campaignId'),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await response.json();
    statusDiv.textContent = `Sent ${data.sent || 0} messages (${data.status})`;
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
    const response = await fetch('/api/stop', { method: 'POST' });
    const data = await response.json();
    statusDiv.textContent = data.message;
    statusDiv.className = 'success';
    loadPendingMessages();
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'error';
  }
});

// Bulk update form
document.getElementById('bulkUpdateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const campaignId = formData.get('campaignId');
  const content = formData.get('content');
  const statusDiv = document.getElementById('bulkUpdateStatus');
  statusDiv.textContent = 'Updating...';
  statusDiv.className = '';

  try {
    const response = await fetch('/api/bulk-update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, content }),
    });
    const data = await response.json();
    statusDiv.textContent = data.message;
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
    const response = await fetch(`/api/campaign/${campaignId}`, { method: 'DELETE' });
    const data = await response.json();
    statusDiv.textContent = data.message;
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

// Load pending messages with campaign filter
async function loadPendingMessages() {
  const list = document.getElementById('pendingList');
  const campaignId = document.getElementById('filterCampaign').value;
  list.innerHTML = 'Loading...';
  try {
    const url = campaignId ? `/api/pending?campaignId=${campaignId}` : '/api/pending';
    const response = await fetch(url);
    const messages = await response.json();
    list.innerHTML = messages.length
      ? messages.map(m => `
          <li>
            ${m.phoneNumber}: "${m.campaignId?.content || 'No content'}" 
            (Campaign: ${m.campaignId?.name || 'Unnamed'}) 
            ${m.campaignId?.filePath ? '(with file)' : ''}
            <button class="delete-btn" onclick="deleteMessage('${m._id}')">Delete</button>
          </li>
        `).join('')
      : 'No pending messages for this campaign';
  } catch (error) {
    list.innerHTML = `Error: ${error.message}`;
  }
}

// Delete individual message
async function deleteMessage(messageId) {
  if (!confirm('Are you sure you want to delete this message?')) return;
  try {
    const response = await fetch(`/api/message/${messageId}`, { method: 'DELETE' });
    const data = await response.json();
    alert(data.message);
    loadPendingMessages();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

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
});

// Initial load
loadCampaigns();
loadPendingMessages();
loadStats();