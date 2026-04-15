import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import MembersPanel from './components/MembersPanel';
import { requestDesktopNotifications } from './utils/audioSystem';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [password, setPassword] = useState('');
  const [roomUsers, setRoomUsers] = useState([]);
  const [speakingPeers, setSpeakingPeers] = useState(new Set());

  useEffect(() => {
    if (user && room) {
      requestDesktopNotifications();
      const newSocket = io(SOCKET_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        setIsConnected(true);
        newSocket.emit('join_room', { user, room, password });
      });

      newSocket.on('room_users_update', (users) => {
        setRoomUsers(users);
      });

      newSocket.on('error', (err) => {
        setErrorMsg(err);
        setUser(null);
        setRoom(null);
        setPassword('');
        localStorage.removeItem('base47_session');
        newSocket.disconnect();
      });

      newSocket.on('disconnect', () => {
        setIsConnected(false);
      });

      return () => {
        newSocket.off('room_users_update');
        newSocket.disconnect();
      };
    }
  }, [user, room, password]);

  const handleJoin = (displayName, roomId, pswd = '') => {
    setUser(displayName);
    setRoom(roomId);
    setPassword(pswd);
    setErrorMsg('');
  };

  const handleLogout = () => {
    localStorage.removeItem('base47_session');
    if (socket) socket.disconnect();
    setUser(null);
    setRoom(null);
    setPassword('');
    setSocket(null);
  };

  const handleSpeakingChange = (activeSet) => {
    setSpeakingPeers(activeSet);
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  if (!user || !room) {
    return (
      <>
        {errorMsg && <div className="global-error">{errorMsg}</div>}
        <Login onJoin={handleJoin} />
      </>
    );
  }

  return (
    <div className="app-container">
      <Sidebar
        room={room}
        user={user}
        onLogout={handleLogout}
        isConnected={isConnected}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        socket={socket}
        onSpeakingChange={handleSpeakingChange}
        myProfile={roomUsers.find(u => u.user === user) || {}}
      />
      {socket && (
        <>
          <ChatPanel
            socket={socket}
            user={user}
            room={room}
            onToggleSidebar={toggleSidebar}
          />
          <MembersPanel
            users={roomUsers}
            currentUser={user}
            speakingPeers={speakingPeers}
          />
        </>
      )}
    </div>
  );
}
