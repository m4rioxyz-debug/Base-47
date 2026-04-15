import React, { useEffect, useRef, useState } from 'react';

// Renders an individual audio stream and tracks speaking status via AnalyserNode
export default function AudioRenderer({ stream, volume, onSpeakingChange }) {
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      
      // Setup audio analyzer to detect speaking
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioCtx;
        
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyzer);
        analyzerRef.current = analyzer;
        
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        
        const checkSpeaking = () => {
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          
          analyzer.getByteFrequencyData(dataArray);
          // Calculate average volume
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          
          if (average > 10) {
            onSpeakingChange(true);
          } else {
            onSpeakingChange(false);
          }
          animationFrameRef.current = requestAnimationFrame(checkSpeaking);
        };
        
        checkSpeaking();
      } catch (err) {
        console.error("AudioContext setup failed:", err);
      }
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(console.error);
    };
  }, [stream, onSpeakingChange]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume ?? 1.0;
      // In some cases, resetting the volume helps trigger a play state
      if (audioRef.current.paused && stream) {
         audioRef.current.play().catch(() => {});
      }
    }
  }, [volume, stream]);

  return <audio ref={audioRef} autoPlay playsInline muted={false} style={{ display: 'none' }} />;
}
