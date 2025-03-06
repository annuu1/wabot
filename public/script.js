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
    } else {
      statusDiv.textContent = `Error: ${data.error}`;
      statusDiv.classList.add('error');
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.classList.add('error');
  }
});

// Send form
document.getElementById('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const settings = {
    batchSize: formData.get('batchSize'),
    minDelay: formData.get('minDelay'),
    maxDelay: formData.get('maxDelay'),
    breakAfter: formData.get('breakAfter'),
    breakDuration: formData.get('breakDuration') * 60000, // Convert to ms
  };
  const statusDiv = document.getElementById('sendStatus');
  statusDiv.textContent = 'Sending...';

  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await response.json();
    if (response.ok) {
      statusDiv.textContent = `Sent ${data.sent || 0} messages`;
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

// Load pending messages
async function loadPendingMessages() {
  const list = document.getElementById('pendingList');
  list.innerHTML = 'Loading...';
  try {
    const response = await fetch('/api/pending');
    const messages = await response.json();
    list.innerHTML = messages.length
      ? messages.map(m => `<li>${m.phoneNumber}: ${m.content} ${m.filePath ? '(with file)' : ''}</li>`).join('')
      : 'No pending messages';
  } catch (error) {
    list.innerHTML = `Error: ${error.message}`;
  }
}

loadPendingMessages(); // Initial load