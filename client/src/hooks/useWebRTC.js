import { useState, useEffect, useRef, useCallback } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

export default function useWebRTC(socket, currentVoiceRoom) {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState({}); // socketId -> { stream, user }
  const [isMuted, setIsMuted] = useState(false);
  const [pushToTalkActive, setPushToTalkActive] = useState(false);
  
  const peersRef = useRef({});
  const localStreamRef = useRef(null);

  // Push to Talk Event Listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyV' && !pushToTalkActive && document.activeElement.tagName !== 'INPUT') {
        setPushToTalkActive(true);
        if (localStreamRef.current && isMuted) {
          localStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'KeyV' && document.activeElement.tagName !== 'INPUT') {
        setPushToTalkActive(false);
        if (localStreamRef.current && isMuted) {
          localStreamRef.current.getAudioTracks().forEach(t => t.enabled = false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pushToTalkActive, isMuted]);

  // Handle stream availability depending on mute / PTT
  useEffect(() => {
    if (localStreamRef.current) {
      const enabled = pushToTalkActive ? true : !isMuted;
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = enabled);
    }
  }, [isMuted, pushToTalkActive]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  useEffect(() => {
    if (!socket || !currentVoiceRoom) {
      // Disconnect and clean up
      Object.values(peersRef.current).forEach(p => p.pc.close());
      peersRef.current = {};
      setPeers({});
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        setLocalStream(null);
      }
      return;
    }

    let isSubscribed = true;

    // Get microphone
    navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    })
    .then((stream) => {
      if (!isSubscribed) return stream.getTracks().forEach(t => t.stop());

      localStreamRef.current = stream;
      setLocalStream(stream);

      // Apply initial mute state
      stream.getAudioTracks().forEach(t => t.enabled = !isMuted);

      // Now join the voice room server-side
      socket.emit('join_voice', currentVoiceRoom);

      // Handle receiving list of existing users
      const handleVoiceUsers = (existingUsers) => {
        existingUsers.forEach(user => {
          createPeer(user.socketId, user.user, stream, true);
        });
      };

      const handleUserJoined = (newUser) => {
        // Just record that a user exists, wait for them to send an offer
        // createPeer without passing initiator=true creates a passive PC
      };

      const handleUserLeft = ({ socketId }) => {
        if (peersRef.current[socketId]) {
          peersRef.current[socketId].pc.close();
          delete peersRef.current[socketId];
          setPeers(prev => {
            const next = { ...prev };
            delete next[socketId];
            return next;
          });
        }
      };

      const handleSignal = async ({ senderSocketId, senderUser, signalData }) => {
        let peerContext = peersRef.current[senderSocketId];
        
        if (!peerContext) {
          peerContext = createPeer(senderSocketId, senderUser, localStreamRef.current, false);
        }

        const { pc } = peerContext;

        if (signalData.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('voice_signal', { targetSocketId: senderSocketId, signalData: pc.localDescription });
        } else if (signalData.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData));
        } else if (signalData.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signalData));
        }
      };

      socket.on('voice_users', handleVoiceUsers);
      socket.on('user_joined_voice', handleUserJoined);
      socket.on('user_left_voice', handleUserLeft);
      socket.on('voice_signal', handleSignal);

      return () => {
        socket.off('voice_users', handleVoiceUsers);
        socket.off('user_joined_voice', handleUserJoined);
        socket.off('user_left_voice', handleUserLeft);
        socket.off('voice_signal', handleSignal);
      };
    })
    .catch(err => {
      console.error("Microphone access denied or error:", err);
      // Fallback: join without mic if possible, but for simple app just log.
    });

    return () => {
      isSubscribed = false;
      socket.emit('leave_voice');
    };
  }, [socket, currentVoiceRoom]); // only re-run when room changes

  const createPeer = (targetSocketId, targetUser, stream, initiator) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (stream) {
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice_signal', {
          targetSocketId,
          signalData: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      setPeers(prev => ({
        ...prev,
        [targetSocketId]: {
          user: targetUser,
          stream: event.streams[0],
          volume: 1.0,
        }
      }));
    };

    // If initiator, send offer
    if (initiator) {
      pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer);
      }).then(() => {
        socket.emit('voice_signal', {
          targetSocketId,
          signalData: pc.localDescription
        });
      }).catch(err => console.error(err));
    }

    peersRef.current[targetSocketId] = { pc, user: targetUser };
    return peersRef.current[targetSocketId];
  };

  const setPeerVolume = useCallback((socketId, volume) => {
    setPeers(prev => {
      if (!prev[socketId]) return prev;
      return {
        ...prev,
        [socketId]: { ...prev[socketId], volume }
      };
    });
  }, []);

  return {
    localStream,
    peers,
    isMuted,
    toggleMute,
    setPeerVolume,
    pushToTalkActive
  };
}
