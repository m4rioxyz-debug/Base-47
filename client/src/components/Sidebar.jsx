import { Hash, LogOut, Settings, X, Volume2, Upload, Trash2, Download } from 'lucide-react';
import VoiceManager from './VoiceManager';
import './Sidebar.css';

export default function Sidebar({ room, user, onLogout, isConnected, isOpen, onClose, socket, onSpeakingChange, myProfile }) {
  const [currentVoiceRoom, setCurrentVoiceRoom] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return alert('File too large (MAX 2MB)');
    
    // Automatic image compression via canvas
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 96; // keep things lightweight
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/webp', 0.85); // Supported web format natively
        socket.emit('update_avatar', dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const voiceChannels = ['Lounge', 'Gaming', 'AFK'];

  return (
    <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Base 47</h2>
          {isOpen && <X className="mobile-close" size={20} onClick={onClose} />}
        </div>
      
      <div className="sidebar-channels">
        <div className="channel-category">TEXT CHANNELS</div>
        <div className="channel-item active">
          <Hash size={20} className="channel-icon" />
          <span>{room}</span>
        </div>

        <div className="channel-category" style={{ marginTop: '16px' }}>VOICE CHANNELS</div>
        {voiceChannels.map(vc => (
          <div 
            key={vc} 
            className={`channel-item ${currentVoiceRoom === vc ? 'active' : ''}`}
            onClick={() => setCurrentVoiceRoom(vc)}
          >
            <Volume2 size={20} className="channel-icon" />
            <span>{vc}</span>
          </div>
        ))}
      </div>

      {socket && currentVoiceRoom && (
        <VoiceManager 
          socket={socket} 
          voiceRoom={currentVoiceRoom} 
          onDisconnect={() => setCurrentVoiceRoom(null)} 
          onSpeakingChange={onSpeakingChange}
        />
      )}

      <div className="sidebar-footer">
        <div className="user-profile">
          <div className="avatar-interaction-wrapper" onClick={() => fileInputRef.current?.click()}>
            <input type="file" ref={fileInputRef} accept="image/png, image/jpeg, image/webp" style={{ display: 'none' }} onChange={handleImageUpload} />
            <div className="avatar">
              {myProfile?.avatar ? <img src={myProfile.avatar} alt="Me" className="avatar-img" /> : user.charAt(0).toUpperCase()}
              <div className={`status-indicator ${isConnected ? 'online' : 'offline'}`}></div>
            </div>
            <div className="avatar-edit-overlay">
              <Upload size={14} />
            </div>
          </div>
          <div className="user-info">
            <span className="username">
              {user}
              {myProfile?.role && myProfile.role !== 'member' && <span className={`role-badge ${myProfile.role}`} style={{marginLeft: 4}}>{myProfile.role}</span>}
            </span>
            <span className="user-status">{isConnected ? 'Online' : 'Connecting...'} {myProfile?.avatar && <Trash2 size={12} className="remove-avatar" onClick={(e) => { e.stopPropagation(); socket.emit('update_avatar', null) }} />}</span>
          </div>
        </div>
        <div className="user-actions">
          <button className="icon-btn" onClick={onLogout} title="Disconnect">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
