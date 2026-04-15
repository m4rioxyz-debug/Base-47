import React, { useState, useEffect } from 'react';
import useWebRTC from '../hooks/useWebRTC';
import AudioRenderer from './AudioRenderer';
import { Mic, MicOff, Volume2, Key } from 'lucide-react';
import './VoiceManager.css';

export default function VoiceManager({ socket, voiceRoom, onDisconnect, onSpeakingChange }) {
  const { localStream, peers, isMuted, toggleMute, setPeerVolume, pushToTalkActive } = useWebRTC(socket, voiceRoom);
  
  // Track speaking state locally for UI
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [localSpeaking, setLocalSpeaking] = useState(false);

  useEffect(() => {
    if (onSpeakingChange) {
      const activeNames = new Set();
      if (localSpeaking && (!isMuted || pushToTalkActive)) activeNames.add('local');
      speakingUsers.forEach(id => {
        if (peers[id]) activeNames.add(peers[id].user);
      });
      onSpeakingChange(activeNames);
    }
  }, [speakingUsers, localSpeaking, isMuted, pushToTalkActive, peers, onSpeakingChange]);

  const handleSpeakerChange = (socketId, isSpeaking) => {
    setSpeakingUsers(prev => {
      const next = new Set(prev);
      if (isSpeaking) next.add(socketId);
      else next.delete(socketId);
      return next;
    });
  };

  // Check local loopback speaking for UI
  useEffect(() => {
    if (!localStream) return;
    
    let audioCtx;
    let analyzer;
    let raf;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyzer = audioCtx.createAnalyser();
      analyzer.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(localStream);
      source.connect(analyzer);
      
      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      
      const checkSpeaking = () => {
        analyzer.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;
        
        // Only active if not muted or if Push To Talk is active
        const actualMuteState = window.__isMutedContext; // We pass state below, but this is a bit rough due to closure
        // So we will just use average
        setLocalSpeaking(average > 10);
        raf = requestAnimationFrame(checkSpeaking);
      };
      checkSpeaking();
    } catch(e) {}
    
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (audioCtx) audioCtx.close();
    };
  }, [localStream]);

  if (!voiceRoom) return null;

  return (
    <>
      <div className="voice-controls-panel">
        <div className="voice-status">
          <span className="voice-connected-text">Voice Connected</span>
          <span className="voice-room-name">{voiceRoom}</span>
        </div>
        <div className="voice-buttons">
          <button className={`icon-btn ${isMuted && !pushToTalkActive ? 'muted' : ''}`} onClick={toggleMute} title="Toggle Mute (V for PushToTalk)">
            {isMuted && !pushToTalkActive ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button className="icon-btn" onClick={() => { onDisconnect(); setTimeout(() => socket.emit('join_voice', voiceRoom), 100); }} title="Force Reset Voice">
            <Key size={18} />
          </button>
          <button className="icon-btn disconnect" onClick={onDisconnect} title="Disconnect Voice">
            <Volume2 size={18} />
          </button>
        </div>
      </div>

      <div className="voice-users-list">
        <div className={`voice-user local ${localSpeaking && (!isMuted || pushToTalkActive) ? 'speaking' : ''}`}>
           <div className="voice-avatar">You</div>
           <span className="voice-name">You {isMuted && !pushToTalkActive && '(Muted)'}</span>
        </div>

        {Object.entries(peers).map(([socketId, peer]) => (
          <div key={socketId} className={`voice-user ${speakingUsers.has(socketId) ? 'speaking' : ''}`}>
            <AudioRenderer 
              stream={peer.stream} 
              volume={peer.volume} 
              onSpeakingChange={(isSpk) => handleSpeakerChange(socketId, isSpk)} 
            />
            <div className="voice-avatar">{peer.user.charAt(0).toUpperCase()}</div>
            <span className="voice-name">{peer.user}</span>
            <input 
              type="range" 
              className="volume-slider"
              min="0" max="1" step="0.05"
              value={peer.volume}
              onChange={(e) => setPeerVolume(socketId, parseFloat(e.target.value))}
              title="Volume"
            />
          </div>
        ))}
      </div>
    </>
  );
}
