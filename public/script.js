// Load campaigns into dropdowns
async function loadCampaigns() {
  try {
    const response = await fetch('/api/campaigns');
    const campaigns = await response.json();
    const sendDropdown = document.getElementById('sendCampaign');
    const bulkDropdown = document.getElementById('bulkCampaign');
    const filterDropdown = document.getElementById('filterCampaign');

    const options = campaigns.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
    sendDropdown.innerHTML = '<option value="">All Campaigns</option>' + options;
    bulkDropdown.innerHTML = '<option value="">Select a Campaign</option>' + options;
    filterDropdown.innerHTML = '<option value="">All Campaigns</option>' + options;
  } catch (error) {
    console.error('Failed to load campaigns:', error);
  }
}

// Upload form
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const statusDiv = document.getElementById('uploadStatus');
  statusDiv.textContent = 'Uploading...';

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();
    if (response.ok) {
      statusDiv.textContent = data.message;
      loadPendingMessages();
      loadCampaigns();
    } else {
      statusDiv.textContent = `Error: ${data.error}`;
      statusDiv.classList.add('error');
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.classList.add('error');
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
    breakDuration: formData.get('breakDuration') * 60000, // Convert to ms
  };
  const statusDiv = document.getElementById('sendStatus');
  statusDiv.textContent = 'Starting...';

  try {
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await response.json();
    if (response.ok) {
      statusDiv.textContent = `Sent ${data.sent || 0} messages (${data.status})`;
      loadPendingMessages();
    } else {
      statusDiv.textContent = `Error: ${data.message}`;
      statusDiv.classList.add('error');
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.classList.add('error');
  }
});

// Stop sending
document.getElementById('stopBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('sendStatus');
  statusDiv.textContent = 'Stopping...';
  try {
    const response = await fetch('/api/stop', { method: 'POST' });
    const data = await response.json();
    statusDiv.textContent = data.message;
    loadPendingMessages();
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.classList.add('error');
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

  try {
    const response = await fetch('/api/bulk-update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, content }),
    });
    const data = await response.json();
    if (response.ok) {
      statusDiv.textContent = data.message;
      loadPendingMessages();
    } else {
      statusDiv.textContent = `Error: ${data.error}`;
      statusDiv.classList.add('error');
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.classList.add('error');
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
          </li>
        `).join('')
      : 'No pending messages';
  } catch (error) {
    list.innerHTML = `Error: ${error.message}`;
  }
}

// Filter pending messages on campaign change
document.getElementById('filterCampaign').addEventListener('change', loadPendingMessages);

// Initial load
loadCampaigns();
loadPendingMessages();