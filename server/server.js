const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend in production (Electron build)
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// Add wildcard route for SPA support
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Database setup - Switched to pure JS / In-memory to bypass C++ node-gyp MSVC compile errors
const messagesDB = []; 
// We will simply push objects into this array instead of sqlite3.

const activeSessions = new Map(); // room_user -> socketStatus
const userRateLimits = new Map(); // socket.id -> lastMsgTime
const RATE_LIMIT_MS = 500; // 500ms between messages

const voiceRooms = new Map(); // voiceRoomId -> Set of { socketId, user }
const userStore = new Map(); // username (lowercase) -> { password, role, avatarBase64 }
const roomUsersState = new Map(); // room -> Map of username -> { voiceRoom: string | null }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentRoom = null;
  let currentUser = null;
  let currentVoiceRoom = null;

  const broadcastRoomUsers = (room) => {
    const usersMap = roomUsersState.get(room);
    if (!usersMap) return;
    const usersArray = Array.from(usersMap.entries()).map(([name, data]) => {
      const storeData = userStore.get(name.toLowerCase()) || {};
      return {
        user: name,
        voiceRoom: data.voiceRoom || null,
        role: storeData.role || 'member',
        avatar: storeData.avatar || null
      };
    });
    io.to(room).emit('room_users_update', usersArray);
  };

  socket.on('join_room', ({ room, user, password }) => {
    // Basic validations
    if (!room || !user) return socket.emit('error', 'Room and user required.');

    const nameKey = user.toLowerCase();
    
    // Automatically register or fetch user WITHOUT password check
    if (!userStore.has(nameKey)) {
      const isFirst = userStore.size === 0;
      userStore.set(nameKey, {
        role: isFirst ? 'admin' : 'member',
        avatar: null
      });
    }
    
    // Prevent duplicate sessions in the same room
    const sessionKey = `${room}_${user}`;
    if (activeSessions.has(sessionKey)) {
      return socket.emit('error', 'User is already in this room.');
    }

    currentRoom = room;
    currentUser = user;
    
    // Track session
    activeSessions.set(sessionKey, socket.id);
    if (!roomUsersState.has(room)) roomUsersState.set(room, new Map());
    roomUsersState.get(room).set(user, { voiceRoom: currentVoiceRoom });
    
    socket.join(room);

    // Fetch message history for the room (last 200 messages)
    const roomHistory = messagesDB
      .filter(m => m.room === room)
      .slice(-200);
      
    socket.emit('message_history', roomHistory);

    // Notify others
    socket.to(room).emit('user_joined', { user, timestamp: new Date().toISOString() });
    broadcastRoomUsers(room);
  });

  socket.on('send_message', (content) => {
    if (!currentRoom || !currentUser) return;
    
    // Anti-spam rate limiting
    const now = Date.now();
    const lastMsgTime = userRateLimits.get(socket.id) || 0;
    if (now - lastMsgTime < RATE_LIMIT_MS) {
      return socket.emit('error', 'You are sending messages too fast.');
    }
    userRateLimits.set(socket.id, now);

    const storeData = userStore.get(currentUser.toLowerCase()) || {};

    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      room: currentRoom,
      user: currentUser,
      content,
      role: storeData.role || 'member',
      avatar: storeData.avatar || null,
      timestamp: new Date().toISOString()
    };

    // Broadcast to room
    io.to(currentRoom).emit('receive_message', message);

    // Save to DB
    messagesDB.push(message);
  });

  socket.on('update_avatar', (base64Str) => {
    if (!currentUser) return;
    const nameKey = currentUser.toLowerCase();
    const data = userStore.get(nameKey);
    if (data) {
      data.avatar = base64Str;
      if (currentRoom) broadcastRoomUsers(currentRoom);
      
      // Update historical messages in-memory so newly fetched history shows the new avatar too
      messagesDB.filter(m => m.user === currentUser).forEach(m => m.avatar = base64Str);
      // Let client know its own profile updated
      socket.emit('profile_updated', data);
    }
  });

  socket.on('delete_message', (msgId) => {
    if (!currentUser) return;
    const data = userStore.get(currentUser.toLowerCase());
    if (!data || (data.role !== 'admin' && data.role !== 'mod')) return socket.emit('error', 'No permission to delete messages.');
    
    const index = messagesDB.findIndex(m => m.id === msgId);
    if (index !== -1 && messagesDB[index].room === currentRoom) {
      messagesDB.splice(index, 1);
      io.to(currentRoom).emit('message_deleted', msgId);
    }
  });

  socket.on('kick_user', (targetUser) => {
    if (!currentUser) return;
    const data = userStore.get(currentUser.toLowerCase());
    if (!data || data.role !== 'admin') return socket.emit('error', 'No permission to kick users.');
    
    io.to(currentRoom).emit('user_kicked', targetUser);
    
    // Find socket for that user and disconnect them
    const skey = `${currentRoom}_${targetUser}`;
    const targetSocketId = activeSessions.get(skey);
    if (targetSocketId) {
       const targetSock = io.sockets.sockets.get(targetSocketId);
       if (targetSock) {
         targetSock.emit('error', 'You have been kicked by an admin.');
         targetSock.disconnect(true);
       }
    }
  });

  socket.on('set_role', ({ targetUser, newRole }) => {
    if (!currentUser) return;
    const data = userStore.get(currentUser.toLowerCase());
    if (!data || data.role !== 'admin') return socket.emit('error', 'No permission to change roles.');
    
    const tgtData = userStore.get(targetUser.toLowerCase());
    if (tgtData) {
      tgtData.role = newRole;
      if (currentRoom) broadcastRoomUsers(currentRoom);
    }
  });

  socket.on('typing', (isTyping) => {
    if (currentRoom && currentUser) {
      socket.to(currentRoom).emit('user_typing', { user: currentUser, isTyping });
    }
  });

  // --- Voice Channel Signaling ---
  socket.on('join_voice', (voiceRoom) => {
    if (!currentUser) return;

    // Leave current voice room if in one
    if (currentVoiceRoom) {
      socket.leave(`voice_${currentVoiceRoom}`);
      const roomUsers = voiceRooms.get(currentVoiceRoom);
      if (roomUsers) {
        roomUsers.forEach(u => { if (u.socketId === socket.id) roomUsers.delete(u); });
        if (roomUsers.size === 0) voiceRooms.delete(currentVoiceRoom);
      }
      socket.to(`voice_${currentVoiceRoom}`).emit('user_left_voice', { socketId: socket.id, user: currentUser });
    }

    currentVoiceRoom = voiceRoom;
    socket.join(`voice_${voiceRoom}`);

    if (!voiceRooms.has(voiceRoom)) {
      voiceRooms.set(voiceRoom, new Set());
    }

    const roomUsers = voiceRooms.get(voiceRoom);
    
    // Get array of existing users before adding self
    const existingUsers = Array.from(roomUsers).map(u => ({ socketId: u.socketId, user: u.user }));
    
    // Add self to the room tracking
    roomUsers.add({ socketId: socket.id, user: currentUser });

    // Tell the joining client about existing users
    socket.emit('voice_users', existingUsers);

    // Tell everyone else in this voice room that we joined
    socket.to(`voice_${voiceRoom}`).emit('user_joined_voice', {
      socketId: socket.id,
      user: currentUser
    });
    
    // Update main text room state if present
    if (currentRoom && roomUsersState.has(currentRoom)) {
      const userData = roomUsersState.get(currentRoom).get(currentUser);
      if (userData) {
        userData.voiceRoom = currentVoiceRoom;
        broadcastRoomUsers(currentRoom);
      }
    }
  });

  socket.on('leave_voice', () => {
    if (currentVoiceRoom) {
      socket.leave(`voice_${currentVoiceRoom}`);
      socket.to(`voice_${currentVoiceRoom}`).emit('user_left_voice', { socketId: socket.id, user: currentUser });
      
      const roomUsers = voiceRooms.get(currentVoiceRoom);
      if (roomUsers) {
        let userToRemove = null;
        roomUsers.forEach(u => { if (u.socketId === socket.id) userToRemove = u; });
        if (userToRemove) roomUsers.delete(userToRemove);
        if (roomUsers.size === 0) voiceRooms.delete(currentVoiceRoom);
      }
      currentVoiceRoom = null;
      
      if (currentRoom && roomUsersState.has(currentRoom)) {
        const userData = roomUsersState.get(currentRoom).get(currentUser);
        if (userData) {
          userData.voiceRoom = null;
          broadcastRoomUsers(currentRoom);
        }
      }
    }
  });

  socket.on('voice_signal', (payload) => {
    // payload: { targetSocketId, signalData }
    // Pass the signal to the target socket, along with our own socketId as the sender
    io.to(payload.targetSocketId).emit('voice_signal', {
      senderSocketId: socket.id,
      senderUser: currentUser,
      signalData: payload.signalData
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (currentVoiceRoom) {
      socket.to(`voice_${currentVoiceRoom}`).emit('user_left_voice', { socketId: socket.id, user: currentUser });
      const roomUsers = voiceRooms.get(currentVoiceRoom);
      if (roomUsers) {
        let userToRemove = null;
        roomUsers.forEach(u => { if (u.socketId === socket.id) userToRemove = u; });
        if (userToRemove) roomUsers.delete(userToRemove);
        if (roomUsers.size === 0) voiceRooms.delete(currentVoiceRoom);
      }
    }

    if (currentRoom && currentUser) {
      const sessionKey = `${currentRoom}_${currentUser}`;
      activeSessions.delete(sessionKey);
      
      const rMap = roomUsersState.get(currentRoom);
      if (rMap) {
        rMap.delete(currentUser);
        if (rMap.size === 0) roomUsersState.delete(currentRoom);
      }
      socket.to(currentRoom).emit('user_left', { user: currentUser, timestamp: new Date().toISOString() });
      broadcastRoomUsers(currentRoom);
    }
    userRateLimits.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
