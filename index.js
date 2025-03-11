const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parse');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Customer = require('./models/Customer');
const Message = require('./models/Message');
const Campaign = require('./models/Campaign');
const User = require('./models/User');
const Team = require('./models/Team');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Global variables for retry management and connection state
const MAX_RETRIES = 3; // Maximum retry attempts per message
const RETRY_BASE_DELAY = 5000; // Base delay in milliseconds (5 seconds)
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isConnected = false; // Custom flag to track connection state
let sock;
let isSending = false;

const JWT_SECRET = 'your-secret-key'; // Replace with a secure key in production


// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: 'uploads/' });

// MongoDB connection
mongoose.connect('mongodb+srv://krao53127:Pinkcity%407557@cluster0.sgxwf.mongodb.net/?retryWrites=true&w=majority')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Authentication middleware
const authenticate = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).populate('team');
    if (!req.user) return res.status(401).json({ error: 'Invalid token' });
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed: ' + error.message });
  }
};

// Role-based authorization middleware
const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// WebSocket broadcast function
function broadcastStats(campaignId = null, teamId = null) {
  wss.clients.forEach(async (client) => {
    if (client.readyState === WebSocket.OPEN) {
      const query = teamId ? { team: teamId } : {};
      if (campaignId) query.campaignId = campaignId;
      const stats = {
        totalCampaigns: await Campaign.countDocuments(teamId ? { team: teamId } : {}),
        pendingMessages: await Message.countDocuments({ ...query, status: 'pending' }),
        sentMessages: await Message.countDocuments({ ...query, status: 'sent' }),
        failedMessages: await Message.countDocuments({ ...query, status: 'failed' }),
        campaignId,
        teamId,
      };
      client.send(JSON.stringify({ type: 'stats', data: stats }));
    }
  });
}

// Initialize WhatsApp bot
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: require('pino')({ level: 'warn' }),
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      console.log('Scan this QR:', qrcode.generate(qr, { small: true }));
      wss.clients.forEach(client => client.send(JSON.stringify({ type: 'qr', data: qr })));
    }
    if (connection === 'open') {
      console.log('Bot connected to WhatsApp!');
      isConnected = true; // Set connection flag
      reconnectAttempts = 0; // Reset reconnect attempts
      isSending = false; // Reset sending state
    }
    if (connection === 'close') {
      isConnected = false; // Clear connection flag
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
      if (shouldReconnect) {
        reconnectAttempts++;
        const delay = RETRY_BASE_DELAY * Math.pow(2, reconnectAttempts); // Exponential backoff
        console.log(`Connection closed. Reconnecting in ${delay / 1000} seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        setTimeout(startBot, delay);
      } else {
        console.log('Max reconnect attempts reached or logged out. Please re-authenticate.');
        sock = null; // Clear socket reference
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Handle decryption errors (optional logging)
  sock.ev.on('messages.upsert', (m) => {
    // This is just to catch decryption errors in the logs, not directly related to sending
    if (m.messages.some(msg => msg.error)) {
      console.log('Message decryption error detected:', m.messages.filter(msg => msg.error));
    }
  });
}

// Send pending messages with retry limits and connection checks
async function sendPendingMessages(campaignId, teamId, batchSize = 10, minDelay = 1000, maxDelay = 5000, breakAfter = 50, breakDuration = 600000) {
  if (!sock || !isConnected) { // Use custom isConnected flag
    console.log('WhatsApp not connected. Waiting for reconnection...');
    return { status: 'error', message: 'WhatsApp not connected' };
  }
  if (!isSending) return { status: 'stopped', message: 'Sending stopped' };

  const query = { status: 'pending', team: teamId };
  if (campaignId && campaignId !== '') query.campaignId = campaignId;
  const pendingMessages = await Message.find(query).populate('customerId campaignId').limit(batchSize);
  let sentCount = 0;

  for (const msg of pendingMessages) {
    if (!isSending) {
      console.log('Sending stopped by user');
      return { status: 'stopped', sent: sentCount, message: 'Sending interrupted' };
    }

    let retries = msg.retries || 0; // Track retries per message
    let success = false;

    while (retries < MAX_RETRIES && !success && isSending) {
      try {
        if (!msg.campaignId) throw new Error('No campaign associated with message');
        if (!isConnected) throw new Error('Connection lost during sending');

        const jid = `${msg.phoneNumber}@s.whatsapp.net`;
        const messageContent = msg.campaignId.filePath
          ? { [msg.campaignId.fileType]: { url: msg.campaignId.filePath }, caption: msg.campaignId.content }
          : { text: msg.campaignId.content };

        await sock.sendMessage(jid, messageContent);
        msg.status = 'sent';
        msg.sentAt = new Date();
        success = true;
      } catch (error) {
        console.error(`Attempt ${retries + 1}/${MAX_RETRIES} failed for ${msg.phoneNumber}:`, error.message);
        retries++;
        msg.retries = retries;

        if (retries >= MAX_RETRIES) {
          msg.status = 'failed';
          console.log(`Max retries reached for ${msg.phoneNumber}. Marking as failed.`);
        } else {
          const retryDelay = RETRY_BASE_DELAY * Math.pow(2, retries); // Exponential backoff
          console.log(`Retrying in ${retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }

      await msg.save();
      if (success) {
        console.log(`Sent to ${msg.phoneNumber}: ${msg.campaignId.content} (Campaign: ${msg.campaignId.name})`);
        sentCount++;
        broadcastStats(campaignId || null, teamId);
      } else {
        broadcastStats(campaignId || null, teamId);
      }

      // Apply delay or break logic only on success
      if (success) {
        if (sentCount % breakAfter === 0 && sentCount < pendingMessages.length) {
          console.log(`Taking a break for ${breakDuration / 60000} minutes...`);
          await new Promise(resolve => setTimeout(resolve, breakDuration));
        } else {
          const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  return { status: 'success', sent: sentCount };
}

// API: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username }).populate('team');
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, role: user.role, team: user.team?._id });
  } catch (error) {
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

// API: Create Team (Super Admin only)
app.post('/api/teams', authenticate, authorize(['superadmin']), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name is required' });

  try {
    const team = new Team({ name, createdBy: req.user._id });
    await team.save();
    res.status(201).json({ message: `Team ${name} created`, teamId: team._id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create team: ' + error.message });
  }
});

// API: Get Teams (Super Admin only)
app.get('/api/teams', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const teams = await Team.find();
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch teams: ' + error.message });
  }
});

// API: Create User
app.post('/api/users', authenticate, async (req, res) => {
  const { username, password, role, team } = req.body;
  if (!['superadmin', 'admin', 'agent'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (req.user.role === 'admin' && role !== 'agent') {
    return res.status(403).json({ error: 'Admins can only create Agents' });
  }
  if (req.user.role === 'agent') {
    return res.status(403).json({ error: 'Agents cannot create users' });
  }
  if (role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only Super Admins can create Super Admins' });
  }
  if ((role === 'admin' || role === 'agent') && !team && req.user.role !== 'admin') {
    return res.status(400).json({ error: 'Team is required for Admins and Agents' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      password: hashedPassword,
      role,
      team: req.user.role === 'admin' ? req.user.team : team,
    });
    await user.save();
    res.status(201).json({ message: `User ${username} created` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user: ' + error.message });
  }
});

// API: Upload CSV and create campaign
app.post('/api/upload', authenticate, authorize(['superadmin', 'admin']), upload.fields([{ name: 'csvFile' }, { name: 'mediaFile' }]), async (req, res) => {
  const { messageContent, campaignName } = req.body;
  const csvFile = req.files['csvFile']?.[0];
  const mediaFile = req.files['mediaFile']?.[0];

  if (!csvFile || !messageContent || !campaignName) {
    return res.status(400).json({ error: 'CSV file, message content, and campaign name are required' });
  }
  if (req.user.role === 'admin' && !req.user.team) {
    return res.status(403).json({ error: 'Admin must belong to a team' });
  }

  const campaign = new Campaign({
    name: campaignName,
    content: messageContent,
    filePath: mediaFile ? path.join(__dirname, 'uploads', mediaFile.filename) : null,
    fileType: mediaFile ? (mediaFile.mimetype.startsWith('image') ? 'image' : 'document') : null,
    createdBy: req.user._id, // Ensure this is the Admin’s ObjectId
    team: req.user.team?._id,
  });
  await campaign.save();

  const phoneNumbers = [];
  fs.createReadStream(csvFile.path)
    .pipe(csv.parse({ columns: true, trim: true }))
    .on('data', (row) => {
      if (row.phoneNumber) phoneNumbers.push({ phoneNumber: row.phoneNumber, name: row.name || 'Unknown' });
    })
    .on('end', async () => {
      for (const { phoneNumber, name } of phoneNumbers) {
        let customer = await Customer.findOne({ phoneNumber, team: req.user.team?._id });
        if (!customer) {
          customer = new Customer({ phoneNumber, name, team: req.user.team?._id });
          await customer.save();
        }
        const message = new Message({
          customerId: customer._id,
          campaignId: campaign._id,
          phoneNumber,
          team: req.user.team?._id,
        });
        await message.save();
      }
      fs.unlinkSync(csvFile.path);
      if (mediaFile) fs.renameSync(mediaFile.path, path.join(__dirname, 'uploads', mediaFile.filename));
      res.status(201).json({ message: `${phoneNumbers.length} numbers added to campaign "${campaignName}"` });
      broadcastStats(null, req.user.team?._id);
    })
    .on('error', (error) => res.status(500).json({ error: 'CSV parsing failed: ' + error.message }));
});

// API: Start sending
app.post('/api/start', authenticate, authorize(['superadmin', 'admin', 'agent']), async (req, res) => {
  const { campaignId, batchSize, minDelay, maxDelay, breakAfter, breakDuration } = req.body;

  if (campaignId && campaignId !== '') {
    if (!mongoose.Types.ObjectId.isValid(campaignId)) {
      return res.status(400).json({ error: 'Invalid campaign ID' });
    }
  }

  if (req.user.role !== 'superadmin' && !req.user.team) {
    return res.status(403).json({ error: 'User must belong to a team' });
  }

  if (req.user.role === 'agent' && campaignId) {
    const campaign = await Campaign.findOne({ _id: campaignId, team: req.user.team });
    if (!campaign) {
      return res.status(403).json({ error: 'You can only send messages for your team’s campaigns' });
    }
  }

  if (isSending) return res.json({ status: 'running', message: 'Already sending' });
  isSending = true;

  try {
    const result = await sendPendingMessages(
      campaignId || null,
      req.user.team?._id,
      parseInt(batchSize) || 10,
      parseInt(minDelay) || 1000,
      parseInt(maxDelay) || 5000,
      parseInt(breakAfter) || 50,
      parseInt(breakDuration) || 600000
    );
    isSending = false;
    res.json(result);
  } catch (error) {
    isSending = false;
    res.status(500).json({ error: 'Failed to send messages: ' + error.message });
  }
});

// API: Stop sending
app.post('/api/stop', authenticate, authorize(['superadmin', 'admin', 'agent']), (req, res) => {
  isSending = false;
  res.json({ status: 'stopped', message: 'Sending stopped' });
  broadcastStats(null, req.user.team?._id);
});

// API: Bulk update
app.put('/api/bulk-update', authenticate, authorize(['superadmin', 'admin']), upload.single('mediaFile'), async (req, res) => {
  const { campaignId, content } = req.body;
  const mediaFile = req.file;

  if (!campaignId) return res.status(400).json({ error: 'Campaign ID is required' });
  if (!content && !mediaFile) return res.status(400).json({ error: 'Content or file is required to update' });

  try {
    const campaign = await Campaign.findOne({ _id: campaignId, team: req.user.team?._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found or not in your team' });

    // Debug logging
    console.log('Bulk Update - User ID:', req.user._id.toString());
    console.log('Bulk Update - Campaign CreatedBy:', campaign.createdBy.toString());
    console.log('Bulk Update - Role:', req.user.role);

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'You can only update your own campaigns' });
    }

    if (content) campaign.content = content;
    if (mediaFile) {
      if (campaign.filePath) fs.unlinkSync(campaign.filePath);
      campaign.filePath = path.join(__dirname, 'uploads', mediaFile.filename);
      campaign.fileType = mediaFile.mimetype.startsWith('image') ? 'image' : 'document';
    }
    await campaign.save();
    res.json({ message: `Campaign "${campaign.name}" updated` });
    broadcastStats(campaignId, req.user.team?._id);
  } catch (error) {
    if (mediaFile && fs.existsSync(mediaFile.path)) fs.unlinkSync(mediaFile.path);
    res.status(500).json({ error: 'Failed to update campaign: ' + error.message });
  }
});

// API: Get pending messages with pagination
app.get('/api/pending', authenticate, async (req, res) => {
  const { campaignId, page = 1 } = req.query;
  const limit = 20;
  const skip = (page - 1) * limit;
  const query = { status: 'pending' };
  
  // Super Admin sees all, others see only their team
  if (req.user.role !== 'superadmin') {
    if (!req.user.team) return res.status(403).json({ error: 'User must belong to a team' });
    query.team = req.user.team._id;
  }
  if (campaignId) query.campaignId = campaignId;

  try {
    const messages = await Message.find(query)
      .populate('customerId', 'phoneNumber name')
      .populate('campaignId', 'name content team')
      .skip(skip)
      .limit(limit);
    const total = await Message.countDocuments(query);
    res.json({ messages, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending messages: ' + error.message });
  }
});

// API: Get all campaigns
app.get('/api/campaigns', authenticate, async (req, res) => {
  const query = req.user.role === 'superadmin' ? {} : { team: req.user.team?._id };
  const campaigns = await Campaign.find(query);
  res.json(campaigns);
});

// API: Get stats
app.get('/api/stats', authenticate, async (req, res) => {
  const { campaignId } = req.query;
  const query = req.user.role === 'superadmin' ? {} : { team: req.user.team?._id };
  if (campaignId) query.campaignId = campaignId;
  try {
    const stats = {
      totalCampaigns: await Campaign.countDocuments(req.user.role === 'superadmin' ? {} : { team: req.user.team?._id }),
      pendingMessages: await Message.countDocuments({ ...query, status: 'pending' }),
      sentMessages: await Message.countDocuments({ ...query, status: 'sent' }),
      failedMessages: await Message.countDocuments({ ...query, status: 'failed' }),
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats: ' + error.message });
  }
});

// API: Delete campaign
app.delete('/api/campaign/:id', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await Campaign.findOne({ _id: id, team: req.user.team?._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found or not in your team' });

    // Debug logging
    console.log('Delete Campaign - User ID:', req.user._id.toString());
    console.log('Delete Campaign - Campaign CreatedBy:', campaign.createdBy.toString());
    console.log('Delete Campaign - Role:', req.user.role);

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'You can only delete your own campaigns' });
    }

    await Message.deleteMany({ campaignId: id, team: req.user.team?._id });
    await Campaign.deleteOne({ _id: id });
    if (campaign.filePath) fs.unlinkSync(campaign.filePath);
    res.json({ message: `Campaign "${campaign.name}" and its messages deleted` });
    broadcastStats(null, req.user.team?._id);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete campaign: ' + error.message });
  }
});

// API: Delete message
app.delete('/api/message/:id', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  const { id } = req.params;
  try {
    const message = await Message.findOne({ _id: id, team: req.user.team?._id }).populate('campaignId');
    if (!message) return res.status(404).json({ error: 'Message not found or not in your team' });
    if (message.campaignId.createdBy.toString() !== req.user._id && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'You can only delete messages from your own campaigns' });
    }
    await Message.deleteOne({ _id: id });
    res.json({ message: `Message to ${message.phoneNumber} deleted` });
    broadcastStats(message.campaignId._id, req.user.team?._id);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete message: ' + error.message });
  }
});

// API: Logout WhatsApp
app.post('/api/logout', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    if (!sock) return res.status(400).json({ error: 'Not connected to WhatsApp' });
    await sock.logout();
    fs.rmSync('auth_info', { recursive: true, force: true });
    sock = null;
    res.json({ message: 'Logged out successfully. Please scan QR to reconnect.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout: ' + error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startBot();
});