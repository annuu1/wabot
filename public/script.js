document.getElementById('messageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneNumber = document.getElementById('phoneNumber').value;
    const name = document.getElementById('name').value;
    const messageContent = document.getElementById('messageContent').value;
  
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Sending...';
  
    try {
      const response = await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, name, messageContent }),
      });
      const data = await response.json();
      if (response.ok) {
        statusDiv.textContent = `Message queued for ${data.phoneNumber}`;
      } else {
        statusDiv.textContent = `Error: ${data.error}`;
        statusDiv.style.color = 'red';
      }
    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.style.color = 'red';
    }
  });