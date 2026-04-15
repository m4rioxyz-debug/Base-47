import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import './Login.css';

export default function Login({ onJoin }) {
  const [step, setStep] = useState(1); // 1: Name, 2: Room Choice
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const generateRandomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Display name is required');
    setStep(2);
    setError('');
  };

  const handleCreate = () => {
    const newCode = generateRandomCode();
    onJoin(name.trim(), newCode);
  };

  const handleJoinByCode = (e) => {
    e.preventDefault();
    if (!roomCode.trim()) return setError('Room code is required');
    onJoin(name.trim(), roomCode.trim().toUpperCase());
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="logo-wrapper">
            <img src="/logo47.png" alt="Base 47 Logo" className="login-logo" />
          </div>
          <h2>Base 47</h2>
          <p>{step === 1 ? "Start by picking a name" : `Welcome, ${name}!`}</p>
        </div>
        
        {step === 1 ? (
          <form onSubmit={handleNext} className="login-form">
            <div className="form-group">
              <label>DISPLAY NAME</label>
              <input 
                type="text" 
                className="input-field" 
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={20}
                autoFocus
                placeholder="e.g. Ghost"
              />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button type="submit" className="btn submit-btn">Continue</button>
          </form>
        ) : (
          <div className="room-actions">
            <button onClick={handleCreate} className="btn create-btn">
              Create New Room
              <span>Generate a unique 6-digit code</span>
            </button>

            <div className="divider"><span>OR</span></div>

            <form onSubmit={handleJoinByCode} className="join-form">
              <div className="form-group">
                <input 
                  type="text" 
                  className="input-field" 
                  value={roomCode}
                  onChange={e => setRoomCode(e.target.value)}
                  placeholder="Enter 6-digit room code"
                  maxLength={6}
                />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button type="submit" className="btn join-btn">Join Private Room</button>
            </form>
            
            <button className="back-link" onClick={() => setStep(1)}>← Change Name</button>
          </div>
        )}
      </div>
    </div>
  );
}
